import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

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
  accentColor: string;
}

const STORAGE_KEY = 'mailflow_settings';
const DRAFT_STORAGE_KEY = 'mailflow_draft';

const DEFAULT_SETTINGS: AppSettings = {
  pageSize: 50,
  accounts: [],
  signatures: [],
  templates: [],
  showFolders: true,
  accentColor: '#403d84',
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  readonly settings = signal<AppSettings>({ ...DEFAULT_SETTINGS });

  readonly loadPromise: Promise<void>;

  constructor() {
    this.applyAccentTheme(DEFAULT_SETTINGS.accentColor);
    this.loadPromise = this.load();
  }

  get pageSize(): number {
    return this.settings().pageSize;
  }

  get accounts(): EmailAccount[] {
    return this.settings().accounts;
  }

  get signatures(): EmailSignature[] {
    return this.settings().signatures;
  }

  get showFolders(): boolean {
    return this.settings().showFolders;
  }

  get accentColor(): string {
    return this.settings().accentColor;
  }

  update(partial: Partial<AppSettings>): void {
    this.settings.update((s) => {
      const updated = { ...s, ...partial };
      this.save(updated);
      return updated;
    });
  }

  setPageSize(size: number): void {
    this.update({ pageSize: Math.max(10, Math.min(200, size)) });
  }

  toggleShowFolders(): void {
    this.update({ showFolders: !this.settings().showFolders });
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

  async updateAccount(id: string, data: Partial<EmailAccount>): Promise<void> {
    try {
      const updated = await firstValueFrom(this.http.put<EmailAccount>(`/api/accounts/${id}`, data));
      this.settings.update((s) => ({
        ...s,
        accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...updated } : a)),
      }));
    } catch (err) {
      console.error('Failed to update account', err);
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

  addSignature(signature: Omit<EmailSignature, 'id'>): void {
    const id = crypto.randomUUID();
    this.settings.update((s) => {
      const sigs = signature.isDefault
        ? s.signatures.map((sig) => ({ ...sig, isDefault: false }))
        : [...s.signatures];
      const updated = { ...s, signatures: [...sigs, { ...signature, id }] };
      this.save(updated);
      return updated;
    });
  }

  updateSignature(id: string, partial: Partial<EmailSignature>): void {
    this.settings.update((s) => {
      let sigs = s.signatures.map((sig) => (sig.id === id ? { ...sig, ...partial } : sig));
      if (partial.isDefault) {
        sigs = sigs.map((sig) => ({ ...sig, isDefault: sig.id === id }));
      }
      const updated = { ...s, signatures: sigs };
      this.save(updated);
      return updated;
    });
  }

  removeSignature(id: string): void {
    this.settings.update((s) => {
      const updated = { ...s, signatures: s.signatures.filter((sig) => sig.id !== id) };
      this.save(updated);
      return updated;
    });
  }

  getDefaultSignature(): EmailSignature | undefined {
    return this.settings().signatures.find((s) => s.isDefault);
  }

  // --- Templates ---

  get templates(): EmailTemplate[] {
    return this.settings().templates;
  }

  addTemplate(template: Omit<EmailTemplate, 'id'>): void {
    const id = crypto.randomUUID();
    this.settings.update((s) => {
      const updated = { ...s, templates: [...s.templates, { ...template, id }] };
      this.save(updated);
      return updated;
    });
  }

  updateTemplate(id: string, partial: Partial<EmailTemplate>): void {
    this.settings.update((s) => {
      const templates = s.templates.map((t) => (t.id === id ? { ...t, ...partial } : t));
      const updated = { ...s, templates };
      this.save(updated);
      return updated;
    });
  }

  removeTemplate(id: string): void {
    this.settings.update((s) => {
      const updated = { ...s, templates: s.templates.filter((t) => t.id !== id) };
      this.save(updated);
      return updated;
    });
  }

  // --- Drafts ---

  saveDraft(draft: DraftState): void {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
    } catch { /* ignore */ }
  }

  loadDraft(): DraftState | null {
    try {
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  clearDraft(): void {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  }

  private async load(): Promise<void> {
    let settings = { ...DEFAULT_SETTINGS };
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch {
      // ignore
    }

    try {
      const accounts = await firstValueFrom(this.http.get<EmailAccount[]>('/api/accounts'));
      settings.accounts = accounts;
    } catch (err) {
      console.error('Failed to load accounts', err);
      settings.accounts = [];
    }

    this.settings.set(settings);
    this.applyAccentTheme(settings.accentColor);
  }

  private save(settings: AppSettings): void {
    try {
      // We no longer save accounts to local storage
      const { accounts, ...settingsToSave } = settings;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsToSave));
    } catch {
      // ignore
    }
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
