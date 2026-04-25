import { Injectable, signal, inject, effect } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { sanitizeEmailHtml } from '../utils/html-sanitizer';

export interface EmailAccount {
  id: string;
  email: string;
  displayName?: string;
  password?: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export interface EmailSignature {
  id: string;
  name: string;
  html: string;
  isDefault: boolean;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
}

export interface DraftState {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  htmlBody: string;
  savedAt: string;
}

export interface AppSettings {
  pageSize: number;
  accounts: EmailAccount[];
  signatures: EmailSignature[];
  templates: EmailTemplate[];
  showFolders: boolean;
  showLabelsSection: boolean;
  accentColor: string;
  mobileSwipeLeftAction: 'trash' | 'move' | 'spam' | 'toggleRead' | 'toggleStar';
  mobileSwipeLeftMoveFolder: string;
  mobileSwipeRightAction: 'trash' | 'move' | 'spam' | 'toggleRead' | 'toggleStar';
  mobileSwipeRightMoveFolder: string;
}

const STORAGE_KEY = 'mailflow_settings';
const DRAFT_STORAGE_KEY = 'mailflow_draft';

const DEFAULT_SETTINGS: AppSettings = {
  pageSize: 50,
  accounts: [],
  signatures: [],
  templates: [],
  showFolders: true,
  showLabelsSection: true,
  accentColor: '#403d84',
  mobileSwipeLeftAction: 'trash',
  mobileSwipeLeftMoveFolder: '',
  mobileSwipeRightAction: 'move',
  mobileSwipeRightMoveFolder: 'INBOX',
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  readonly settings = signal<AppSettings>({ ...DEFAULT_SETTINGS });

  private currentLoadPromise: Promise<void> = Promise.resolve();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingServerSyncSettings: AppSettings | null = null;
  private loadVersion = 0;
  private observedAuthScope = this.getAuthScope();

  constructor() {
    this.applyAccentTheme(DEFAULT_SETTINGS.accentColor);
    this.installSyncLifecycleHooks();
    this.currentLoadPromise = this.load();
    this.installAuthScopeWatcher();
  }

  get loadPromise(): Promise<void> {
    return this.currentLoadPromise;
  }

  get pageSize(): number {
    return this.settings().pageSize;
  }

  get accounts(): EmailAccount[] {
    return this.settings().accounts;
  }

  get signatures(): EmailSignature[] {
    return this.settings().signatures.map((signature) => ({
      ...signature,
      html: this.normalizeSignatureHtml(signature.html),
    }));
  }

  get showFolders(): boolean {
    return this.settings().showFolders;
  }

  get accentColor(): string {
    return this.settings().accentColor;
  }

  get showLabelsSection(): boolean {
    return this.settings().showLabelsSection;
  }

  get mobileSwipeLeftAction(): 'trash' | 'move' | 'spam' | 'toggleRead' | 'toggleStar' {
    return this.settings().mobileSwipeLeftAction;
  }

  get mobileSwipeLeftMoveFolder(): string {
    return this.settings().mobileSwipeLeftMoveFolder;
  }

  get mobileSwipeRightAction(): 'trash' | 'move' | 'spam' | 'toggleRead' | 'toggleStar' {
    return this.settings().mobileSwipeRightAction;
  }

  get mobileSwipeRightMoveFolder(): string {
    return this.settings().mobileSwipeRightMoveFolder;
  }

  update(partial: Partial<AppSettings>): void {
    this.settings.update((s) => {
      const updated = { ...s, ...partial };
      this.saveAndSync(updated);
      return updated;
    });
  }

  setPageSize(size: number): void {
    this.update({ pageSize: Math.max(10, Math.min(200, size)) });
  }

  toggleShowFolders(): void {
    this.update({ showFolders: !this.settings().showFolders });
  }

  toggleShowLabelsSection(): void {
    this.update({ showLabelsSection: !this.settings().showLabelsSection });
  }

  setAccentColor(color: string): void {
    const next = this.normalizeHexColor(color) ?? DEFAULT_SETTINGS.accentColor;
    this.update({ accentColor: next });
    this.applyAccentTheme(next);
  }

  // --- Accounts ---

  activeAccountId(): string | null {
    const accs = this.accounts;
    return accs.length > 0 ? accs[0].id : null;
  }

  async testAccountConnection(account: Omit<EmailAccount, 'id'>): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; message?: string }>('/api/accounts/test', account)
      );
      return res;
    } catch (err: any) {
      console.error('Test connection failed', err);
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  async addAccount(account: Omit<EmailAccount, 'id'>): Promise<void> {
    try {
      const newAccount = await firstValueFrom(this.http.post<EmailAccount>('/api/accounts', account));
      this.settings.update((s) => {
        const updated = { ...s, accounts: [...s.accounts, newAccount] };
        return updated;
      });
    } catch (err) {
      console.error('Failed to add account', err);
    }
  }

  async updateAccount(id: string, data: Partial<EmailAccount>): Promise<EmailAccount | null> {
    try {
      const updated = await firstValueFrom(this.http.put<EmailAccount>(`/api/accounts/${id}`, data));
      this.settings.update((s) => ({
        ...s,
        accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...updated } : a)),
      }));
      return updated;
    } catch (err) {
      console.error('Failed to update account', err);
      return null;
    }
  }

  async removeAccount(id: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(`/api/accounts/${id}`));
      this.settings.update((s) => {
        const updated = { ...s, accounts: s.accounts.filter((a) => a.id !== id) };
        return updated;
      });
    } catch (err) {
      console.error('Failed to remove account', err);
    }
  }

  // --- Signatures ---

  async addSignature(signature: Omit<EmailSignature, 'id'>): Promise<void> {
    const id = crypto.randomUUID();
    const normalizedSignature = {
      ...signature,
      html: await this.prepareSignatureHtml(signature.html),
    };
    this.settings.update((s) => {
      const sigs = normalizedSignature.isDefault
        ? s.signatures.map((sig) => ({ ...sig, isDefault: false }))
        : [...s.signatures];
      const updated = { ...s, signatures: [...sigs, { ...normalizedSignature, id }] };
      this.saveAndSync(updated);
      return updated;
    });
  }

  async updateSignature(id: string, partial: Partial<EmailSignature>): Promise<void> {
    const normalizedPartial = partial.html !== undefined
      ? { ...partial, html: await this.prepareSignatureHtml(partial.html) }
      : partial;

    this.settings.update((s) => {
      let sigs = s.signatures.map((sig) => (sig.id === id ? { ...sig, ...normalizedPartial } : sig));
      if (partial.isDefault) {
        sigs = sigs.map((sig) => ({ ...sig, isDefault: sig.id === id }));
      }
      const updated = { ...s, signatures: sigs };
      this.saveAndSync(updated);
      return updated;
    });
  }

  removeSignature(id: string): void {
    this.settings.update((s) => {
      const updated = { ...s, signatures: s.signatures.filter((sig) => sig.id !== id) };
      this.saveAndSync(updated);
      return updated;
    });
  }

  getDefaultSignature(): EmailSignature | undefined {
    const signature = this.settings().signatures.find((s) => s.isDefault);
    if (!signature) return undefined;

    return {
      ...signature,
      html: this.normalizeSignatureHtml(signature.html),
    };
  }

  // --- Templates ---

  get templates(): EmailTemplate[] {
    return this.settings().templates;
  }

  addTemplate(template: Omit<EmailTemplate, 'id'>): void {
    const id = crypto.randomUUID();
    this.settings.update((s) => {
      const updated = { ...s, templates: [...s.templates, { ...template, id }] };
      this.saveAndSync(updated);
      return updated;
    });
  }

  updateTemplate(id: string, partial: Partial<EmailTemplate>): void {
    this.settings.update((s) => {
      const templates = s.templates.map((t) => (t.id === id ? { ...t, ...partial } : t));
      const updated = { ...s, templates };
      this.saveAndSync(updated);
      return updated;
    });
  }

  removeTemplate(id: string): void {
    this.settings.update((s) => {
      const updated = { ...s, templates: s.templates.filter((t) => t.id !== id) };
      this.saveAndSync(updated);
      return updated;
    });
  }

  // --- Drafts ---

  saveDraft(draft: DraftState): void {
    try {
      localStorage.setItem(
        this.getDraftStorageKey(),
        JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
      );
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch { /* ignore */ }
  }

  loadDraft(): DraftState | null {
    try {
      const stored = localStorage.getItem(this.getDraftStorageKey())
        ?? this.getLegacyDraftValueForMigration();
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  clearDraft(): void {
    localStorage.removeItem(this.getDraftStorageKey());
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  }

  private async load(): Promise<void> {
    const version = ++this.loadVersion;
    let settings = { ...DEFAULT_SETTINGS };

    // 1. Seed from localStorage so the UI has something to show immediately.
    try {
      const stored = localStorage.getItem(this.getSettingsStorageKey())
        ?? this.getLegacySettingsValueForMigration();
      if (stored) {
        const parsed = JSON.parse(stored);
        settings = { ...DEFAULT_SETTINGS, ...parsed };
        settings.signatures = (settings.signatures ?? []).map((sig) => ({
          ...sig,
          html: typeof sig.html === 'string' ? sig.html : '',
        }));
      }
    } catch { /* ignore */ }

    // 2. Wait for auth startup to settle before we hit protected endpoints.
    // This avoids transient bootstrap races with token refresh.
    await this.auth.getInitialLoadPromise();

    if (!this.auth.getToken()) {
      settings.signatures = await Promise.all(
        (settings.signatures ?? []).map(async (sig) => ({
          ...sig,
          html: await this.prepareSignatureHtml(sig.html),
        }))
      );

      if (version !== this.loadVersion) return;
      this.settings.set(settings);
      this.applyAccentTheme(settings.accentColor);
      this.save(settings);
      return;
    }

    // 3. Fetch accounts and server-side app settings in parallel.
    const [accountsResult, serverSettingsResult] = await Promise.allSettled([
      this.loadAccountsWithRetry(),
      firstValueFrom(this.http.get<Partial<AppSettings>>('/api/auth/app-settings')),
    ]);

    // Apply accounts (always authoritative on the server).
    if (accountsResult.status === 'fulfilled') {
      settings.accounts = accountsResult.value;
    } else {
      console.error('Failed to load accounts', accountsResult.reason);
      settings.accounts = [];
    }

    // 4. Server app-settings override localStorage so changes made on any
    //    browser are visible everywhere after the next login.
    if (serverSettingsResult.status === 'fulfilled') {
      const s = serverSettingsResult.value;
      if (s && typeof s === 'object') {
        if (Array.isArray(s.signatures)) settings.signatures = s.signatures;
        if (Array.isArray(s.templates)) settings.templates = s.templates;
        if (typeof s.accentColor === 'string' && s.accentColor) settings.accentColor = s.accentColor;
        if (typeof s.pageSize === 'number' && s.pageSize > 0) settings.pageSize = s.pageSize;
        if (typeof s.showFolders === 'boolean') settings.showFolders = s.showFolders;
        if (typeof s.showLabelsSection === 'boolean') settings.showLabelsSection = s.showLabelsSection;
        if (this.isValidMobileSwipeAction(s.mobileSwipeLeftAction)) {
          settings.mobileSwipeLeftAction = s.mobileSwipeLeftAction;
        }
        if (typeof s.mobileSwipeLeftMoveFolder === 'string') {
          settings.mobileSwipeLeftMoveFolder = s.mobileSwipeLeftMoveFolder;
        }
        if (this.isValidMobileSwipeAction(s.mobileSwipeRightAction)) {
          settings.mobileSwipeRightAction = s.mobileSwipeRightAction;
        }
        if (typeof s.mobileSwipeRightMoveFolder === 'string') {
          settings.mobileSwipeRightMoveFolder = s.mobileSwipeRightMoveFolder;
        }
      }
    }

    // 5. Normalise signature HTML (decode entities, compress images).
    settings.signatures = await Promise.all(
      (settings.signatures ?? []).map(async (sig) => ({
        ...sig,
        html: await this.prepareSignatureHtml(sig.html),
      }))
    );

    if (version !== this.loadVersion) return;
    this.settings.set(settings);
    this.applyAccentTheme(settings.accentColor);

    // 6. Persist to localStorage as a fast local cache.
    this.save(settings);

    // 7. If the server has no data yet (fresh account or first run with this
    //    feature), migrate whatever is in localStorage up to the server so it
    //    becomes available on the next login from any browser.
    const serverHasData =
      serverSettingsResult.status === 'fulfilled' &&
      serverSettingsResult.value != null &&
      (Array.isArray((serverSettingsResult.value as any).signatures) ||
        Array.isArray((serverSettingsResult.value as any).templates));

    const localHasData = this.hasServerSyncableSettings(settings);

    if (!serverHasData && localHasData) {
      this.scheduleSyncToServer(settings);
    }
  }

  /**
   * Writes to localStorage only (fast, synchronous). Use this for the initial
   * load where we don't want to echo data back to the server.
   */
  private save(settings: AppSettings): void {
    try {
      const { accounts, ...settingsToSave } = settings;
      localStorage.setItem(this.getSettingsStorageKey(), JSON.stringify(settingsToSave));
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }

  private async loadAccountsWithRetry(): Promise<EmailAccount[]> {
    try {
      return await firstValueFrom(this.http.get<EmailAccount[]>('/api/accounts'));
    } catch (error) {
      if (!this.shouldRetryAccountsLoad(error)) {
        throw error;
      }

      const refreshed = await this.auth.refreshAccessToken();
      if (!refreshed) {
        throw error;
      }

      return firstValueFrom(this.http.get<EmailAccount[]>('/api/accounts'));
    }
  }

  private shouldRetryAccountsLoad(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse)) {
      return false;
    }

    return error.status === 401 || error.status === 403 || error.status === 500;
  }

  /**
   * Writes to localStorage AND schedules a debounced sync to the server so
   * all browsers see the latest settings after a page reload. Call this from
   * every user-initiated mutation (signature, template, UI preference change).
   */
  private saveAndSync(settings: AppSettings): void {
    this.save(settings);
    this.scheduleSyncToServer(settings);
  }

  private scheduleSyncToServer(settings: AppSettings): void {
    this.pendingServerSyncSettings = { ...settings, accounts: [...settings.accounts] };
    if (this.syncTimer !== null) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.flushPendingSync();
    }, 400);
  }

  private async flushPendingSync(): Promise<void> {
    const settings = this.pendingServerSyncSettings;
    if (!settings || !this.auth.getToken()) return;

    this.pendingServerSyncSettings = null;
    const { accounts, ...settingsToSave } = settings;

    try {
      await firstValueFrom(
        this.http.put<{ success: boolean }>('/api/auth/app-settings', settingsToSave),
      );
    } catch (error) {
      console.error('Failed to sync app settings to server', error);
      this.pendingServerSyncSettings = settings;
    }
  }

  private installSyncLifecycleHooks(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flushPendingSyncWithKeepalive();
      }
    });

    window.addEventListener('beforeunload', () => {
      this.flushPendingSyncWithKeepalive();
    });
  }

  private installAuthScopeWatcher(): void {
    effect(() => {
      const nextScope = this.getAuthScope();
      if (nextScope === this.observedAuthScope) {
        return;
      }

      this.observedAuthScope = nextScope;
      this.resetTransientStateForScopeChange();
      this.currentLoadPromise = this.load();
    });
  }

  private flushPendingSyncWithKeepalive(): void {
    const settings = this.pendingServerSyncSettings;
    const token = this.auth.getToken();
    if (!settings || !token) return;

    const { accounts, ...settingsToSave } = settings;
    this.pendingServerSyncSettings = null;

    void fetch('/api/auth/app-settings', {
      method: 'PUT',
      keepalive: true,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(settingsToSave),
    }).catch(() => {
      this.pendingServerSyncSettings = settings;
    });
  }

  private hasServerSyncableSettings(settings: AppSettings): boolean {
    return settings.pageSize !== DEFAULT_SETTINGS.pageSize
      || settings.showFolders !== DEFAULT_SETTINGS.showFolders
      || settings.showLabelsSection !== DEFAULT_SETTINGS.showLabelsSection
      || settings.accentColor !== DEFAULT_SETTINGS.accentColor
      || settings.mobileSwipeLeftAction !== DEFAULT_SETTINGS.mobileSwipeLeftAction
      || settings.mobileSwipeLeftMoveFolder !== DEFAULT_SETTINGS.mobileSwipeLeftMoveFolder
      || settings.mobileSwipeRightAction !== DEFAULT_SETTINGS.mobileSwipeRightAction
      || settings.mobileSwipeRightMoveFolder !== DEFAULT_SETTINGS.mobileSwipeRightMoveFolder
      || settings.signatures.length > 0
      || settings.templates.length > 0;
  }

  private isValidMobileSwipeAction(
    value: unknown,
  ): value is 'trash' | 'move' | 'spam' | 'toggleRead' | 'toggleStar' {
    return value === 'trash'
      || value === 'move'
      || value === 'spam'
      || value === 'toggleRead'
      || value === 'toggleStar';
  }

  private resetTransientStateForScopeChange(): void {
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.pendingServerSyncSettings = null;
    this.settings.set({ ...DEFAULT_SETTINGS });
    this.applyAccentTheme(DEFAULT_SETTINGS.accentColor);
  }

  private getAuthScope(): string {
    const token = this.auth.getToken();
    const userId = this.auth.user()?.id;
    if (!token) return 'anonymous';
    return userId ? `user:${userId}` : 'authenticated';
  }

  private getStorageScope(): string {
    const userId = this.auth.user()?.id;
    return userId ? `user:${userId}` : 'anonymous';
  }

  private getSettingsStorageKey(): string {
    return `${STORAGE_KEY}:${this.getStorageScope()}`;
  }

  private getDraftStorageKey(): string {
    return `${DRAFT_STORAGE_KEY}:${this.getStorageScope()}`;
  }

  private getLegacySettingsValueForMigration(): string | null {
    if (this.getStorageScope() === 'anonymous') {
      return localStorage.getItem(STORAGE_KEY);
    }

    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy) {
      localStorage.setItem(this.getSettingsStorageKey(), legacy);
      localStorage.removeItem(STORAGE_KEY);
    }
    return legacy;
  }

  private getLegacyDraftValueForMigration(): string | null {
    if (this.getStorageScope() === 'anonymous') {
      return localStorage.getItem(DRAFT_STORAGE_KEY);
    }

    const legacy = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (legacy) {
      localStorage.setItem(this.getDraftStorageKey(), legacy);
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
    return legacy;
  }

  private normalizeEmbeddedDataImageUrls(html: string): string {
    const stripWhitespace = (dataUrl: string) =>
      /;base64,/i.test(dataUrl) ? dataUrl.replace(/\s+/g, '') : dataUrl;

    // Normalize <img src="data:..."> — use the same capture-only-src-value
    // approach as the backend to avoid issues with > inside other attributes.
    let result = html.replace(
      /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:image\/[^"']+)\2/gi,
      (_match, prefix: string, quote: string, dataUrl: string) =>
        `${prefix}${quote}${stripWhitespace(dataUrl)}${quote}`,
    );

    // Also normalize CSS url(data:...) patterns (background-image etc.)
    result = result.replace(
      /(url\s*\(\s*)(["']?)(data:image\/[^"')]+)\2(\s*\))/gi,
      (_match, urlOpen: string, quote: string, dataUrl: string, urlClose: string) =>
        `${urlOpen}${quote}${stripWhitespace(dataUrl)}${quote}${urlClose}`,
    );

    return result;
  }

  private normalizeSignatureHtml(html: string): string {
    return sanitizeEmailHtml(this.normalizeEmbeddedDataImageUrls(this.decodeEscapedHtmlIfNeeded(html)));
  }

  private async prepareSignatureHtml(html: string): Promise<string> {
    const normalizedHtml = this.normalizeSignatureHtml(html);
    return this.optimizeEmbeddedSignatureImages(normalizedHtml);
  }

  private async optimizeEmbeddedSignatureImages(html: string): Promise<string> {
    if (!html || !/data:image\//i.test(html)) return html;

    const template = document.createElement('template');
    template.innerHTML = html;

    const images = Array.from(template.content.querySelectorAll<HTMLImageElement>('img[src^="data:image/"]'));
    for (const image of images) {
      const optimizedSrc = await this.optimizeEmbeddedSignatureImage(image);
      if (optimizedSrc) {
        image.setAttribute('src', optimizedSrc);
      }
    }

    return template.innerHTML;
  }

  private async optimizeEmbeddedSignatureImage(image: HTMLImageElement): Promise<string | null> {
    const src = image.getAttribute('src')?.trim();
    if (!src) return null;
    if (!/^data:image\/[^;]+;base64,/i.test(src)) return null;
    if (src.length < 100_000) return null;

    try {
      const loadedImage = await this.loadDataUrlImage(src);
      const naturalWidth = loadedImage.naturalWidth || loadedImage.width;
      const naturalHeight = loadedImage.naturalHeight || loadedImage.height;
      if (!naturalWidth || !naturalHeight) return null;

      const declaredWidth = this.extractDeclaredImageWidth(image);
      const maxWidth = declaredWidth
        ? Math.max(Math.round(declaredWidth * 2), declaredWidth)
        : 1200;
      const targetWidth = Math.min(naturalWidth, Math.max(600, maxWidth));
      if (naturalWidth <= targetWidth && src.length < 180_000) return null;

      const scale = targetWidth / naturalWidth;
      const targetHeight = Math.max(1, Math.round(naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const context = canvas.getContext('2d');
      if (!context) return null;

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(loadedImage, 0, 0, targetWidth, targetHeight);

      const mimeMatch = src.match(/^data:(image\/[^;]+);base64,/i);
      const mimeType = mimeMatch?.[1]?.toLowerCase() ?? 'image/png';
      const optimizedSrc = canvas.toDataURL(mimeType);
      return optimizedSrc.length < src.length ? optimizedSrc : null;
    } catch {
      return null;
    }
  }

  private extractDeclaredImageWidth(image: HTMLImageElement): number | null {
    const widthAttr = image.getAttribute('width');
    const numericAttrWidth = widthAttr ? Number.parseInt(widthAttr, 10) : Number.NaN;
    if (Number.isFinite(numericAttrWidth) && numericAttrWidth > 0) {
      return numericAttrWidth;
    }

    const styleValue = image.style.width || image.style.maxWidth;
    const styleMatch = styleValue.match(/(\d+(?:\.\d+)?)px/i);
    if (styleMatch) {
      const parsed = Number.parseFloat(styleMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return null;
  }

  private loadDataUrlImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image load failed'));
      image.src = src;
    });
  }

  private decodeEscapedHtmlIfNeeded(html: string): string {
    if (!html) return html;

    let normalized = html;
    for (let index = 0; index < 2; index += 1) {
      const decoded = this.decodeHtmlEntities(normalized);
      if (decoded === normalized) break;
      if (!this.looksLikeDecodedMarkup(normalized, decoded)) break;
      normalized = decoded;
    }

    return normalized;
  }

  private decodeHtmlEntities(value: string): string {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  }

  private looksLikeDecodedMarkup(original: string, decoded: string): boolean {
    const hadEscapedTags = /(?:&lt;|&#60;|&#x3c;)\s*\/?\s*[a-z!][\s\S]*?(?:&gt;|&#62;|&#x3e;)/i.test(original);
    const hasRealTags = /<\s*\/?\s*[a-z!][^>]*>/i.test(decoded);
    return hadEscapedTags && hasRealTags;
  }

  private applyAccentTheme(baseHex: string): void {
    const root = document.documentElement;
    const color = this.normalizeHexColor(baseHex) ?? DEFAULT_SETTINGS.accentColor;
    const shades = {
      50: this.mixColor(color, '#ffffff', 0.90),
      100: this.mixColor(color, '#ffffff', 0.78),
      200: this.mixColor(color, '#ffffff', 0.62),
      300: this.mixColor(color, '#ffffff', 0.46),
      400: this.mixColor(color, '#ffffff', 0.28),
      500: color,
      600: this.mixColor(color, '#000000', 0.10),
      700: this.mixColor(color, '#000000', 0.22),
      800: this.mixColor(color, '#000000', 0.34),
      900: this.mixColor(color, '#000000', 0.48),
    };

    for (const [step, value] of Object.entries(shades)) {
      root.style.setProperty(`--color-amber-${step}`, value);
    }
  }

  private normalizeHexColor(color: string): string | null {
    const match = color.trim().match(/^#([0-9a-fA-F]{6})$/);
    return match ? `#${match[1].toLowerCase()}` : null;
  }

  private mixColor(colorA: string, colorB: string, weightB: number): string {
    const [ar, ag, ab] = this.hexToRgb(colorA);
    const [br, bg, bb] = this.hexToRgb(colorB);
    const weightA = 1 - weightB;
    const r = Math.round(ar * weightA + br * weightB);
    const g = Math.round(ag * weightA + bg * weightB);
    const b = Math.round(ab * weightA + bb * weightB);
    return this.rgbToHex(r, g, b);
  }

  private hexToRgb(hex: string): [number, number, number] {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  }
}
