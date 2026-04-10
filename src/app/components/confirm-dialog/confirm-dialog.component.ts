import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (confirmDialog.dialog(); as dialog) {
      <div
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm"
        (click)="cancel()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title">
        <div
          class="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
          (click)="$event.stopPropagation()">
          <div class="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <div class="flex items-center gap-3">
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                [class.bg-amber-100]="dialog.tone === 'default' || dialog.tone === 'warning'"
                [class.text-amber-700]="dialog.tone === 'default' || dialog.tone === 'warning'"
                [class.bg-red-100]="dialog.tone === 'danger' || dialog.tone === 'error'"
                [class.text-red-700]="dialog.tone === 'danger' || dialog.tone === 'error'"
                [class.bg-emerald-100]="dialog.tone === 'success'"
                [class.text-emerald-700]="dialog.tone === 'success'"
                [class.bg-sky-100]="dialog.tone === 'info'"
                [class.text-sky-700]="dialog.tone === 'info'">
                <span class="text-lg font-semibold" aria-hidden="true">{{ toneGlyph(dialog.tone, dialog.kind) }}</span>
              </div>
              <h2 id="confirm-dialog-title" class="text-lg font-semibold text-gray-900 dark:text-white">{{ dialog.title }}</h2>
            </div>
          </div>

          <div class="px-6 py-5">
            <p class="text-sm leading-6 text-gray-600 dark:text-gray-300">{{ dialog.message }}</p>
          </div>

          <div class="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
            @if (dialog.kind === 'confirm') {
              <button
                type="button"
                (click)="cancel()"
                class="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white">
                {{ dialog.cancelLabel }}
              </button>
            }
            <button
              type="button"
              (click)="confirm()"
              class="rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
              [class.bg-amber-500]="dialog.tone === 'default' || dialog.tone === 'warning'"
              [class.hover:bg-amber-600]="dialog.tone === 'default' || dialog.tone === 'warning'"
              [class.bg-red-600]="dialog.tone === 'danger' || dialog.tone === 'error'"
              [class.hover:bg-red-700]="dialog.tone === 'danger' || dialog.tone === 'error'"
              [class.bg-emerald-600]="dialog.tone === 'success'"
              [class.hover:bg-emerald-700]="dialog.tone === 'success'"
              [class.bg-sky-600]="dialog.tone === 'info'"
              [class.hover:bg-sky-700]="dialog.tone === 'info'">
              {{ dialog.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  readonly confirmDialog = inject(ConfirmDialogService);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirmDialog.dialog()) {
      this.cancel();
    }
  }

  confirm(): void {
    this.confirmDialog.resolve(true);
  }

  cancel(): void {
    this.confirmDialog.resolve(false);
  }

  toneGlyph(tone: 'default' | 'danger' | 'success' | 'error' | 'info' | 'warning', kind: 'confirm' | 'alert'): string {
    if (kind === 'confirm') return '?';

    switch (tone) {
      case 'success':
        return '✓';
      case 'danger':
      case 'error':
        return '!';
      case 'warning':
        return '!';
      case 'info':
        return 'i';
      default:
        return 'i';
    }
  }
}
