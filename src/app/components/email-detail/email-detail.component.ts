import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { EmailService } from '../../services/email.service';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { Email } from '../../models/email.model';
import { AuthService } from '../../services/auth.service';
import { SnoozeService } from '../../services/snooze.service';
import { LabelService, Label } from '../../services/label.service';
import { PgpService } from '../../services/pgp.service';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { SandboxedHtmlDirective } from '../../directives/sandboxed-html.directive';

@Component({
  selector: 'app-email-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RelativeTimePipe, SandboxedHtmlDirective],
  templateUrl: './email-detail.component.html',
  styleUrl: './email-detail.component.css',
})
export class EmailDetailComponent implements OnInit, OnDestroy {
  private readonly emailService = inject(EmailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly authService = inject(AuthService);
  protected readonly snoozeService = inject(SnoozeService);
  protected readonly labelService = inject(LabelService);
  protected readonly pgpService = inject(PgpService);
  private readonly shortcutService = inject(KeyboardShortcutService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly email = signal<Email | null>(null);
  readonly showReply = signal(false);
  readonly replyBody = signal('');
  readonly allowExternalImages = signal(false);
  readonly showSnoozeMenu = signal(false);
  readonly showLabelMenu = signal(false);
  readonly emailLabels = signal<Label[]>([]);
  readonly threadEmails = signal<Email[]>([]);
  readonly expandedThreadUids = signal<Set<number>>(new Set());
  readonly decryptedBody = signal<string | null>(null);
  readonly pgpPassphrase = signal('');
  readonly showPgpPrompt = signal(false);
  readonly readReceiptDismissed = signal(false);
  readonly customSnoozeDate = signal('');
  readonly previewAttachment = signal<{ url: string; mimeType: string; filename: string } | null>(null);
  readonly trustedPreviewUrl = computed<SafeResourceUrl | null>(() => {
    const preview = this.previewAttachment();
    if (!preview) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(preview.url);
  });

  readonly shouldBlockImages = computed(() => {
    const user = this.authService.user();
    const policy = user?.imagePolicy ?? 'ask';
    if (policy === 'always') return false;
    if (policy === 'never') return true;
    // 'ask' mode: block by default, user can click to allow
    return !this.allowExternalImages();
  });

  readonly sanitizedHtml = computed<string | null>(() => {
    const mail = this.email();
    if (!mail?.htmlBody) return null;

    let html = mail.htmlBody;
    const user = this.authService.user();
    const allowedDomains: string[] = user?.imageAllowedDomains ?? [];
    const blockedDomains: string[] = user?.imageBlockedDomains ?? [];
    const blockImages = this.shouldBlockImages();

    const placeholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    html = html.replace(/<img\b[^>]*>/gi, (imgTag) => {
      const srcMatch = imgTag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
      if (!srcMatch) return imgTag;
      const src = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3];
      if (!src || !src.startsWith('http') || src.includes(window.location.host)) return imgTag;

      let domain = '';
      try { domain = new URL(src).hostname; } catch { return imgTag; }

      // Blocked domains always block
      if (blockedDomains.some(d => domain === d || domain.endsWith('.' + d))) {
        return imgTag.replace(srcMatch[0], `src="${placeholder}"`);
      }
      // Allowed domains always allow
      if (allowedDomains.some(d => domain === d || domain.endsWith('.' + d))) {
        return imgTag;
      }
      // Apply general policy
      if (blockImages) {
        return imgTag.replace(srcMatch[0], `src="${placeholder}"`);
      }
      return imgTag;
    });

    return html;
  });

  readonly isPgpEncrypted = computed(() => {
    const mail = this.email();
    return mail ? this.pgpService.isPgpMessage(mail.body || mail.htmlBody) : false;
  });

  private shortcutSub?: Subscription;

  ngOnInit(): void {
    this.route.params.subscribe(async (params) => {
      const folder = params['folder'];
      const uid = params['uid'];

      if (folder && uid) {
        const msg = await this.emailService.fetchEmail(folder, parseInt(uid, 10));
        if (msg) {
          this.email.set(msg);
          this.emailService.markAsRead(msg);
          this.loadLabels(folder, parseInt(uid, 10));
          this.loadThread(folder, parseInt(uid, 10));
        }
      }
    });

    this.shortcutSub = this.shortcutService.actions.subscribe((action) => {
      switch (action) {
        case 'reply': this.showReply.set(true); break;
        case 'goBack': this.goBack(); break;
        case 'toggleStar': this.toggleStar(); break;
        case 'trash': this.trash(); break;
        case 'toggleReadUnread': this.toggleUnread(); break;
      }
    });
  }

  ngOnDestroy(): void {
    this.shortcutSub?.unsubscribe();
  }

  private async loadLabels(folder: string, uid: number): Promise<void> {
    try {
      const labels = await this.labelService.getLabelsForEmail(folder, uid);
      this.emailLabels.set(labels);
    } catch { /* ignore */ }
  }

  private async loadThread(folder: string, uid: number): Promise<void> {
    const thread = await this.emailService.fetchThread(folder, uid);
    this.threadEmails.set(thread.filter((e) => e.uid !== uid));
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
      mail.from.email, subject, body, '', '',
      mail.messageId || '', mail.messageId || ''
    );
    this.showReply.set(false);
    this.replyBody.set('');
  }

