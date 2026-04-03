import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { Email, ImapFolder, FolderStatus, EmailListResponse } from '../models/email.model';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class EmailService {
  private readonly http = inject(HttpClient);
  private readonly settingsService = inject(SettingsService);
  private readonly apiUrl = environment.apiUrl;

  readonly loading = signal(false);
  readonly folders = signal<ImapFolder[]>([]);
  readonly folderStatuses = signal<Map<string, FolderStatus>>(new Map());
  readonly currentEmails = signal<Email[]>([]);
  readonly selectedEmail = signal<Email | null>(null);
  readonly currentTotal = signal(0);
  readonly currentPage = signal(1);

  private trashFolder = '';

  async fetchFolders(): Promise<void> {
    if (!this.settingsService.activeAccountId()) return;
    try {
      const folders = await firstValueFrom(
        this.http.get<ImapFolder[]>(`${this.apiUrl}/folders`, { withCredentials: true })
      );
      this.folders.set(folders);

      // Find trash folder
      const trash = folders.find(
        (f) => f.specialUse === '\\Trash' || f.path.toLowerCase() === 'trash'
      );
      if (trash) this.trashFolder = trash.path;

      // Fetch statuses for important folders
      this.fetchFolderStatuses(folders);
    } catch (err) {
      console.error('Failed to fetch folders', err);
    }
  }

  private async fetchFolderStatuses(folders: ImapFolder[]): Promise<void> {
    const statusMap = new Map<string, FolderStatus>();
    for (const folder of folders) {
      try {
        const status = await firstValueFrom(
          this.http.get<FolderStatus>(
            `${this.apiUrl}/folders/${encodeURIComponent(folder.path)}/status`,
            { withCredentials: true }
          )
        );
        statusMap.set(folder.path, status);
      } catch {
        // skip
      }
    }
    this.folderStatuses.set(statusMap);
  }

  async fetchEmails(folder: string, query = '', page = 1): Promise<void> {
    if (!this.settingsService.activeAccountId()) {
      this.currentEmails.set([]);
      this.currentTotal.set(0);
      return;
    }
    this.loading.set(true);
    try {
      const pageSize = this.settingsService.pageSize;
      let params = new HttpParams()
        .set('page', String(page))
        .set('pageSize', String(pageSize));
      if (query) params = params.set('q', query);

      const res = await firstValueFrom(
        this.http.get<EmailListResponse>(
          `${this.apiUrl}/emails/${encodeURIComponent(folder)}`,
          { params, withCredentials: true }
        )
      );

      if (page > 1) {
        this.currentEmails.update((prev) => [...prev, ...res.emails]);
      } else {
        this.currentEmails.set(res.emails);
      }
      this.currentTotal.set(res.total);
      this.currentPage.set(page);
    } catch (err) {
      console.error('Failed to fetch emails', err);
    } finally {
      this.loading.set(false);
    }
  }

  async fetchEmail(folder: string, uid: number): Promise<Email | null> {
    if (!this.settingsService.activeAccountId()) return null;
    try {
      return await firstValueFrom(
        this.http.get<Email>(
          `${this.apiUrl}/email/${encodeURIComponent(folder)}/${uid}`,
          { withCredentials: true }
        )
      );
    } catch (err) {
      console.error('Failed to fetch email', err);
      return null;
    }
  }

  async markAsRead(email: Email): Promise<void> {
    if (email.isRead) return;
    await this.setFlag(email, '\\Seen', true);
    this.currentEmails.update((emails) =>
      emails.map((e) => (e.uid === email.uid && e.folder === email.folder ? { ...e, isRead: true } : e))
    );
  }

  async markAsUnread(email: Email): Promise<void> {
    await this.setFlag(email, '\\Seen', false);
    this.currentEmails.update((emails) =>
      emails.map((e) => (e.uid === email.uid && e.folder === email.folder ? { ...e, isRead: false } : e))
    );
  }

  async toggleStar(email: Email): Promise<void> {
    const newValue = !email.isStarred;
    await this.setFlag(email, '\\Flagged', newValue);
    this.currentEmails.update((emails) =>
      emails.map((e) =>
        e.uid === email.uid && e.folder === email.folder ? { ...e, isStarred: newValue } : e
      )
    );
    if (this.selectedEmail()?.uid === email.uid) {
      this.selectedEmail.update((e) => (e ? { ...e, isStarred: newValue } : e));
    }
  }

  async moveToFolder(email: Email, destination: string): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.apiUrl}/email/${encodeURIComponent(email.folder)}/${email.uid}/move`,
        { destination },
        { withCredentials: true }
      )
    );
    this.currentEmails.update((emails) =>
      emails.filter((e) => !(e.uid === email.uid && e.folder === email.folder))
    );
  }

  async trashEmail(email: Email): Promise<void> {
    if (this.trashFolder) {
      await this.moveToFolder(email, this.trashFolder);
    } else {
      await firstValueFrom(
        this.http.delete(
          `${this.apiUrl}/email/${encodeURIComponent(email.folder)}/${email.uid}`,
          { withCredentials: true }
        )
      );
      this.currentEmails.update((emails) =>
        emails.filter((e) => !(e.uid === email.uid && e.folder === email.folder))
      );
    }
    if (this.selectedEmail()?.uid === email.uid) {
      this.selectedEmail.set(null);
    }
  }

  readonly pendingSends = signal<{ id: string; to: string; subject: string; timeoutId: any; cancel: () => void }[]>([]);

  async sendEmail(
    to: string,
    subject: string,
    text: string,
    cc = '',
    bcc = '',
    inReplyTo = '',
    references = '',
    delayMs = 0
  ): Promise<void> {
    if (delayMs > 0) {
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substring(2, 9);
        const timeoutId = setTimeout(async () => {
          this.pendingSends.update(sends => sends.filter(s => s.id !== id));
          try {
            await this.executeSend(to, subject, text, cc, bcc, inReplyTo, references);
            resolve();
          } catch (e) {
            reject(e);
          }
        }, delayMs);

        const cancel = () => {
          clearTimeout(timeoutId);
          this.pendingSends.update(sends => sends.filter(s => s.id !== id));
          resolve(); // Resolve instead of reject to treat cancellation as a handled case
        };

        this.pendingSends.update(sends => [...sends, { id, to, subject, timeoutId, cancel }]);
      });
    } else {
      await this.executeSend(to, subject, text, cc, bcc, inReplyTo, references);
    }
  }

  private async executeSend(
    to: string,
    subject: string,
    text: string,
    cc = '',
    bcc = '',
    inReplyTo = '',
    references = ''
  ): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.apiUrl}/send`,
        { to, subject, text, cc: cc || undefined, bcc: bcc || undefined, inReplyTo: inReplyTo || undefined, references: references || undefined },
        { withCredentials: true }
      )
    );
  }

  async createFolder(name: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/folders`, { name }, { withCredentials: true })
    );
    await this.fetchFolders();
  }

  async deleteFolder(path: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.apiUrl}/folders/${encodeURIComponent(path)}`, { withCredentials: true })
    );
    await this.fetchFolders();
  }

  hasMoreEmails(): boolean {
    return this.currentEmails().length < this.currentTotal();
  }

  private async setFlag(email: Email, flag: string, value: boolean): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.apiUrl}/email/${encodeURIComponent(email.folder)}/${email.uid}/flag`,
        { flag, value },
        { withCredentials: true }
      )
    );
  }
}
