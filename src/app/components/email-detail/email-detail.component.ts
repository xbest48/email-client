import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { GmailService } from '../../services/gmail.service';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { Email } from '../../models/email.model';

@Component({
  selector: 'app-email-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RelativeTimePipe],
  template: `
    @if (email(); as mail) {
      <div class="flex flex-col h-full bg-white">
        <!-- Toolbar -->
        <div class="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
          <button
            (click)="goBack()"
            class="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors
                   focus:outline-none focus:ring-2 focus:ring-amber-400"
            type="button"
            aria-label="Retour a la liste">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
            </svg>
          </button>

          <div class="flex-1"></div>

          <button
            (click)="archive()"
            class="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors
                   focus:outline-none focus:ring-2 focus:ring-amber-400"
            type="button"
            aria-label="Archiver">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/>
            </svg>
          </button>

          <button
            (click)="trash()"
            class="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors
                   focus:outline-none focus:ring-2 focus:ring-red-400"
            type="button"
            aria-label="Supprimer">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>

          <button
            (click)="toggleUnread()"
            class="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors
                   focus:outline-none focus:ring-2 focus:ring-amber-400"
            type="button"
            [attr.aria-label]="mail.isRead ? 'Marquer comme non lu' : 'Marquer comme lu'">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
          </button>

          <button
            (click)="toggleStar()"
            class="p-2 transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
            [class.text-amber-400]="mail.isStarred"
            [class.text-gray-400]="!mail.isStarred"
            [class.hover:text-amber-500]="!mail.isStarred"
            type="button"
            [attr.aria-label]="mail.isStarred ? 'Retirer des suivis' : 'Suivre'">
            <svg class="w-5 h-5" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                 [attr.fill]="mail.isStarred ? 'currentColor' : 'none'" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
            </svg>
          </button>
        </div>

        <!-- Email content -->
        <div class="flex-1 overflow-y-auto">
          <div class="max-w-4xl mx-auto p-4 md:p-6">
            <!-- Subject -->
            <h1 class="text-xl md:text-2xl font-semibold text-gray-900 mb-4">{{ mail.subject }}</h1>

            <!-- Sender info -->
            <div class="flex items-start gap-3 mb-6">
              <div class="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center text-amber-800
                          font-semibold text-sm shrink-0" aria-hidden="true">
                {{ mail.from.name.charAt(0).toUpperCase() }}
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center flex-wrap gap-x-2">
                  <span class="font-semibold text-gray-900 text-sm">{{ mail.from.name }}</span>
                  <span class="text-xs text-gray-500">&lt;{{ mail.from.email }}&gt;</span>
                </div>
                <div class="text-xs text-gray-500 mt-0.5">
                  <span>a {{ formatRecipients(mail.to) }}</span>
                  @if (mail.cc.length) {
                    <span>, Cc: {{ formatRecipients(mail.cc) }}</span>
                  }
                </div>
                <span class="text-xs text-gray-400">{{ mail.date | relativeTime }}</span>
              </div>

              <!-- Reply button -->
              <button
                (click)="showReply.set(true)"
                class="shrink-0 p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors
                       focus:outline-none focus:ring-2 focus:ring-amber-400"
                type="button"
                aria-label="Repondre">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
                </svg>
              </button>
            </div>

            <!-- Labels -->
            @if (mail.labels.length) {
              <div class="flex flex-wrap gap-1.5 mb-4">
                @for (label of visibleLabels(); track label) {
                  <span class="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                    {{ label }}
                  </span>
                }
              </div>
            }

            <!-- Attachments -->
            @if (mail.hasAttachments && mail.attachments.length) {
              <div class="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <p class="text-xs font-medium text-gray-500 mb-2">
                  {{ mail.attachments.length }} piece(s) jointe(s)
                </p>
                <div class="flex flex-wrap gap-2">
                  @for (att of mail.attachments; track att.id) {
                    <div class="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-gray-200 text-sm">
                      <svg class="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24"
                           stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round"
                              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>
                      </svg>
                      <span class="text-gray-700 truncate max-w-48">{{ att.filename }}</span>
                      <span class="text-gray-400 text-xs">({{ formatSize(att.size) }})</span>
                    </div>
                  }
                </div>
              </div>
            }

            <!-- Email body -->
            <div class="prose prose-sm max-w-none text-gray-800 leading-relaxed">
              @if (sanitizedHtml()) {
                <div [innerHTML]="sanitizedHtml()"></div>
              } @else {
                <pre class="whitespace-pre-wrap font-sans text-sm">{{ mail.body }}</pre>
              }
            </div>

            <!-- Reply box -->
            @if (showReply()) {
              <div class="mt-6 border-t border-gray-200 pt-4">
                <label for="reply-body" class="block text-sm font-medium text-gray-700 mb-2">Repondre</label>
                <textarea
                  id="reply-body"
                  [value]="replyBody()"
                  (input)="onReplyInput($event)"
                  rows="4"
                  class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-y
                         focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-300"
                  placeholder="Ecrivez votre reponse..."></textarea>
                <div class="flex justify-end gap-2 mt-3">
                  <button
                    (click)="showReply.set(false)"
                    class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors
                           focus:outline-none focus:ring-2 focus:ring-amber-400"
                    type="button">
                    Annuler
                  </button>
                  <button
                    (click)="sendReply()"
                    class="px-4 py-2 text-sm bg-amber-500 text-white font-medium rounded-lg
                           hover:bg-amber-600 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2"
                    type="button"
                    [disabled]="!replyBody()">
                    Envoyer
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    } @else {
      <div class="flex items-center justify-center h-full text-gray-400" role="status">
        <div class="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
      </div>
    }
  `,
})
export class EmailDetailComponent implements OnInit {
  private readonly gmail = inject(GmailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  readonly email = signal<Email | null>(null);
  readonly showReply = signal(false);
  readonly replyBody = signal('');

  readonly sanitizedHtml = computed<SafeHtml | null>(() => {
    const mail = this.email();
    if (!mail?.htmlBody) return null;
    return this.sanitizer.bypassSecurityTrustHtml(mail.htmlBody);
  });

  readonly visibleLabels = computed(() => {
    const hidden = new Set(['UNREAD', 'INBOX', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']);
    return this.email()?.labels.filter((l) => !hidden.has(l)) ?? [];
  });

  ngOnInit(): void {
    const selected = this.gmail.selectedEmail();
    if (selected) {
      this.email.set(selected);
    }

    this.route.params.subscribe(async (params) => {
      const id = params['id'];
      if (id && !this.email()) {
        const msg = await this.gmail.fetchMessage(id);
        if (msg) {
          this.email.set(msg);
          this.gmail.markAsRead(msg);
        }
      }
    });
  }

  goBack(): void {
    this.gmail.selectedEmail.set(null);
    window.history.back();
  }

  async archive(): Promise<void> {
    const mail = this.email();
    if (mail) {
      await this.gmail.archiveMessage(mail);
      this.goBack();
    }
  }

  async trash(): Promise<void> {
    const mail = this.email();
    if (mail) {
      await this.gmail.trashMessage(mail);
      this.goBack();
    }
  }

  async toggleStar(): Promise<void> {
    const mail = this.email();
    if (mail) {
      await this.gmail.toggleStar(mail);
      this.email.update((e) => (e ? { ...e, isStarred: !e.isStarred } : e));
    }
  }

  async toggleUnread(): Promise<void> {
    const mail = this.email();
    if (!mail) return;
    if (mail.isRead) {
      await this.gmail.markAsUnread(mail);
      this.email.update((e) => (e ? { ...e, isRead: false } : e));
    } else {
      await this.gmail.markAsRead(mail);
      this.email.update((e) => (e ? { ...e, isRead: true } : e));
    }
  }

  async sendReply(): Promise<void> {
    const mail = this.email();
    const body = this.replyBody();
    if (!mail || !body) return;

    const subject = mail.subject.startsWith('Re:') ? mail.subject : `Re: ${mail.subject}`;
    await this.gmail.sendEmail(mail.from.email, subject, body);
    this.showReply.set(false);
    this.replyBody.set('');
  }

  onReplyInput(event: Event): void {
    this.replyBody.set((event.target as HTMLTextAreaElement).value);
  }

  formatRecipients(addresses: { name: string; email: string }[]): string {
    return addresses.map((a) => a.name || a.email).join(', ');
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1048576) return `${Math.round(bytes / 1024)} Ko`;
    return `${(bytes / 1048576).toFixed(1)} Mo`;
  }
}
