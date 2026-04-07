import { Component, output, signal, ChangeDetectionStrategy, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-search-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.css',
})
export class SearchBarComponent {
  readonly search = output<string>();

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

  onSearch(event: Event): void {
    event.preventDefault();
    this.search.emit(this.buildQuery());
  }

  clearSearch(): void {
    this.query.set('');
    this.search.emit('');
  }

  applyFilters(): void {
    this.showFilters.set(false);
    this.search.emit(this.buildQuery());
  }

  resetFilters(): void {
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

  focusInput(): void {
    this.searchInput()?.nativeElement.focus();
  }

  private buildQuery(): string {
    const parts: string[] = [];
    const q = this.query();
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
}
