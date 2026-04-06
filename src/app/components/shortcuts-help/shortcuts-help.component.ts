import { Component, inject, output, ChangeDetectionStrategy } from '@angular/core';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';

@Component({
  selector: 'app-shortcuts-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      (click)="close.emit()"
      (keydown.escape)="close.emit()"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title">
      <div
        class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
        (click)="$event.stopPropagation()">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="shortcuts-title" class="text-lg font-semibold text-gray-900 dark:text-white">Raccourcis clavier</h2>
          <button
            (click)="close.emit()"
            class="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors
                   focus:outline-none focus:ring-2 focus:ring-amber-400"
            type="button"
            aria-label="Fermer">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="px-6 py-4">
          @for (entry of categories(); track entry[0]) {
            <div class="mb-4">
              <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{{ entry[0] }}</h3>
              <dl class="space-y-1">
                @for (shortcut of entry[1]; track shortcut.key) {
                  <div class="flex items-center justify-between py-1.5">
                    <dt class="text-sm text-gray-700 dark:text-gray-300">{{ shortcut.description }}</dt>
                    <dd>
                      <kbd class="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded">{{ shortcut.key }}</kbd>
                    </dd>
                  </div>
                }
              </dl>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class ShortcutsHelpComponent {
  private readonly shortcutService = inject(KeyboardShortcutService);

  readonly close = output<void>();

  readonly categories = this.shortcutService.shortcutsByCategory;
}
