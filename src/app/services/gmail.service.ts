import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../environments/environment';
import { Email, EmailAddress, Label, Attachment } from '../models/email.model';

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: GmailPayload;
  internalDate: string;
}

interface GmailPayload {
  headers: { name: string; value: string }[];
  mimeType: string;
  body: { data?: string; size: number; attachmentId?: string };
  parts?: GmailPayload[];
  filename?: string;
}

interface GmailListResponse {
  messages: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

interface GmailLabelsResponse {
  labels: GmailLabel[];
}

interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messagesTotal: number;
  messagesUnread: number;
  color?: { textColor: string; backgroundColor: string };
}

@Injectable({ providedIn: 'root' })
export class GmailService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly apiUrl = environment.gmailApiUrl;

  readonly loading = signal(false);
  readonly labels = signal<Label[]>([]);
  readonly currentEmails = signal<Email[]>([]);
  readonly selectedEmail = signal<Email | null>(null);
  readonly nextPageToken = signal<string>('');

  private get headers() {
    return this.auth.getAuthHeaders();
  }

  async fetchLabels(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<GmailLabelsResponse>(`${this.apiUrl}/users/me/labels`, {
          headers: this.headers,
        })
      );
      const enriched = await Promise.all(
        res.labels.map(async (l) => {
          try {
            const detail = await firstValueFrom(
              this.http.get<GmailLabel>(`${this.apiUrl}/users/me/labels/${l.id}`, {
                headers: this.headers,
              })
            );
            return this.mapLabel(detail);
          } catch {
            return this.mapLabel(l);
          }
        })
      );
      this.labels.set(enriched);
    } catch (err) {
      console.error('Failed to fetch labels', err);
    }
  }

  async fetchEmails(labelId: string, query = '', pageToken = ''): Promise<void> {
    this.loading.set(true);
    try {
      let params = new HttpParams().set('maxResults', '50');
      if (labelId) params = params.set('labelIds', labelId);
      if (query) params = params.set('q', query);
      if (pageToken) params = params.set('pageToken', pageToken);

      const res = await firstValueFrom(
        this.http.get<GmailListResponse>(`${this.apiUrl}/users/me/messages`, {
          headers: this.headers,
          params,
        })
      );

      this.nextPageToken.set(res.nextPageToken ?? '');

      if (!res.messages?.length) {
        if (!pageToken) this.currentEmails.set([]);
        this.loading.set(false);
        return;
      }

      const emails = await Promise.all(
        res.messages.map((m) => this.fetchMessage(m.id))
      );

      if (pageToken) {
        this.currentEmails.update((prev) => [...prev, ...emails.filter(Boolean) as Email[]]);
      } else {
        this.currentEmails.set(emails.filter(Boolean) as Email[]);
      }
    } catch (err) {
      console.error('Failed to fetch emails', err);
    } finally {
      this.loading.set(false);
    }
  }

  async fetchMessage(id: string): Promise<Email | null> {
    try {
      const msg = await firstValueFrom(
        this.http.get<GmailMessage>(`${this.apiUrl}/users/me/messages/${id}`, {
          headers: this.headers,
          params: new HttpParams().set('format', 'full'),
        })
      );
      return this.parseMessage(msg);
    } catch (err) {
      console.error('Failed to fetch message', id, err);
      return null;
    }
  }

  async sendEmail(to: string, subject: string, body: string, cc = '', bcc = ''): Promise<void> {
    const headers = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : '',
      bcc ? `Bcc: ${bcc}` : '',
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
    ]
      .filter(Boolean)
      .join('\r\n');

    const raw = btoa(unescape(encodeURIComponent(headers)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await firstValueFrom(
      this.http.post(`${this.apiUrl}/users/me/messages/send`, { raw }, { headers: this.headers })
    );
  }

  async toggleStar(email: Email): Promise<void> {
    const addLabels = email.isStarred ? [] : ['STARRED'];
    const removeLabels = email.isStarred ? ['STARRED'] : [];
    await this.modifyMessage(email.id, addLabels, removeLabels);
    this.currentEmails.update((emails) =>
      emails.map((e) => (e.id === email.id ? { ...e, isStarred: !e.isStarred } : e))
    );
    if (this.selectedEmail()?.id === email.id) {
      this.selectedEmail.update((e) => (e ? { ...e, isStarred: !e.isStarred } : e));
    }
  }

  async markAsRead(email: Email): Promise<void> {
    if (email.isRead) return;
    await this.modifyMessage(email.id, [], ['UNREAD']);
    this.currentEmails.update((emails) =>
      emails.map((e) => (e.id === email.id ? { ...e, isRead: true } : e))
    );
  }

  async markAsUnread(email: Email): Promise<void> {
    await this.modifyMessage(email.id, ['UNREAD'], []);
    this.currentEmails.update((emails) =>
      emails.map((e) => (e.id === email.id ? { ...e, isRead: false } : e))
    );
  }

  async trashMessage(email: Email): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/users/me/messages/${email.id}/trash`, {}, { headers: this.headers })
    );
    this.currentEmails.update((emails) => emails.filter((e) => e.id !== email.id));
    if (this.selectedEmail()?.id === email.id) {
      this.selectedEmail.set(null);
    }
  }

  async archiveMessage(email: Email): Promise<void> {
    await this.modifyMessage(email.id, [], ['INBOX']);
    this.currentEmails.update((emails) => emails.filter((e) => e.id !== email.id));
  }

  async moveToLabel(email: Email, labelId: string): Promise<void> {
    await this.modifyMessage(email.id, [labelId], ['INBOX']);
  }

  private async modifyMessage(
    id: string,
    addLabelIds: string[],
    removeLabelIds: string[]
  ): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.apiUrl}/users/me/messages/${id}/modify`,
        { addLabelIds, removeLabelIds },
        { headers: this.headers }
      )
    );
  }

  private parseMessage(msg: GmailMessage): Email {
    const getHeader = (name: string): string =>
      msg.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const from = this.parseEmailAddress(getHeader('From'));
    const to = this.parseEmailAddresses(getHeader('To'));
    const cc = this.parseEmailAddresses(getHeader('Cc'));
    const bcc = this.parseEmailAddresses(getHeader('Bcc'));
    const subject = getHeader('Subject') || '(sans objet)';
    const date = getHeader('Date');

    const { text, html } = this.extractBody(msg.payload);
    const attachments = this.extractAttachments(msg.payload);

    return {
      id: msg.id,
      threadId: msg.threadId,
      from,
      to,
      cc,
      bcc,
      subject,
      snippet: msg.snippet,
      body: text,
      htmlBody: html,
      date: date || new Date(parseInt(msg.internalDate, 10)).toISOString(),
      labels: msg.labelIds ?? [],
      isRead: !msg.labelIds?.includes('UNREAD'),
      isStarred: msg.labelIds?.includes('STARRED') ?? false,
      hasAttachments: attachments.length > 0,
      attachments,
    };
  }

  private extractBody(payload: GmailPayload): { text: string; html: string } {
    let text = '';
    let html = '';

    if (payload.body?.data) {
      const decoded = this.decodeBase64Url(payload.body.data);
      if (payload.mimeType === 'text/html') {
        html = decoded;
      } else {
        text = decoded;
      }
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data && !text) {
          text = this.decodeBase64Url(part.body.data);
        } else if (part.mimeType === 'text/html' && part.body?.data && !html) {
          html = this.decodeBase64Url(part.body.data);
        } else if (part.parts) {
          const nested = this.extractBody(part);
          if (!text && nested.text) text = nested.text;
          if (!html && nested.html) html = nested.html;
        }
      }
    }

    return { text, html };
  }

  private extractAttachments(payload: GmailPayload): Attachment[] {
    const attachments: Attachment[] = [];

    if (payload.filename && payload.body?.attachmentId) {
      attachments.push({
        id: payload.body.attachmentId,
        filename: payload.filename,
        mimeType: payload.mimeType,
        size: payload.body.size,
      });
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        attachments.push(...this.extractAttachments(part));
      }
    }

    return attachments;
  }

  private decodeBase64Url(data: string): string {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  }

  private parseEmailAddress(raw: string): EmailAddress {
    const match = raw.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);
    if (match) {
      return { name: match[1]?.trim() || match[2], email: match[2] };
    }
    return { name: raw, email: raw };
  }

  private parseEmailAddresses(raw: string): EmailAddress[] {
    if (!raw) return [];
    return raw.split(',').map((addr) => this.parseEmailAddress(addr.trim()));
  }

  private mapLabel(l: GmailLabel): Label {
    return {
      id: l.id,
      name: l.name,
      type: l.type === 'system' ? 'system' : 'user',
      messagesTotal: l.messagesTotal ?? 0,
      messagesUnread: l.messagesUnread ?? 0,
      color: l.color?.backgroundColor ?? '',
    };
  }
}
