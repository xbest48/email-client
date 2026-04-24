import { Injectable, signal, inject } from '@angular/core';
import { Email, ImapFolder } from '../models/email.model';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';

const DB_NAME = 'mailflow_offline';
const DB_VERSION = 2;
const EMAILS_STORE = 'emails_v2';
const FOLDERS_STORE = 'folders_v2';
const OUTBOX_STORE = 'outbox_v2';

@Injectable({ providedIn: 'root' })
export class OfflineService {
  private readonly auth = inject(AuthService);
  private readonly settingsService = inject(SettingsService);
  readonly isOnline = signal(navigator.onLine);
  readonly outboxCount = signal(0);

  private db: IDBDatabase | null = null;
  private dbReady: Promise<void>;

  constructor() {
    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));
    this.dbReady = this.openDb();
  }

  private openDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(EMAILS_STORE)) {
          const store = db.createObjectStore(EMAILS_STORE, { keyPath: 'key' });
          store.createIndex('scopeFolder', 'scopeFolder', { unique: false });
        }
        if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
          const store = db.createObjectStore(FOLDERS_STORE, { keyPath: 'key' });
          store.createIndex('scope', 'scope', { unique: false });
        }
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          const store = db.createObjectStore(OUTBOX_STORE, { keyPath: 'key' });
          store.createIndex('scope', 'scope', { unique: false });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.refreshOutboxCount();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async cacheEmails(folder: string, emails: Email[]): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const scope = this.getAccountScope();
    const tx = this.db.transaction(EMAILS_STORE, 'readwrite');
    const store = tx.objectStore(EMAILS_STORE);
    for (const email of emails) {
      store.put({
        ...email,
        key: `${scope}:${folder}:${email.uid}`,
        folder,
        scope,
        scopeFolder: `${scope}:${folder}`,
      });
    }
  }

  async getCachedEmails(folder: string): Promise<Email[]> {
    await this.dbReady;
    if (!this.db) return [];
    const scopeFolder = `${this.getAccountScope()}:${folder}`;
    return new Promise((resolve) => {
      const tx = this.db!.transaction(EMAILS_STORE, 'readonly');
      const store = tx.objectStore(EMAILS_STORE);
      const index = store.index('scopeFolder');
      const request = index.getAll(scopeFolder);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  async cacheEmail(email: Email): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const scope = this.getAccountScope();
    const tx = this.db.transaction(EMAILS_STORE, 'readwrite');
    tx.objectStore(EMAILS_STORE).put({
      ...email,
      key: `${scope}:${email.folder}:${email.uid}`,
      scope,
      scopeFolder: `${scope}:${email.folder}`,
    });
  }

  async getCachedEmail(folder: string, uid: number): Promise<Email | null> {
    await this.dbReady;
    if (!this.db) return null;
    const scope = this.getAccountScope();
    return new Promise((resolve) => {
      const tx = this.db!.transaction(EMAILS_STORE, 'readonly');
      const request = tx.objectStore(EMAILS_STORE).get(`${scope}:${folder}:${uid}`);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  async cacheFolders(folders: ImapFolder[]): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const scope = this.getAccountScope();
    const tx = this.db.transaction(FOLDERS_STORE, 'readwrite');
    const store = tx.objectStore(FOLDERS_STORE);
    for (const folder of folders) {
      store.put({ ...folder, key: `${scope}:${folder.path}`, scope });
    }
  }

  async getCachedFolders(): Promise<ImapFolder[]> {
    await this.dbReady;
    if (!this.db) return [];
    const scope = this.getAccountScope();
    return new Promise((resolve) => {
      const tx = this.db!.transaction(FOLDERS_STORE, 'readonly');
      const request = tx.objectStore(FOLDERS_STORE).index('scope').getAll(scope);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  async addToOutbox(email: { id: string; to: string; subject: string; body: string; cc?: string; bcc?: string }): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const scope = this.getAccountScope();
    const tx = this.db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).put({ ...email, key: `${scope}:${email.id}`, scope });
    this.refreshOutboxCount();
  }

  async getOutbox(): Promise<any[]> {
    await this.dbReady;
    if (!this.db) return [];
    const scope = this.getAccountScope();
    return new Promise((resolve) => {
      const tx = this.db!.transaction(OUTBOX_STORE, 'readonly');
      const request = tx.objectStore(OUTBOX_STORE).index('scope').getAll(scope);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  async removeFromOutbox(id: string): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const scope = this.getAccountScope();
    const tx = this.db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).delete(`${scope}:${id}`);
    this.refreshOutboxCount();
  }

  private async refreshOutboxCount(): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const tx = this.db.transaction(OUTBOX_STORE, 'readonly');
    const request = tx.objectStore(OUTBOX_STORE).index('scope').count(this.getAccountScope());
    request.onsuccess = () => this.outboxCount.set(request.result);
  }

  private getAccountScope(): string {
    const userId = this.auth.user()?.id ?? 'anonymous';
    const accountId = this.settingsService.activeAccountId() ?? 'default';
    return `${userId}:${accountId}`;
  }
}
