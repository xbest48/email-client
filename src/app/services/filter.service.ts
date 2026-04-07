import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { SettingsService } from './settings.service';

export interface FilterRule {
  id: string;
  name: string;
  conditionField: 'from' | 'to' | 'subject' | 'hasAttachment';
  conditionOperator: 'contains' | 'equals' | 'startsWith';
  conditionValue: string;
  actionType: 'move' | 'label' | 'star' | 'markRead';
  actionValue: string;
  isEnabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class FilterService {
  private readonly http = inject(HttpClient);
  private readonly settingsService = inject(SettingsService);
  private readonly apiUrl = environment.apiUrl;

  readonly filters = signal<FilterRule[]>([]);

  private getHeaders() {
    const accountId = this.settingsService.activeAccountId();
    let headers = new HttpHeaders();
    if (accountId) headers = headers.set('x-account-id', accountId);
    return headers;
  }

  async fetchFilters(): Promise<void> {
    try {
      const filters = await firstValueFrom(this.http.get<FilterRule[]>(`${this.apiUrl}/filters`));
      this.filters.set(filters);
    } catch { /* ignore */ }
  }

  async create(data: Omit<FilterRule, 'id'>): Promise<void> {
    await firstValueFrom(this.http.post(`${this.apiUrl}/filters`, data));
    await this.fetchFilters();
  }

  async update(id: string, data: Partial<FilterRule>): Promise<void> {
    await firstValueFrom(this.http.put(`${this.apiUrl}/filters/${id}`, data));
    await this.fetchFilters();
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.apiUrl}/filters/${id}`));
    await this.fetchFilters();
  }

  async apply(id: string, folder: string): Promise<{ applied: number }> {
    return firstValueFrom(
      this.http.post<{ applied: number }>(
        `${this.apiUrl}/filters/${id}/apply`,
        { folder },
        { headers: this.getHeaders() }
      )
    );
  }
}
