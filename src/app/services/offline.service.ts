import { Injectable, signal } from '@angular/core';
import { Email, ImapFolder } from '../models/email.model';

const DB_NAME = 'mailflow_offline';
const DB_VERSION = 1;

@Injectable({ providedIn: 'root' })
export class OfflineService {
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
        if (!db.objectStoreNames.contains('emails')) {
          const store = db.createObjectStore('emails', { keyPath: 'key' });
          store.createIndex('folder', 'folder', { unique: false });
        }
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'path' });
        }
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'id' });
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
    const tx = this.db.transaction('emails', 'readwrite');
    const store = tx.objectStore('emails');
    for (const email of emails) {
      store.put({ ...email, key: `${folder}:${email.uid}`, folder });
    }
  }

  async getCachedEmails(folder: string): Promise<Email[]> {
    await this.dbReady;
    if (!this.db) return [];
    return new Promise((resolve) => {
      const tx = this.db!.transaction('emails', 'readonly');
      const store = tx.objectStore('emails');
      const index = store.index('folder');
      const request = index.getAll(folder);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  async cacheEmail(email: Email): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const tx = this.db.transaction('emails', 'readwrite');
    tx.objectStore('emails').put({
      ...email,
      key: `${email.folder}:${email.uid}`,
    });
  }

  async getCachedEmail(folder: string, uid: number): Promise<Email | null> {
    await this.dbReady;
    if (!this.db) return null;
    return new Promise((resolve) => {
      const tx = this.db!.transaction('emails', 'readonly');
      const request = tx.objectStore('emails').get(`${folder}:${uid}`);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  async cacheFolders(folders: ImapFolder[]): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const tx = this.db.transaction('folders', 'readwrite');
    const store = tx.objectStore('folders');
    for (const folder of folders) store.put(folder);
  }

  async getCachedFolders(): Promise<ImapFolder[]> {
    await this.dbReady;
    if (!this.db) return [];
    return new Promise((resolve) => {
      const tx = this.db!.transaction('folders', 'readonly');
      const request = tx.objectStore('folders').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  async addToOutbox(email: { id: string; to: string; subject: string; body: string; cc?: string; bcc?: string }): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const tx = this.db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').put(email);
    this.refreshOutboxCount();
  }

  async getOutbox(): Promise<any[]> {
    await this.dbReady;
    if (!this.db) return [];
    return new Promise((resolve) => {
      const tx = this.db!.transaction('outbox', 'readonly');
      const request = tx.objectStore('outbox').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  async removeFromOutbox(id: string): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const tx = this.db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').delete(id);
    this.refreshOutboxCount();
  }

  private async refreshOutboxCount(): Promise<void> {
    await this.dbReady;
    if (!this.db) return;
    const tx = this.db.transaction('outbox', 'readonly');
    const request = tx.objectStore('outbox').count();
    request.onsuccess = () => this.outboxCount.set(request.result);
  }
}
