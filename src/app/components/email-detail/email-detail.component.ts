import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { EmailService } from '../../services/email.service';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { Email } from '../../models/email.model';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-email-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RelativeTimePipe],
  templateUrl: './email-detail.component.html',
  styleUrl: './email-detail.component.css',
})
export class EmailDetailComponent implements OnInit {
  private readonly emailService = inject(EmailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly authService = inject(AuthService);

  readonly email = signal<Email | null>(null);
  readonly showReply = signal(false);
  readonly replyBody = signal('');
  readonly allowExternalImages = signal(false);

  readonly sanitizedHtml = computed<SafeHtml | null>(() => {
    const mail = this.email();
    if (!mail?.htmlBody) return null;

    let html = mail.htmlBody;
    const blockPixels = this.authService.user()?.blockTrackingPixels;

    if (blockPixels && !this.allowExternalImages()) {
        // Simple regex to block external images. Replaces the src attribute to a fake one
        // and adds a data-original-src attribute if we want to restore them later,
        // though our current implementation just regenerates the computed signal when allowExternalImages is true.
        html = html.replace(/<img[^>]+src="([^">]+)"/gi, (match, src) => {
            if (src.startsWith('http') && !src.includes(window.location.host)) {
                return match.replace(src, 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
            }
            return match;
        });
    }

    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  ngOnInit(): void {
    this.route.params.subscribe(async (params) => {
      const folder = params['folder'];
      const uid = params['uid'];

      if (folder && uid) {
        const msg = await this.emailService.fetchEmail(folder, parseInt(uid, 10));
        if (msg) {
          this.email.set(msg);
          this.emailService.markAsRead(msg);
        }
      }
    });
  }

  goBack(): void {
    this.emailService.selectedEmail.set(null);
    window.history.back();
  }

  async trash(): Promise<void> {
    const mail = this.email();
    if (mail) {
      await this.emailService.trashEmail(mail);
      this.goBack();
    }
  }

  async toggleStar(): Promise<void> {
    const mail = this.email();
    if (mail) {
      await this.emailService.toggleStar(mail);
      this.email.update((e) => (e ? { ...e, isStarred: !e.isStarred } : e));
    }
  }

  async toggleUnread(): Promise<void> {
    const mail = this.email();
    if (!mail) return;
    if (mail.isRead) {
      await this.emailService.markAsUnread(mail);
      this.email.update((e) => (e ? { ...e, isRead: false } : e));
    } else {
      await this.emailService.markAsRead(mail);
      this.email.update((e) => (e ? { ...e, isRead: true } : e));
    }
  }

  async sendReply(): Promise<void> {
    const mail = this.email();
    const body = this.replyBody();
    if (!mail || !body) return;

    const subject = mail.subject.startsWith('Re:') ? mail.subject : `Re: ${mail.subject}`;
    await this.emailService.sendEmail(
      mail.from.email,
      subject,
      body,
      '',
      '',
      mail.messageId || '',
      mail.messageId || ''
    );
    this.showReply.set(false);
    this.replyBody.set('');
  }

  onReplyInput(event: Event): void {
    this.replyBody.set((event.target as HTMLTextAreaElement).value);
  }

  formatRecipients(addresses: { name: string; email: string }[]): string {
    if (!addresses) return '';
    return addresses.map((a) => a.name || a.email).join(', ');
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1048576) return `${Math.round(bytes / 1024)} Ko`;
    return `${(bytes / 1048576).toFixed(1)} Mo`;
  }
}
