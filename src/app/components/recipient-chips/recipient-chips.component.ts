import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Extract the bare address from either "email" or "Name <email>". */
function extractEmail(raw: string): string {
  const match = raw.match(/<([^<>]+)>\s*$/);
  return (match ? match[1] : raw).trim();
}

/**
 * Recipient input that converts valid email addresses into removable chips —
 * the behaviour users know from Infomaniak / Gmail. Typing space, comma,
 * semicolon (or Enter/Tab, or leaving the field) turns the current text into
 * a chip when it is a valid address; Backspace on an empty input removes the
 * last chip; pasting a list splits it into as many chips as possible.
 *
 * The public contract stays string-based: `value` accepts a comma-separated
 * list (chips are re-parsed from it when set programmatically, e.g. reply
 * pre-fill), and `valueChange` always emits chips + any pending free text
 * joined with ", " so parents keep validating/sending exactly as before.
 */
@Component({
  selector: 'app-recipient-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex w-full min-w-0 cursor-text flex-wrap items-center gap-1.5 py-1.5" (click)="focusInput()">
      @for (chip of chips(); track chip; let i = $index) {
        <span class="inline-flex max-w-full items-center gap-1 rounded-full border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 pl-2.5 pr-1 py-0.5 text-xs text-gray-800 dark:text-gray-200">
          <span class="truncate">{{ chip }}</span>
          <button
            type="button"
            (click)="removeChip(i); $event.stopPropagation()"
            class="rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-red-500 dark:hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-400"
            [attr.aria-label]="'Retirer ' + chip"
            [title]="'Retirer ' + chip">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </span>
      }
      <input
        #chipInput
        [id]="inputId()"
        type="text"
        [value]="text()"
        (input)="onInput($any($event.target).value)"
        (keydown)="onKeydown($event)"
        (paste)="onPaste($event)"
        (blur)="onBlur()"
        class="min-w-32 flex-1 bg-transparent py-0.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none"
        [placeholder]="chips().length ? '' : placeholder()"
        autocomplete="off">
    </div>
  `,
})
export class RecipientChipsComponent {
  readonly value = input('');
  readonly placeholder = input('');
  readonly inputId = input('');

  readonly valueChange = output<string>();
  /** Raw free text as the user types — used by parents for autocomplete. */
  readonly textChange = output<string>();
  readonly inputBlur = output<void>();

  readonly chips = signal<string[]>([]);
  readonly text = signal('');

  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('chipInput');
  private lastEmitted: string | null = null;

  constructor() {
    // Re-parse only genuinely external writes (pre-fill, reset): anything we
    // emitted ourselves comes back identical and is skipped, so the user's
    // in-progress text is never clobbered mid-typing.
    effect(() => {
      const incoming = this.value();
      if (incoming === this.lastEmitted) return;
      const { chips, rest } = this.parse(incoming);
      this.chips.set(chips);
      this.text.set(rest);
      this.lastEmitted = incoming;
    });
  }

  focusInput(): void {
    this.inputRef()?.nativeElement.focus();
  }

  /** Add an address programmatically (e.g. from an autocomplete pick). */
  addChip(address: string): void {
    const email = extractEmail(address);
    if (!email) return;
    if (!this.chips().includes(email)) {
      this.chips.update((c) => [...c, email]);
    }
    this.text.set('');
    this.textChange.emit('');
    this.emit();
    this.focusInput();
  }

  removeChip(index: number): void {
    this.chips.update((c) => c.filter((_, i) => i !== index));
    this.emit();
  }

  onInput(value: string): void {
    this.text.set(value);
    this.textChange.emit(value);
    this.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === ',' || event.key === ';' || event.key === ' ' || event.key === 'Enter' || event.key === 'Tab') {
      const chipped = this.tryChipCurrentText();
      if (chipped && event.key !== 'Tab') {
        event.preventDefault();
        return;
      }
      // Enter with pending (invalid) text should not submit the surrounding
      // form and accidentally send with a half-typed address.
      if (event.key === 'Enter' && this.text().trim()) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'Backspace' && this.text() === '' && this.chips().length) {
      event.preventDefault();
      this.chips.update((c) => c.slice(0, -1));
      this.emit();
    }
  }

  onPaste(event: ClipboardEvent): void {
    const data = event.clipboardData?.getData('text') ?? '';
    // Single plain token: let the browser paste it into the input as usual.
    if (!/[,;\n<>\s]/.test(data.trim())) return;
    event.preventDefault();
    const leftovers: string[] = [];
    for (const segment of data.split(/[,;\n]+/)) {
      const raw = segment.trim();
      if (!raw) continue;
      const email = extractEmail(raw);
      if (EMAIL_RE.test(email)) {
        if (!this.chips().includes(email)) {
          this.chips.update((c) => [...c, email]);
        }
      } else {
        leftovers.push(raw);
      }
    }
    this.text.set([this.text().trim(), ...leftovers].filter(Boolean).join(' '));
    this.textChange.emit(this.text());
    this.emit();
  }

  onBlur(): void {
    this.tryChipCurrentText();
    this.inputBlur.emit();
  }

  private tryChipCurrentText(): boolean {
    const raw = this.text().trim().replace(/[,;]+$/, '').trim();
    if (!raw) return false;
    const email = extractEmail(raw);
    if (!EMAIL_RE.test(email)) return false;
    if (!this.chips().includes(email)) {
      this.chips.update((c) => [...c, email]);
    }
    this.text.set('');
    this.textChange.emit('');
    this.emit();
    return true;
  }

  private emit(): void {
    const pending = this.text().trim();
    const combined = pending ? [...this.chips(), pending].join(', ') : this.chips().join(', ');
    this.lastEmitted = combined;
    this.valueChange.emit(combined);
  }

  private parse(value: string): { chips: string[]; rest: string } {
    const chips: string[] = [];
    const leftovers: string[] = [];
    for (const segment of value.split(/[,;]+/)) {
      const raw = segment.trim();
      if (!raw) continue;
      const email = extractEmail(raw);
      if (EMAIL_RE.test(email)) {
        if (!chips.includes(email)) chips.push(email);
      } else {
        leftovers.push(raw);
      }
    }
    return { chips, rest: leftovers.join(' ') };
  }
}
