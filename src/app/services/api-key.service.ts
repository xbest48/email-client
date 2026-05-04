import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export interface ApiKeyMeta {
  id: string;
  name: string;
  accountId: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiKey extends ApiKeyMeta {
  /** Token en clair, retourné une seule fois. */
  token: string;
}

@Injectable({ providedIn: 'root' })
export class ApiKeyService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly keys = signal<ApiKeyMeta[]>([]);
  readonly loading = signal(false);

  async fetch(): Promise<void> {
    this.loading.set(true);
    try {
      const list = await firstValueFrom(
        this.http.get<ApiKeyMeta[]>(`${this.apiUrl}/api-keys`),
      );
      this.keys.set(list);
    } finally {
      this.loading.set(false);
    }
  }

  async create(data: {
    name: string;
    accountId: string;
    expiresAt: string | null;
  }): Promise<CreatedApiKey> {
    const created = await firstValueFrom(
      this.http.post<CreatedApiKey>(`${this.apiUrl}/api-keys`, data),
    );
    await this.fetch();
    return created;
  }

  async revoke(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.apiUrl}/api-keys/${id}`));
    await this.fetch();
  }
}
