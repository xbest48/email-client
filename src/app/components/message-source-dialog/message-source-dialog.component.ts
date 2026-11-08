import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { EmailService } from '../../services/email.service';

/** Above this, the <pre> gets sluggish (big attachments are base64 text). */
const MAX_DISPLAYED_CHARS = 500_000;

@Component({
  selector: 'app-message-source-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close.emit()' },
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
         (click)="close.emit()">
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-5xl w-full mx-4 max-h-[90vh] flex flex-col overflow-hidden"
           role="dialog" aria-modal="true" aria-labelledby="message-source-title"
           (click)="$event.stopPropagation()">
        <div class="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 id="message-source-title" class="text-sm font-semibold text-gray-900 dark:text-white truncate">
            Source du message
          </h2>
          <div class="flex items-center gap-1 shrink-0">
            <button type="button" (click)="copy()" [disabled]="!source()"
                    class="p-2 text-gray-600 hover:text-amber-700 hover:bg-amber-50 dark:text-gray-300 dark:hover:text-amber-400 dark:hover:bg-amber-900/20 rounded-lg transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-400"
                    aria-label="Copier la source" title="Copier la source">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
              </svg>
            </button>
            <button type="button" (click)="download()" [disabled]="!blob()"
                    class="p-2 text-gray-600 hover:text-amber-700 hover:bg-amber-50 dark:text-gray-300 dark:hover:text-amber-400 dark:hover:bg-amber-900/20 rounded-lg transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-400"
                    aria-label="Telecharger le fichier .eml" title="Telecharger le fichier .eml">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
            </button>
            <button #closeButton type="button" (click)="close.emit()"
                    class="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800 rounded-lg transition-colors
                           focus:outline-none focus:ring-2 focus:ring-amber-400"
                    aria-label="Fermer" title="Fermer">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        @if (error(); as message) {
          <p class="p-6 text-sm text-red-700 dark:text-red-300" role="alert">{{ message }}</p>
        } @else if (source() === null) {
          <div class="flex items-center justify-center p-12" role="status">
            <div class="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin" aria-hidden="true"></div>
            <span class="sr-only">Chargement de la source</span>
          </div>
        } @else {
          @if (truncated()) {
            <p class="px-4 py-2 text-xs text-amber-900 bg-amber-50 dark:text-amber-200 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
              Message volumineux : seuls les {{ maxChars.toLocaleString('fr-FR') }} premiers caracteres sont affiches.
              Telechargez le fichier .eml pour la source complete.
            </p>
          }
          <pre class="flex-1 overflow-auto p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-all text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-950
                      focus:outline-none focus:ring-2 focus:ring-inset focus:ring-amber-400"
               tabindex="0" aria-label="Source brute du message">{{ displayed() }}</pre>
        }
      </div>
    </div>
  `,
})
export class MessageSourceDialogComponent implements OnInit, OnDestroy {
  private readonly emailService = inject(EmailService);

  readonly folder = input.required<string>();
  readonly uid = input.required<number>();
  readonly subject = input('');
  readonly close = output<void>();
  readonly copied = output<boolean>();

  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly previouslyFocused = document.activeElement as HTMLElement | null;

  protected readonly maxChars = MAX_DISPLAYED_CHARS;
  protected readonly blob = signal<Blob | null>(null);
  protected readonly source = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly truncated = computed(() => (this.source()?.length ?? 0) > MAX_DISPLAYED_CHARS);
  protected readonly displayed = computed(() => this.source()?.slice(0, MAX_DISPLAYED_CHARS) ?? '');

  async ngOnInit(): Promise<void> {
    queueMicrotask(() => this.closeButton()?.nativeElement.focus());
    try {
      const blob = await this.emailService.fetchMessageSource(this.folder(), this.uid());
      this.blob.set(blob);
      // Headers are 7-bit ASCII; 8-bit bodies are usually UTF-8. Anything
      // else shows replacement characters, the .eml download stays exact.
      this.source.set(await readAsUtf8(blob));
    } catch {
      this.error.set('Impossible de charger la source du message.');
    }
  }

  ngOnDestroy(): void {
    this.previouslyFocused?.focus();
  }

  protected async copy(): Promise<void> {
    const source = this.source();
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source);
      this.copied.emit(true);
    } catch {
      this.copied.emit(false);
    }
  }

  protected download(): void {
    const blob = this.blob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.fileBaseName()}.eml`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private fileBaseName(): string {
    const name = this.subject().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 80);
    return name || `message-${this.uid()}`;
  }
}

function readAsUtf8(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob, 'utf-8');
  });
}
