import { Injectable, signal } from '@angular/core';

export interface ToastItem {
  id: string;
  type: 'info' | 'success' | 'error';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<ToastItem[]>([]);

  show(type: 'info' | 'success' | 'error', message: string): string {
    const id = Math.random().toString(36).slice(2, 10);
    this.toasts.update((items) => [...items, { id, type, message }]);

    setTimeout(() => {
      this.dismiss(id);
    }, type === 'info' ? 8000 : 5000);

    return id;
  }

  dismiss(id: string): void {
    this.toasts.update((items) => items.filter((item) => item.id !== id));
  }
}
