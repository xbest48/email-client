import { Injectable, signal } from '@angular/core';

export interface EmailAccount {
  id: string;
  email: string;
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
  readonly settings = signal<AppSettings>(this.load());

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

  addAccount(account: Omit<EmailAccount, 'id'>): void {
    const id = crypto.randomUUID();
    this.settings.update((s) => {
      const updated = { ...s, accounts: [...s.accounts, { ...account, id }] };
      this.save(updated);
      return updated;
    });
  }

  removeAccount(id: string): void {
    this.settings.update((s) => {
      const updated = { ...s, accounts: s.accounts.filter((a) => a.id !== id) };
      this.save(updated);
      return updated;
    });
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

  private load(): AppSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_SETTINGS };
  }

  private save(settings: AppSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }
}
