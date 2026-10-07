import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { SettingsService } from './settings.service';

export interface ScheduledEmail {
  id: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  scheduledAt: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  attachmentCount?: number;
}

@Injectable({ providedIn: 'root' })
export class ScheduledService {
  private readonly http = inject(HttpClient);
  private readonly settingsService = inject(SettingsService);
  private readonly apiUrl = environment.apiUrl;

  readonly scheduledEmails = signal<ScheduledEmail[]>([]);

  private getHeaders() {
    const accountId = this.settingsService.activeAccountId();
    let headers = new HttpHeaders();
    if (accountId) headers = headers.set('x-account-id', accountId);
    return headers;
  }

  async fetchScheduled(): Promise<void> {
    try {
      const data = await firstValueFrom(this.http.get<ScheduledEmail[]>(`${this.apiUrl}/scheduled`));
      this.scheduledEmails.set(data);
    } catch { /* ignore */ }
  }

  async schedule(data: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    scheduledAt: Date;
    attachments?: File[];
  }): Promise<void> {
    const { attachments = [], ...fields } = data;
    const payload = { ...fields, scheduledAt: fields.scheduledAt.toISOString() };
    let requestBody: FormData | typeof payload = payload;
    if (attachments.length) {
      // Multipart so files travel as binary, like the immediate send.
      const formData = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        if (value) formData.append(key, value);
      }
      for (const file of attachments) {
        formData.append('files', file, file.name);
      }
      requestBody = formData;
    }
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/scheduled`, requestBody, { headers: this.getHeaders() })
    );
    await this.fetchScheduled();
  }

  async cancel(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.apiUrl}/scheduled/${id}`));
    await this.fetchScheduled();
  }
}
