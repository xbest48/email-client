import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export interface Contact {
  id: string;
  name: string;
  email: string;
  frequency: number;
}

@Injectable({ providedIn: 'root' })
export class ContactService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly suggestions = signal<Contact[]>([]);

  async search(query: string): Promise<Contact[]> {
    try {
      const contacts = await firstValueFrom(
        this.http.get<Contact[]>(`${this.apiUrl}/contacts`, { params: { q: query } })
      );
      this.suggestions.set(contacts);
      return contacts;
    } catch {
      return [];
    }
  }
}
