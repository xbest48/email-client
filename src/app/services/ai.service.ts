import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { SettingsService } from './settings.service';

export type AiConfidence = 'low' | 'medium' | 'high';

export interface AiComposeOptions {
  currentDraft?: string;
  tone?: string;
}

export interface AiActionItem {
  title: string;
  details: string;
  kind: 'task' | 'meeting' | 'deadline' | 'follow_up';
  dueDate: string | null;
  confidence: AiConfidence;
}

export interface AiCategoryResult {
  category: string;
  confidence: AiConfidence;
  reason: string;
}

export interface AiPhishingResult {
  level: 'low' | 'medium' | 'high';
  reason: string;
  indicators: string[];
}

export interface EmailTriageInput {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  messageId?: string;
  folder?: string;
  uid?: number;
}

export interface EmailTriageResult {
  id: string;
  category: string;
  urgency: AiConfidence;
  confidence: AiConfidence;
  phishingLevel: 'low' | 'medium' | 'high';
  reason: string;
}

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private readonly http = inject(HttpClient);
  private readonly settingsService = inject(SettingsService);
  private readonly apiUrl = `${environment.apiUrl}/ai`;

  private getHeaders(): HttpHeaders {
    const accountId = this.settingsService.activeAccountId();
    let headers = new HttpHeaders();
    if (accountId) headers = headers.set('x-account-id', accountId);
    return headers;
  }

  async compose(prompt: string, options: AiComposeOptions = {}): Promise<string> {
    const res = await firstValueFrom(
      this.http.post<{ result: string }>(`${this.apiUrl}/compose`, {
        prompt,
        currentDraft: options.currentDraft,
        tone: options.tone,
      }, { headers: this.getHeaders() })
    );
    return res.result;
  }

  async summarize(emailContent: string): Promise<string> {
    const res = await firstValueFrom(this.http.post<{ result: string }>(`${this.apiUrl}/summarize`, { emailContent }, { headers: this.getHeaders() }));
    return res.result;
  }

  async reply(emailContent: string): Promise<string[]> {
    const res = await firstValueFrom(this.http.post<{ result: string[] }>(`${this.apiUrl}/reply`, { emailContent }, { headers: this.getHeaders() }));
    return res.result;
  }

  async extract(emailContent: string): Promise<AiActionItem[]> {
    const res = await firstValueFrom(
      this.http.post<{ result: AiActionItem[] }>(
        `${this.apiUrl}/extract`,
        { emailContent },
        { headers: this.getHeaders() }
      )
    );
    return res.result;
  }

  async translate(emailContent: string, targetLanguage: string): Promise<string> {
    const res = await firstValueFrom(this.http.post<{ result: string }>(`${this.apiUrl}/translate`, { emailContent, targetLanguage }, { headers: this.getHeaders() }));
    return res.result;
  }

  async categorize(
    emailContent: string,
    metadata?: { messageId?: string; folder?: string; uid?: number },
  ): Promise<AiCategoryResult> {
    const res = await firstValueFrom(
      this.http.post<{ result: AiCategoryResult }>(
        `${this.apiUrl}/categorize`,
        {
          emailContent,
          messageId: metadata?.messageId,
          folder: metadata?.folder,
          uid: metadata?.uid,
        },
        { headers: this.getHeaders() }
      )
    );
    return res.result;
  }

  async phishing(emailContent: string): Promise<AiPhishingResult> {
    const res = await firstValueFrom(
      this.http.post<{ result: AiPhishingResult }>(`${this.apiUrl}/phishing`, { emailContent }, { headers: this.getHeaders() })
    );
    return res.result;
  }

  async triage(emails: EmailTriageInput[]): Promise<EmailTriageResult[]> {
    const res = await firstValueFrom(
      this.http.post<{ result: EmailTriageResult[] }>(`${this.apiUrl}/triage`, { emails }, { headers: this.getHeaders() })
    );
    return res.result;
  }
}
