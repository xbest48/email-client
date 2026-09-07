import { Injectable, signal } from '@angular/core';

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional third action label. When set the dialog shows a third button that resolves the promise with `null`. */
  discardLabel?: string;
  tone?: 'default' | 'danger' | 'success' | 'error' | 'info' | 'warning';
}

interface ConfirmDialogState {
  kind: 'confirm' | 'alert';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  discardLabel: string;
  tone: 'default' | 'danger' | 'success' | 'error' | 'info' | 'warning';
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  readonly dialog = signal<ConfirmDialogState | null>(null);

  private pendingResolver?: (result: boolean | null) => void;

  /**
   * Shows a confirmation dialog.
   * Returns `true` when the user clicks the confirm button,
   * `null` when the user clicks the optional discard button (discardLabel),
   * and `false` when the user cancels (cancel button, backdrop, or Escape).
   */
  confirm(options: ConfirmDialogOptions | string): Promise<boolean | null> {
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
      discardLabel: normalized.discardLabel ?? '',
      tone: normalized.tone ?? 'default',
    });

    return new Promise<boolean | null>((resolve) => {
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
      discardLabel: '',
      tone: normalized.tone ?? 'info',
    });

    return new Promise<void>((resolve) => {
      this.pendingResolver = () => resolve();
    });
  }

  resolve(result: boolean | null): void {
    const resolver = this.pendingResolver;
    this.pendingResolver = undefined;
    this.dialog.set(null);
    resolver?.(result);
  }
}
