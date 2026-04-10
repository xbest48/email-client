import { Injectable, signal } from '@angular/core';

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'success' | 'error' | 'info' | 'warning';
}

interface ConfirmDialogState {
  kind: 'confirm' | 'alert';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: 'default' | 'danger' | 'success' | 'error' | 'info' | 'warning';
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  readonly dialog = signal<ConfirmDialogState | null>(null);

  private pendingResolver?: (confirmed: boolean) => void;

  confirm(options: ConfirmDialogOptions | string): Promise<boolean> {
    if (this.pendingResolver) {
      this.pendingResolver(false);
    }

    const normalized = typeof options === 'string'
      ? { message: options }
      : options;

    this.dialog.set({
      kind: 'confirm',
      title: normalized.title ?? 'Confirmation',
      message: normalized.message,
      confirmLabel: normalized.confirmLabel ?? 'Confirmer',
      cancelLabel: normalized.cancelLabel ?? 'Annuler',
      tone: normalized.tone ?? 'default',
    });

    return new Promise<boolean>((resolve) => {
      this.pendingResolver = resolve;
    });
  }

  alert(options: ConfirmDialogOptions | string): Promise<void> {
    if (this.pendingResolver) {
      this.pendingResolver(false);
    }

    const normalized = typeof options === 'string'
      ? { message: options }
      : options;

    this.dialog.set({
      kind: 'alert',
      title: normalized.title ?? 'Information',
      message: normalized.message,
      confirmLabel: normalized.confirmLabel ?? 'OK',
      cancelLabel: '',
      tone: normalized.tone ?? 'info',
    });

    return new Promise<void>((resolve) => {
      this.pendingResolver = () => resolve();
    });
  }

  resolve(confirmed: boolean): void {
    const resolver = this.pendingResolver;
    this.pendingResolver = undefined;
    this.dialog.set(null);
    resolver?.(confirmed);
  }
}
