import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GmailService } from '../../services/gmail.service';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { Email } from '../../models/email.model';

const LABEL_MAP: Record<string, string> = {
  inbox: 'INBOX',
  starred: 'STARRED',
  sent: 'SENT',
  drafts: 'DRAFT',
  spam: 'SPAM',
  trash: 'TRASH',
  important: 'IMPORTANT',
};

const LABEL_TITLES: Record<string, string> = {
  inbox: 'Boite de reception',
  starred: 'Messages suivis',
  sent: 'Messages envoyes',
  drafts: 'Brouillons',
  spam: 'Spam',
  trash: 'Corbeille',
  important: 'Important',
};

@Component({
  selector: 'app-email-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RelativeTimePipe],
  template: `
    <div class="flex flex-col h-full">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <h2 class="text-lg font-semibold text-gray-800">{{ title() }}</h2>
        <div class="flex items-center gap-2">
          <!-- Select all -->
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              [checked]="allSelected()"
              (change)="toggleSelectAll()"
              class="rounded border-gray-300 text-amber-500 focus:ring-amber-400"
              aria-label="Tout selectionner">
          </label>
          <!-- Refresh -->
          <button
            (click)="refresh()"
            class="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors
                   focus:outline-none focus:ring-2 focus:ring-amber-400"
            type="button"
            [attr.aria-label]="gmail.loading() ? 'Chargement...' : 'Actualiser'"
            [disabled]="gmail.loading()">
            <svg class="w-4 h-4" [class.animate-spin]="gmail.loading()"
                 fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Bulk actions -->
      @if (selectedIds().size > 0) {
        <div class="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-100">
          <span class="text-sm text-amber-800 font-medium">{{ selectedIds().size }} selectionne(s)</span>
          <div class="flex items-center gap-1 ml-auto">
            <button (click)="bulkArchive()" type="button"
                    class="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-amber-100 rounded-lg transition-colors
                           focus:outline-none focus:ring-2 focus:ring-amber-400"
                    aria-label="Archiver la selection">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/>
              </svg>
            </button>
            <button (click)="bulkTrash()" type="button"
                    class="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors
                           focus:outline-none focus:ring-2 focus:ring-red-400"
                    aria-label="Supprimer la selection">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
            <button (click)="bulkMarkRead()" type="button"
                    class="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-amber-100 rounded-lg transition-colors
                           focus:outline-none focus:ring-2 focus:ring-amber-400"
                    aria-label="Marquer comme lu">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </button>
          </div>
        </div>
      }

      <!-- Email list -->
      <div class="flex-1 overflow-y-auto" role="list" aria-label="Liste des emails">
        @if (gmail.loading() && emails().length === 0) {
          <div class="flex flex-col items-center justify-center py-16" role="status" aria-label="Chargement">
            <div class="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
            <p class="mt-3 text-sm text-gray-500">Chargement des emails...</p>
          </div>
        } @else if (emails().length === 0) {
          <div class="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg class="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
            <p class="text-sm">Aucun email dans ce dossier</p>
          </div>
        } @else {
          @for (email of emails(); track email.id) {
            <div
              class="flex items-center gap-3 px-4 py-3 border-b border-gray-100 cursor-pointer
                     hover:bg-gray-50 transition-colors duration-100 group"
              [class.bg-white]="email.isRead"
              [class.bg-blue-50/40]="!email.isRead"
              [class.bg-amber-50]="selectedIds().has(email.id)"
              (click)="openEmail(email)"
              (keydown.enter)="openEmail(email)"
              role="listitem"
              tabindex="0"
              [attr.aria-label]="email.subject + ' de ' + email.from.name">

              <!-- Checkbox -->
              <input
                type="checkbox"
                [checked]="selectedIds().has(email.id)"
                (click)="$event.stopPropagation()"
                (change)="toggleSelect(email.id)"
                class="shrink-0 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                [attr.aria-label]="'Selectionner ' + email.subject">

              <!-- Star -->
              <button
                (click)="$event.stopPropagation(); toggleStar(email)"
                class="shrink-0 p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 rounded"
                type="button"
                [attr.aria-label]="email.isStarred ? 'Retirer des suivis' : 'Suivre'">
                <svg class="w-4 h-4" [class.text-amber-400]="email.isStarred" [class.fill-amber-400]="email.isStarred"
                     [class.text-gray-300]="!email.isStarred" [class.group-hover:text-gray-400]="!email.isStarred"
                     viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                     [attr.fill]="email.isStarred ? 'currentColor' : 'none'" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round"
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
                </svg>
              </button>

              <!-- Sender -->
              <div class="w-36 shrink-0 truncate" [class.font-semibold]="!email.isRead">
                <span class="text-sm text-gray-800">{{ email.from.name }}</span>
              </div>

              <!-- Subject + snippet -->
              <div class="flex-1 min-w-0 flex items-baseline gap-2">
                <span class="text-sm truncate" [class.font-semibold]="!email.isRead" [class.text-gray-900]="!email.isRead"
                      [class.text-gray-700]="email.isRead">
                  {{ email.subject }}
                </span>
                <span class="text-sm text-gray-400 truncate hidden sm:inline">
                  — {{ email.snippet }}
                </span>
              </div>

              <!-- Attachment icon -->
              @if (email.hasAttachments) {
                <svg class="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24"
                     stroke="currentColor" stroke-width="2" aria-label="Piece jointe">
                  <path stroke-linecap="round" stroke-linejoin="round"
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>
                </svg>
              }

              <!-- Date -->
              <span class="text-xs text-gray-500 shrink-0 w-20 text-right" [class.font-semibold]="!email.isRead">
                {{ email.date | relativeTime }}
              </span>
            </div>
          }

          <!-- Load more -->
          @if (gmail.nextPageToken()) {
            <div class="flex justify-center py-4">
              <button
                (click)="loadMore()"
                class="px-4 py-2 text-sm text-amber-700 bg-amber-50 hover:bg-amber-100
                       rounded-lg transition-colors font-medium
                       focus:outline-none focus:ring-2 focus:ring-amber-400"
                type="button"
                [disabled]="gmail.loading()">
                @if (gmail.loading()) {
                  Chargement...
                } @else {
                  Charger plus
                }
              </button>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class EmailListComponent implements OnInit {
  protected readonly gmail = inject(GmailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly selectedIds = signal<Set<string>>(new Set());
  private currentLabel = '';
  private currentQuery = '';

  readonly emails = computed(() => this.gmail.currentEmails());
  readonly title = signal('Boite de reception');

  readonly allSelected = computed(() => {
    const emails = this.emails();
    const selected = this.selectedIds();
    return emails.length > 0 && emails.every((e) => selected.has(e.id));
  });

  ngOnInit(): void {
    this.route.params.subscribe((params) => {
      const label = params['label'] ?? 'inbox';
      this.currentLabel = LABEL_MAP[label] ?? label;
      this.title.set(LABEL_TITLES[label] ?? label);
      this.selectedIds.set(new Set());
      this.gmail.selectedEmail.set(null);
      this.gmail.fetchEmails(this.currentLabel, this.currentQuery);
    });

    this.route.queryParams.subscribe((qp) => {
      if (qp['q']) {
        this.currentQuery = qp['q'];
        this.title.set('Resultats : ' + qp['q']);
        this.gmail.fetchEmails(this.currentLabel, this.currentQuery);
      }
    });
  }

  refresh(): void {
    this.gmail.fetchEmails(this.currentLabel, this.currentQuery);
  }

  openEmail(email: Email): void {
    this.gmail.selectedEmail.set(email);
    this.gmail.markAsRead(email);
    this.router.navigate(['/email', email.id]);
  }

  toggleStar(email: Email): void {
    this.gmail.toggleStar(email);
  }

  toggleSelect(id: string): void {
    this.selectedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  toggleSelectAll(): void {
    if (this.allSelected()) {
      this.selectedIds.set(new Set());
    } else {
      this.selectedIds.set(new Set(this.emails().map((e) => e.id)));
    }
  }

  loadMore(): void {
    const token = this.gmail.nextPageToken();
    if (token) {
      this.gmail.fetchEmails(this.currentLabel, this.currentQuery, token);
    }
  }

  async bulkArchive(): Promise<void> {
    const ids = this.selectedIds();
    for (const email of this.emails().filter((e) => ids.has(e.id))) {
      await this.gmail.archiveMessage(email);
    }
    this.selectedIds.set(new Set());
  }

  async bulkTrash(): Promise<void> {
    const ids = this.selectedIds();
    for (const email of this.emails().filter((e) => ids.has(e.id))) {
      await this.gmail.trashMessage(email);
    }
    this.selectedIds.set(new Set());
  }

  async bulkMarkRead(): Promise<void> {
    const ids = this.selectedIds();
    for (const email of this.emails().filter((e) => ids.has(e.id))) {
      await this.gmail.markAsRead(email);
    }
    this.selectedIds.set(new Set());
  }
}