  onReplyInput(event: Event): void {
    this.replyBody.set((event.target as HTMLTextAreaElement).value);
  }

  // Snooze
  async snooze(option: 'laterToday' | 'tomorrowMorning' | 'nextWeek'): Promise<void> {
    const mail = this.email();
    if (!mail) return;
    const until = this.snoozeService.getSnoozeDate(option);
    await this.snoozeService.snooze(mail.folder, mail.uid, until);
    this.showSnoozeMenu.set(false);
    this.goBack();
  }

  async snoozeCustom(): Promise<void> {
    const mail = this.email();
    const dateStr = this.customSnoozeDate();
    if (!mail || !dateStr) return;
    await this.snoozeService.snooze(mail.folder, mail.uid, new Date(dateStr));
    this.showSnoozeMenu.set(false);
    this.goBack();
  }

  // Labels
  async toggleLabel(label: Label): Promise<void> {
    const mail = this.email();
    if (!mail) return;
    const hasLabel = this.emailLabels().some((l) => l.id === label.id);
    if (hasLabel) {
      await this.labelService.removeEmailFromLabel(label.id, mail.folder, mail.uid);
    } else {
      await this.labelService.addEmailToLabel(label.id, mail.folder, mail.uid);
    }
    await this.loadLabels(mail.folder, mail.uid);
  }

  hasLabel(labelId: string): boolean {
    return this.emailLabels().some((l) => l.id === labelId);
  }

  // Thread
  toggleThreadMessage(uid: number): void {
    this.expandedThreadUids.update((set) => {
      const next = new Set(set);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  isThreadExpanded(uid: number): boolean {
    return this.expandedThreadUids().has(uid);
  }

  // PGP
  async decryptEmail(): Promise<void> {
    const mail = this.email();
    const passphrase = this.pgpPassphrase();
    if (!mail || !passphrase) return;
    const content = mail.body || mail.htmlBody;
    const decrypted = await this.pgpService.decrypt(content, passphrase);
    if (decrypted) {
      this.decryptedBody.set(decrypted);
      this.showPgpPrompt.set(false);
    }
  }

  // Read receipt
  async sendReadReceipt(): Promise<void> {
    const mail = this.email();
    if (!mail?.readReceiptTo) return;
    const subject = `Read: ${mail.subject}`;
    const body = `Your message "${mail.subject}" was read on ${new Date().toLocaleString()}.`;
    await this.emailService.sendEmail(mail.readReceiptTo, subject, body);
    this.readReceiptDismissed.set(true);
  }

  // Attachments
  getAttachmentUrl(attachmentId: string): string {
    const mail = this.email();
    if (!mail) return '';
    return this.emailService.getAttachmentUrl(mail.folder, mail.uid, attachmentId);
  }

  isImageAttachment(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  isPdfAttachment(mimeType: string): boolean {
    return mimeType === 'application/pdf';
  }

  async openPreview(attachmentId: string, mimeType: string, filename: string): Promise<void> {
    const mail = this.email();
    if (!mail) return;
    try {
      const blobUrl = await this.emailService.fetchAttachmentBlob(mail.folder, mail.uid, attachmentId);
      this.previewAttachment.set({ url: blobUrl, mimeType, filename });
    } catch {
      // Fallback to direct URL
      this.previewAttachment.set({
        url: this.getAttachmentUrl(attachmentId),
        mimeType, filename,
      });
    }
  }

  closePreview(): void {
    const preview = this.previewAttachment();
    if (preview?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(preview.url);
    }
    this.previewAttachment.set(null);
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
