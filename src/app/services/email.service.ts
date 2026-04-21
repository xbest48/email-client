import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders, HttpEventType, HttpResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../environments/environment';
import { Email, ImapFolder, FolderStatus, EmailListResponse } from '../models/email.model';
import { SettingsService } from './settings.service';
import { OfflineService } from './offline.service';

@Injectable({ providedIn: 'root' })
export class EmailService {
  private readonly http = inject(HttpClient);
  private readonly settingsService = inject(SettingsService);
  private readonly offlineService = inject(OfflineService);
  private readonly apiUrl = environment.apiUrl;

  readonly loading = signal(false);
  readonly folders = signal<ImapFolder[]>([]);
  readonly folderStatuses = signal<Map<string, FolderStatus>>(new Map());
  readonly currentEmails = signal<Email[]>([]);
  readonly selectedEmail = signal<Email | null>(null);
  readonly currentTotal = signal(0);
  readonly currentPage = signal(1);
  readonly savedScrollState = signal<{ folder: string; scrollTop: number } | null>(null);
  readonly savedListState = signal<{ folder: string; query: string; page: number } | null>(null);
  /**
   * One-shot hint used to pre-fill the compose modal (currently only the
   * recipient). Setting it opens the modal via an effect in LayoutComponent,
   * and ComposeComponent reads & clears it on init. Each set creates a new
   * object reference so the effect fires even when opening to the same
   * address twice in a row.
   */
  readonly composePrefill = signal<{ to?: string } | null>(null);

  private trashFolder = '';
  private fetchRequestId = 0;

  private getSpecialFolderPath(specialUse: string): string | null {
    return this.folders().find((folder) => folder.specialUse === specialUse)?.path ?? null;
  }

  private getInboxFolderPath(): string {
    return this.getSpecialFolderPath('\\Inbox')
      ?? this.folders().find((folder) => folder.path.toLowerCase() === 'inbox')?.path
      ?? 'INBOX';
  }

  private getHeaders() {
    const accountId = this.settingsService.activeAccountId();
    let headers = new HttpHeaders();
    if (accountId) {
      headers = headers.set('x-account-id', accountId);
    }
    return headers;
  }

  get currentPageSize(): number {
    return this.settingsService.pageSize;
  }


  async fetchFolders(): Promise<void> {
    await this.settingsService.loadPromise;
    if (!this.settingsService.activeAccountId()) return;
    try {
      const folders = await firstValueFrom(
        this.http.get<ImapFolder[]>(`${this.apiUrl}/folders`, { headers: this.getHeaders(), withCredentials: true })
      );
      this.folders.set(folders);
      this.offlineService.cacheFolders(folders);

      // Find trash folder
      const trash = folders.find(
        (f) => f.specialUse === '\\Trash' || f.path.toLowerCase() === 'trash'
      );
      if (trash) this.trashFolder = trash.path;

      // Fetch statuses for important folders
      this.fetchFolderStatuses(folders);
    } catch (err) {
      console.error('Failed to fetch folders', err);
      // Fallback to cached folders
      const cached = await this.offlineService.getCachedFolders();
      if (cached.length) this.folders.set(cached);
    }
  }

