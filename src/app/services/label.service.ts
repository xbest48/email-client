import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export interface Label {
  id: string;
  name: string;
  color: string;
}

@Injectable({ providedIn: 'root' })
export class LabelService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly labels = signal<Label[]>([]);
  readonly counts = signal<Map<string, number>>(new Map());

  async fetchLabels(): Promise<void> {
    try {
      const labels = await firstValueFrom(this.http.get<Label[]>(`${this.apiUrl}/labels`));
      this.labels.set(labels);
      this.fetchCounts();
    } catch { /* ignore */ }
  }

  async fetchCounts(): Promise<void> {
    try {
      const data = await firstValueFrom(
        this.http.get<{ labelId: string; count: number }[]>(`${this.apiUrl}/labels/counts`)
      );
      const map = new Map<string, number>();
      data.forEach((d) => map.set(d.labelId, d.count));
      this.counts.set(map);
    } catch { /* ignore */ }
  }

  async create(name: string, color: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.apiUrl}/labels`, { name, color }));
    await this.fetchLabels();
  }

  async update(id: string, data: Partial<Label>): Promise<void> {
    await firstValueFrom(this.http.put(`${this.apiUrl}/labels/${id}`, data));
    await this.fetchLabels();
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.apiUrl}/labels/${id}`));
    await this.fetchLabels();
  }

  async addEmailToLabel(labelId: string, folder: string, uid: number): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/labels/${labelId}/emails`, { folder, uid })
    );
  }

  async removeEmailFromLabel(labelId: string, folder: string, uid: number): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.apiUrl}/labels/${labelId}/emails`, { body: { folder, uid } })
    );
  }

  async getLabelsForEmail(folder: string, uid: number): Promise<Label[]> {
    return firstValueFrom(
      this.http.get<Label[]>(`${this.apiUrl}/labels/for-email/${encodeURIComponent(folder)}/${uid}`)
    );
  }
}
