import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export interface SnoozedEmail {
  id: string;
  folder: string;
  uid: number;
  snoozeUntil: string;
}

@Injectable({ providedIn: 'root' })
export class SnoozeService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly snoozedEmails = signal<SnoozedEmail[]>([]);
  readonly count = signal(0);

  async fetchSnoozed(): Promise<void> {
    try {
      const data = await firstValueFrom(this.http.get<SnoozedEmail[]>(`${this.apiUrl}/snooze`));
      this.snoozedEmails.set(data);
    } catch { /* ignore */ }
  }

  async fetchCount(): Promise<void> {
    try {
      const c = await firstValueFrom(this.http.get<number>(`${this.apiUrl}/snooze/count`));
      this.count.set(c);
    } catch { /* ignore */ }
  }

  async snooze(folder: string, uid: number, until: Date): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/snooze`, { folder, uid, until: until.toISOString() })
    );
    await this.fetchCount();
  }

  async unsnooze(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.apiUrl}/snooze/${id}`));
    await this.fetchCount();
  }

  getSnoozeDate(option: 'laterToday' | 'tomorrowMorning' | 'nextWeek'): Date {
    const now = new Date();
    switch (option) {
      case 'laterToday': {
        const d = new Date(now);
        d.setHours(18, 0, 0, 0);
        if (d <= now) d.setDate(d.getDate() + 1);
        return d;
      }
      case 'tomorrowMorning': {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        d.setHours(8, 0, 0, 0);
        return d;
      }
      case 'nextWeek': {
        const d = new Date(now);
        const day = d.getDay();
        const diff = day === 0 ? 1 : 8 - day;
        d.setDate(d.getDate() + diff);
        d.setHours(8, 0, 0, 0);
        return d;
      }
    }
  }
}