  private async fetchFolderStatuses(folders: ImapFolder[]): Promise<void> {
    const statusMap = new Map<string, FolderStatus>();
    for (const folder of folders) {
      try {
        const status = await firstValueFrom(
          this.http.get<FolderStatus>(
            `${this.apiUrl}/folders/${encodeURIComponent(folder.path)}/status`,
            { headers: this.getHeaders(), withCredentials: true }
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
    await this.settingsService.loadPromise;
    if (!this.settingsService.activeAccountId()) {
      this.currentEmails.set([]);
      this.currentTotal.set(0);
      this.loading.set(false);
      return;
    }
    const requestId = ++this.fetchRequestId;
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
          { params, headers: this.getHeaders(), withCredentials: true }
        ).pipe(timeout(15000))
      );

      if (requestId !== this.fetchRequestId) return;

      if (page > 1) {
        this.currentEmails.update((prev) => {
          const existing = new Set(prev.map(e => `${e.folder}:${e.uid}`));
          const newEmails = res.emails.filter(e => !existing.has(`${e.folder}:${e.uid}`));
          return [...prev, ...newEmails];
        });
      } else {
        this.currentEmails.set(res.emails);
      }
      this.currentTotal.set(res.total);
      this.currentPage.set(page);
      this.offlineService.cacheEmails(folder, res.emails);
    } catch (err) {
      console.error('Failed to fetch emails', err);
      if (requestId !== this.fetchRequestId) return;
      if (page === 1) {
        const cached = await this.offlineService.getCachedEmails(folder);
        if (cached.length) {
          this.currentEmails.set(cached);
          this.currentTotal.set(cached.length);
        } else {
          this.currentEmails.set([]);
          this.currentTotal.set(0);
        }
      }
    } finally {
      if (requestId === this.fetchRequestId) {
        this.loading.set(false);
      }
    }
  }

  async fetchEmail(folder: string, uid: number): Promise<Email | null> {
    if (!this.settingsService.activeAccountId()) return null;
    try {
      const email = await firstValueFrom(
        this.http.get<Email>(
          `${this.apiUrl}/email/${encodeURIComponent(folder)}/${uid}`,
          { headers: this.getHeaders(), withCredentials: true }
        )
      );
      if (email) this.offlineService.cacheEmail(email);
      return email;
    } catch (err) {
      console.error('Failed to fetch email', err);
      return this.offlineService.getCachedEmail(folder, uid);
    }
  }

  async markAsRead(email: Email): Promise<void> {
    if (email.isRead) return;
    await this.setFlag(email, '\\Seen', true);
    this.updateEmailState(email, { isRead: true });
    this.adjustFolderUnseenCount(email.folder, -1);
  }

  async markAsUnread(email: Email): Promise<void> {
    if (!email.isRead) return;
    await this.setFlag(email, '\\Seen', false);
    this.updateEmailState(email, { isRead: false });
    this.adjustFolderUnseenCount(email.folder, 1);
  }

  async toggleStar(email: Email): Promise<void> {
    const newValue = !email.isStarred;
    this.updateEmailState(email, { isStarred: newValue });

    try {
      await this.setFlag(email, '\\Flagged', newValue);
    } catch (err) {
      this.updateEmailState(email, { isStarred: email.isStarred });
      throw err;
    }
  }

  async moveToFolder(email: Email, destination: string): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.apiUrl}/email/${encodeURIComponent(email.folder)}/${email.uid}/move`,
        { destination },
        { headers: this.getHeaders(), withCredentials: true }
      )
    );
    this.currentEmails.update((emails) =>
      emails.filter((e) => !(e.uid === email.uid && e.folder === email.folder))
    );
    this.currentTotal.update((total) => Math.max(0, total - 1));
    this.adjustFolderMessageCount(email.folder, -1);
    if (!email.isRead) {
      this.adjustFolderUnseenCount(email.folder, -1);
    }
    if (destination && destination !== email.folder) {
      this.adjustFolderMessageCount(destination, 1);
      if (!email.isRead) {
        this.adjustFolderUnseenCount(destination, 1);
      }
    }
  }

  async spamEmail(email: Email): Promise<void> {
    const junkFolder = this.getSpecialFolderPath('\\Junk');
    if (!junkFolder) {
      throw new Error('Dossier Spam introuvable');
    }
    await this.moveToFolder(email, junkFolder);
    if (this.selectedEmail()?.uid === email.uid) {
      this.selectedEmail.set(null);
    }
  }

  async markAsNotSpam(email: Email): Promise<void> {
    const inboxFolder = this.getInboxFolderPath();
    await this.moveToFolder(email, inboxFolder);
    if (this.selectedEmail()?.uid === email.uid) {
      this.selectedEmail.set(null);
    }
  }

  async trashEmail(email: Email): Promise<void> {
    if (this.trashFolder) {
      await this.moveToFolder(email, this.trashFolder);
    } else {
      await firstValueFrom(
        this.http.delete(
          `${this.apiUrl}/email/${encodeURIComponent(email.folder)}/${email.uid}`,
          { headers: this.getHeaders(), withCredentials: true }
        )
      );
      this.currentEmails.update((emails) =>
        emails.filter((e) => !(e.uid === email.uid && e.folder === email.folder))
      );
      this.currentTotal.update((total) => Math.max(0, total - 1));
    }
    if (this.selectedEmail()?.uid === email.uid) {
      this.selectedEmail.set(null);
    }
  }

  bulkTrashInBackground(emails: Email[]): void {
    const keys = new Set(emails.map(e => `${e.folder}:${e.uid}`));
    this.currentEmails.update(list => list.filter(e => !keys.has(`${e.folder}:${e.uid}`)));
    this.currentTotal.update((total) => Math.max(0, total - keys.size));
    if (this.selectedEmail() && keys.has(`${this.selectedEmail()!.folder}:${this.selectedEmail()!.uid}`)) {
      this.selectedEmail.set(null);
    }
    this.adjustFolderStatusesForBulkMove(emails, this.trashFolder || null);
    for (const email of emails) {
      const promise = this.trashFolder
        ? firstValueFrom(
            this.http.post(
              `${this.apiUrl}/email/${encodeURIComponent(email.folder)}/${email.uid}/move`,
              { destination: this.trashFolder },
              { headers: this.getHeaders(), withCredentials: true }
            )
          )
        : firstValueFrom(
            this.http.delete(
              `${this.apiUrl}/email/${encodeURIComponent(email.folder)}/${email.uid}`,
              { headers: this.getHeaders(), withCredentials: true }
            )
          );
      promise.catch(err => console.error('Background trash failed', err));
    }
  }

  bulkSpamInBackground(emails: Email[]): void {
    const junkFolder = this.getSpecialFolderPath('\\Junk');
    if (!junkFolder) {
      console.error('Background spam failed', new Error('Dossier Spam introuvable'));
      return;
    }
    const keys = new Set(emails.map(e => `${e.folder}:${e.uid}`));
    this.currentEmails.update(list => list.filter(e => !keys.has(`${e.folder}:${e.uid}`)));
    this.currentTotal.update((total) => Math.max(0, total - keys.size));
    if (this.selectedEmail() && keys.has(`${this.selectedEmail()!.folder}:${this.selectedEmail()!.uid}`)) {
      this.selectedEmail.set(null);
    }
    this.adjustFolderStatusesForBulkMove(emails, junkFolder);
    for (const email of emails) {
      firstValueFrom(
        this.http.post(
          `${this.apiUrl}/email/${encodeURIComponent(email.folder)}/${email.uid}/move`,
          { destination: junkFolder },
          { headers: this.getHeaders(), withCredentials: true }
        )
      ).catch(err => console.error('Background spam failed', err));
    }
  }

  bulkNotSpamInBackground(emails: Email[]): void {
    const inboxFolder = this.getInboxFolderPath();
    const keys = new Set(emails.map(e => `${e.folder}:${e.uid}`));
    this.currentEmails.update(list => list.filter(e => !keys.has(`${e.folder}:${e.uid}`)));
    this.currentTotal.update((total) => Math.max(0, total - keys.size));
    if (this.selectedEmail() && keys.has(`${this.selectedEmail()!.folder}:${this.selectedEmail()!.uid}`)) {
      this.selectedEmail.set(null);
    }
    this.adjustFolderStatusesForBulkMove(emails, inboxFolder);
    for (const email of emails) {
      firstValueFrom(
        this.http.post(
          `${this.apiUrl}/email/${encodeURIComponent(email.folder)}/${email.uid}/move`,
          { destination: inboxFolder },
          { headers: this.getHeaders(), withCredentials: true }
        )
      ).catch(err => console.error('Background not-spam failed', err));
    }
  }

  readonly pendingSends = signal<{ id: string; to: string; subject: string; timeoutId: any; cancel: () => void }[]>([]);

  async saveDraftMessage(
    to: string,
    subject: string,
    html: string,
    cc = '',
    bcc = '',
    previous?: { folder: string; uid: number | null } | null,
  ): Promise<{ folder: string; uid: number | null }> {
    return await firstValueFrom(
      this.http.post<{ folder: string; uid: number | null }>(
        `${this.apiUrl}/draft`,
        {
          to: to || undefined,
          subject,
          html,
          cc: cc || undefined,
          bcc: bcc || undefined,
          previousFolder: previous?.folder,
          previousUid: previous?.uid ?? undefined,
        },
        { headers: this.getHeaders(), withCredentials: true },
      )
    );
  }

  async deleteDraftMessage(folder: string, uid: number): Promise<void> {
    await firstValueFrom(
      this.http.delete(
        `${this.apiUrl}/draft/${encodeURIComponent(folder)}/${uid}`,
        { headers: this.getHeaders(), withCredentials: true },
      )
    );
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    cc = '',
    bcc = '',
    inReplyTo = '',
    references = '',
    delayMs = 0,
    attachments: File[] = [],
    requestReadReceipt = false
  ): Promise<void> {
    if (delayMs > 0) {
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substring(2, 9);
        const timeoutId = setTimeout(async () => {
          this.pendingSends.update(sends => sends.filter(s => s.id !== id));
          try {
            await this.executeSend(to, subject, html, cc, bcc, inReplyTo, references, attachments, requestReadReceipt);
            resolve();
          } catch (e) {
            reject(e);
          }
        }, delayMs);

        const cancel = () => {
          clearTimeout(timeoutId);
          this.pendingSends.update(sends => sends.filter(s => s.id !== id));
          resolve();
        };

        this.pendingSends.update(sends => [...sends, { id, to, subject, timeoutId, cancel }]);
      });
    } else {
      await this.executeSend(to, subject, html, cc, bcc, inReplyTo, references, attachments, requestReadReceipt);
    }
  }

  private async executeSend(
    to: string,
    subject: string,
    html: string,
    cc = '',
    bcc = '',
    inReplyTo = '',
    references = '',
    attachments: File[] = [],
    requestReadReceipt = false
  ): Promise<void> {
    if (attachments.length > 0) {
      // Use FormData for multipart upload with attachments
      const formData = new FormData();
      formData.append('to', to);
      formData.append('subject', subject);
      formData.append('html', html);
      if (cc) formData.append('cc', cc);
      if (bcc) formData.append('bcc', bcc);
      if (inReplyTo) formData.append('inReplyTo', inReplyTo);
      if (references) formData.append('references', references);
      if (requestReadReceipt) formData.append('requestReadReceipt', 'true');
      for (const file of attachments) {
        formData.append('files', file, file.name);
      }
      // Don't set Content-Type header — browser sets multipart boundary automatically
      const accountId = this.settingsService.activeAccountId();
      let headers = new HttpHeaders();
      if (accountId) headers = headers.set('x-account-id', accountId);
      await firstValueFrom(
        this.http.post(`${this.apiUrl}/send`, formData, { headers, withCredentials: true })
      );
    } else {
      await firstValueFrom(
        this.http.post(
          `${this.apiUrl}/send`,
          { to, subject, html, cc: cc || undefined, bcc: bcc || undefined, inReplyTo: inReplyTo || undefined, references: references || undefined, requestReadReceipt: requestReadReceipt || undefined },
          { headers: this.getHeaders(), withCredentials: true }
        )
      );
    }
  }

  async createFolder(name: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/folders`, { name }, { headers: this.getHeaders(), withCredentials: true })
    );
    await this.fetchFolders();
  }

  async deleteFolder(path: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.apiUrl}/folders/${encodeURIComponent(path)}`, { headers: this.getHeaders(), withCredentials: true })
    );
    await this.fetchFolders();
  }

  async emptyTrash(): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.apiUrl}/trash`, { headers: this.getHeaders(), withCredentials: true })
    );
    const current = this.selectedEmail();
    if (current?.folder && this.folders().some((f) => f.path === current.folder && f.specialUse === '\\Trash')) {
      this.selectedEmail.set(null);
    }
  }

  async downloadFolderArchive(
    folder: string,
    fileName?: string,
    onProgress?: (progress: number | null) => void,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.http.get(
        `${this.apiUrl}/folders/${encodeURIComponent(folder)}/archive`,
        {
          headers: this.getHeaders(),
          withCredentials: true,
          responseType: 'blob',
          observe: 'events',
          reportProgress: true,
        }
      ).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.DownloadProgress) {
            if (typeof event.total === 'number' && event.total > 0) {
              onProgress?.(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
            } else {
              onProgress?.(null);
            }
            return;
          }

          if (event instanceof HttpResponse) {
            const blob = event.body;
            if (!blob) {
              reject(new Error('Archive vide'));
              return;
            }

            onProgress?.(100);
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = fileName || `${folder.replace(/[\\/]/g, '_') || 'dossier'}.mbox`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            resolve();
          }
        },
        error: (err) => reject(err),
      });
    });
  }

  hasMoreEmails(): boolean {
    return this.currentEmails().length < this.currentTotal();
  }

  getAttachmentUrl(folder: string, uid: number, attachmentId: string): string {
    return `${this.apiUrl}/email/${encodeURIComponent(folder)}/${uid}/attachment/${attachmentId}`;
  }

  async fetchAttachmentBlob(folder: string, uid: number, attachmentId: string): Promise<string> {
    const blob = await firstValueFrom(
      this.http.get(
        `${this.apiUrl}/email/${encodeURIComponent(folder)}/${uid}/attachment/${attachmentId}`,
        { headers: this.getHeaders(), withCredentials: true, responseType: 'blob' }
      )
    );
    return URL.createObjectURL(blob);
  }

  async fetchThread(folder: string, uid: number): Promise<Email[]> {
    try {
      return await firstValueFrom(
        this.http.get<Email[]>(
          `${this.apiUrl}/email/${encodeURIComponent(folder)}/${uid}/thread`,
          { headers: this.getHeaders(), withCredentials: true }
        )
      );
    } catch {
      return [];
    }
  }

  private async setFlag(email: Email, flag: string, value: boolean): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.apiUrl}/email/${encodeURIComponent(email.folder)}/${email.uid}/flag`,
        { flag, value },
        { headers: this.getHeaders(), withCredentials: true }
      )
    );
  }

  private updateEmailState(email: Email, patch: Partial<Email>): void {
    this.currentEmails.update((emails) =>
      emails.map((e) =>
        e.uid === email.uid && e.folder === email.folder ? { ...e, ...patch } : e
      )
    );

    this.selectedEmail.update((selected) =>
      selected && selected.uid === email.uid && selected.folder === email.folder
        ? { ...selected, ...patch }
        : selected
    );
  }

  private adjustFolderStatusesForBulkMove(emails: Email[], destination: string | null): void {
    const sourceStats = new Map<string, { messages: number; unseen: number }>();

    for (const email of emails) {
      const current = sourceStats.get(email.folder) ?? { messages: 0, unseen: 0 };
      current.messages += 1;
      if (!email.isRead) {
        current.unseen += 1;
      }
      sourceStats.set(email.folder, current);
    }

    for (const [folder, stats] of sourceStats.entries()) {
      this.adjustFolderMessageCount(folder, -stats.messages);
      if (stats.unseen > 0) {
        this.adjustFolderUnseenCount(folder, -stats.unseen);
      }
    }

    if (!destination) return;

    this.adjustFolderMessageCount(destination, emails.length);
    const unreadCount = emails.filter((email) => !email.isRead).length;
    if (unreadCount > 0) {
      this.adjustFolderUnseenCount(destination, unreadCount);
    }
  }

  private adjustFolderMessageCount(folderPath: string, delta: number): void {
    if (!delta) return;
    this.folderStatuses.update((statuses) => {
      const current = statuses.get(folderPath);
      if (!current) return statuses;

      const next = new Map(statuses);
      next.set(folderPath, {
        ...current,
        messages: Math.max(0, current.messages + delta),
      });
      return next;
    });
  }

  private adjustFolderUnseenCount(folderPath: string, delta: number): void {
    if (!delta) return;
    this.folderStatuses.update((statuses) => {
      const current = statuses.get(folderPath);
      if (!current) return statuses;

      const next = new Map(statuses);
      next.set(folderPath, {
        ...current,
        unseen: Math.max(0, current.unseen + delta),
      });
      return next;
    });
  }
}
