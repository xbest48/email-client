import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/ai`;

  async compose(prompt: string): Promise<string> {
    const res = await firstValueFrom(this.http.post<{ result: string }>(`${this.apiUrl}/compose`, { prompt }));
    return res.result;
  }

  async summarize(emailContent: string): Promise<string> {
    const res = await firstValueFrom(this.http.post<{ result: string }>(`${this.apiUrl}/summarize`, { emailContent }));
    return res.result;
  }

  async reply(emailContent: string): Promise<string[]> {
    const res = await firstValueFrom(this.http.post<{ result: string[] }>(`${this.apiUrl}/reply`, { emailContent }));
    return res.result;
  }

  async extract(emailContent: string): Promise<string[]> {
    const res = await firstValueFrom(this.http.post<{ result: string[] }>(`${this.apiUrl}/extract`, { emailContent }));
    return res.result;
  }

  async translate(emailContent: string, targetLanguage: string): Promise<string> {
    const res = await firstValueFrom(this.http.post<{ result: string }>(`${this.apiUrl}/translate`, { emailContent, targetLanguage }));
    return res.result;
  }

  async categorize(emailContent: string): Promise<string> {
    const res = await firstValueFrom(this.http.post<{ result: string }>(`${this.apiUrl}/categorize`, { emailContent }));
    return res.result;
  }

  async phishing(emailContent: string): Promise<{ level: 'low' | 'medium' | 'high'; reason: string }> {
    const res = await firstValueFrom(this.http.post<{ result: { level: 'low' | 'medium' | 'high'; reason: string } }>(`${this.apiUrl}/phishing`, { emailContent }));
    return res.result;
  }
}
