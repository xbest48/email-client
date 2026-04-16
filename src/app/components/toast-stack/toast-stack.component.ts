import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast-stack',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (toastService.toasts().length > 0) {
      <div class="fixed bottom-6 right-6 z-[65] flex max-w-sm flex-col gap-2">
        @for (toast of toastService.toasts(); track toast.id) {
          <div
            class="rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-sm"
            [class.bg-sky-50]="toast.type === 'info'"
            [class.border-sky-200]="toast.type === 'info'"
            [class.text-sky-900]="toast.type === 'info'"
            [class.bg-emerald-50]="toast.type === 'success'"
            [class.border-emerald-200]="toast.type === 'success'"
            [class.text-emerald-900]="toast.type === 'success'"
            [class.bg-red-50]="toast.type === 'error'"
            [class.border-red-200]="toast.type === 'error'"
            [class.text-red-900]="toast.type === 'error'">
            <div class="flex items-start gap-3">
              <div class="flex-1">{{ toast.message }}</div>
              <button
                type="button"
                (click)="toastService.dismiss(toast.id)"
                class="rounded p-0.5 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
                aria-label="Fermer l'alerte">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class ToastStackComponent {
  readonly toastService = inject(ToastService);
}
