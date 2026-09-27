import { Component, output, signal, ChangeDetectionStrategy, ElementRef, viewChild, OnDestroy, input, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-search-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.css',
})
export class SearchBarComponent implements OnDestroy {
  readonly searchChange = output<string>();
  readonly activeQuery = input('');

  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly query = signal('');
  readonly showFilters = signal(false);
  readonly filterFrom = signal('');
  readonly filterTo = signal('');
  readonly filterSubject = signal('');
  readonly filterHasAttachment = signal(false);
  readonly filterUnread = signal(false);
  readonly filterAfter = signal('');
  readonly filterBefore = signal('');
  readonly filterMinSize = signal('');
  readonly filterMaxSize = signal('');
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Last query this component emitted, to recognise its own echo via the URL. */
  private lastEmittedQuery: string | null = null;

  constructor() {
    effect(() => {
      const activeQuery = this.activeQuery();

      // The URL change triggered by our own emission comes back through
      // `activeQuery` a few ms later. Re-applying it would overwrite what the
      // user typed in the meantime (lost characters) and would copy the
      // advanced-filter tokens into the text field, duplicating them on the
      // next search.
      if (activeQuery === this.lastEmittedQuery) return;
      this.lastEmittedQuery = null;

      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = null;
      }
      this.query.set(activeQuery);
      this.clearFiltersState();
    });
  }

  ngOnDestroy(): void {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
  }

  preventSubmit(event: Event): void {
    event.preventDefault();
  }

  suppressEnter(event: Event): void {
    event.preventDefault();
  }

  onQueryInput(): void {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.searchTimeout = null;
      this.emitQuery();
    }, 250);
  }

  applyFilters(): void {
    this.showFilters.set(false);
    this.emitQuery();
  }

  resetFilters(): void {
    this.clearFiltersState();
    this.emitQuery();
  }

  private emitQuery(): void {
    const next = this.buildQuery();
    this.lastEmittedQuery = next;
    this.searchChange.emit(next);
  }

  clearQuery(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }
    this.query.set('');
    this.emitQuery();
    // Keep the keyboard open on mobile so the user can type a new search.
    this.focusInput();
  }

  focusInput(): void {
    this.searchInput()?.nativeElement.focus();
  }

  private buildQuery(): string {
    const parts: string[] = [];
    const q = this.query().trim();
    if (q) parts.push(q);
    const from = this.filterFrom();
    if (from) parts.push(`from:${from}`);
    const to = this.filterTo();
    if (to) parts.push(`to:${to}`);
    const subject = this.filterSubject();
    if (subject) parts.push(`subject:${subject}`);
    if (this.filterHasAttachment()) parts.push('has:attachment');
    if (this.filterUnread()) parts.push('is:unread');
    const after = this.filterAfter();
    if (after) parts.push(`after:${after}`);
    const before = this.filterBefore();
    if (before) parts.push(`before:${before}`);
    const minSize = this.filterMinSize();
    if (minSize) parts.push(`larger:${minSize}`);
    const maxSize = this.filterMaxSize();
    if (maxSize) parts.push(`smaller:${maxSize}`);
    return parts.join(' ');
  }

  private clearFiltersState(): void {
    this.filterFrom.set('');
    this.filterTo.set('');
    this.filterSubject.set('');
    this.filterHasAttachment.set(false);
    this.filterUnread.set(false);
    this.filterAfter.set('');
    this.filterBefore.set('');
    this.filterMinSize.set('');
    this.filterMaxSize.set('');
  }
}
