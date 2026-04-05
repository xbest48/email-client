import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface EmailAccount {
  id: string;
  email: string;
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

export interface AppSettings {
  pageSize: number;
  accounts: EmailAccount[];
  signatures: EmailSignature[];
  showFolders: boolean;
}

const STORAGE_KEY = 'mailflow_settings';

const DEFAULT_SETTINGS: AppSettings = {
  pageSize: 50,
  accounts: [],
  signatures: [],
  showFolders: true,
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  readonly settings = signal<AppSettings>({ ...DEFAULT_SETTINGS });

  readonly loadPromise: Promise<void>;

  constructor() {
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
}
