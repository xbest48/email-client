import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, OnDestroy, viewChild, effect } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { EmailService } from '../../services/email.service';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { Email, EmailAddress } from '../../models/email.model';
import { AuthService } from '../../services/auth.service';
import { SnoozeService } from '../../services/snooze.service';
import { LabelService, Label } from '../../services/label.service';
import { PgpService } from '../../services/pgp.service';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { SandboxedHtmlDirective } from '../../directives/sandboxed-html.directive';
import { SettingsService } from '../../services/settings.service';
import { AiActionItem, AiCategoryResult, AiPhishingResult, AiService } from '../../services/ai.service';
import { TaskService } from '../../services/task.service';
import { ToastService } from '../../services/toast.service';
import { RichEditorComponent } from '../rich-editor/rich-editor.component';

@Component({
  selector: 'app-email-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RelativeTimePipe, SandboxedHtmlDirective, RichEditorComponent],
  templateUrl: './email-detail.component.html',
  styleUrl: './email-detail.component.css',
})
export class EmailDetailComponent implements OnInit, OnDestroy {
  protected readonly emailService = inject(EmailService);
  private readonly route = inject(ActivatedRoute);
  protected readonly authService = inject(AuthService);
  protected readonly snoozeService = inject(SnoozeService);
  protected readonly labelService = inject(LabelService);
  protected readonly pgpService = inject(PgpService);
  protected readonly settingsService = inject(SettingsService);
  private readonly shortcutService = inject(KeyboardShortcutService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly aiService = inject(AiService);
  private readonly taskService = inject(TaskService);
  private readonly toastService = inject(ToastService);

  readonly email = signal<Email | null>(null);
  readonly replyMode = signal<'reply' | 'replyAll' | 'forward' | null>(null);
  readonly showReply = computed(() => this.replyMode() !== null);
  readonly replyTo = signal('');
  readonly replyCc = signal('');
  readonly replyBcc = signal('');
  readonly replySubject = signal('');
  readonly replyBody = signal('');
  readonly replyEditor = viewChild<RichEditorComponent>('replyEditor');
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
  readonly recipientsExpanded = signal(false);

  // AI Signals
  readonly dismissAiHint = signal(false);
  readonly aiFeatureAccess = computed(() => {
    const user = this.authService.user();
    const globallyEnabled = !!user?.hasAiApiKey && !!user?.isAiEnabled;
    return {
      menu: globallyEnabled && (
        (user?.aiSummaryEnabled ?? true)
        || (user?.aiReplySuggestionsEnabled ?? true)
        || (user?.aiActionExtractionEnabled ?? true)
        || (user?.aiCategorizationEnabled ?? true)
        || (user?.aiPhishingEnabled ?? true)
        || (user?.aiTranslationEnabled ?? true)
      ),
      summary: globallyEnabled && (user?.aiSummaryEnabled ?? true),
      replies: globallyEnabled && (user?.aiReplySuggestionsEnabled ?? true),
      actions: globallyEnabled && (user?.aiActionExtractionEnabled ?? true),
      phishing: globallyEnabled && (user?.aiPhishingEnabled ?? true),
      categorization: globallyEnabled && (user?.aiCategorizationEnabled ?? true),
      translation: globallyEnabled && (user?.aiTranslationEnabled ?? true),
    };
  });
  readonly aiEnabled = computed(() =>
    this.aiFeatureAccess().menu
  );
  readonly aiSettingsHint = computed(() => {
    const user = this.authService.user();
    if (!user) return null;
    if (user.hideAiHints || this.dismissAiHint()) return null;
    if (user.hasAiApiKey && !user.isAiEnabled) {
      return "Les outils IA sont desactives. Activez-les dans Reglages > Intelligence Artificielle.";
    }
    if (!user.hasAiApiKey) {
      return "Ajoutez une cle API dans Reglages > Intelligence Artificielle pour utiliser le resume, la traduction et les suggestions.";
    }
    if (!this.aiFeatureAccess().menu) {
      return "Les outils IA de lecture sont desactives. Activez-les dans Reglages > Intelligence Artificielle.";
    }
    return null;
  });
  readonly showAiMenu = signal(false);
  readonly aiLoading = signal(false);
  readonly aiSummary = signal<string | null>(null);
  readonly aiReplies = signal<string[]>([]);
  readonly aiActionItems = signal<AiActionItem[]>([]);
  readonly aiPhishing = signal<AiPhishingResult | null>(null);
  readonly aiCategory = signal<AiCategoryResult | null>(null);
  readonly aiTranslation = signal<string | null>(null);
  readonly aiPhishingAppearance = computed(() => {
    const level = this.aiPhishing()?.level ?? 'low';
    switch (level) {
      case 'high':
        return {
          card: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
          dismiss: 'text-red-400 hover:text-red-600 dark:hover:text-red-300',
          title: 'text-red-800 dark:text-red-300',
          body: 'text-red-900 dark:text-red-200',
          badge: 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200',
          icon: 'text-red-600 dark:text-red-300',
          label: 'Danger',
        };
      case 'medium':
        return {
          card: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
          dismiss: 'text-orange-400 hover:text-orange-600 dark:hover:text-orange-300',
          title: 'text-orange-800 dark:text-orange-300',
          body: 'text-orange-900 dark:text-orange-200',
          badge: 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200',
          icon: 'text-orange-600 dark:text-orange-300',
          label: 'Attention',
        };
      case 'low':
      default:
        return {
          card: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
          dismiss: 'text-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-300',
          title: 'text-emerald-800 dark:text-emerald-300',
          body: 'text-emerald-900 dark:text-emerald-200',
          badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200',
          icon: 'text-emerald-600 dark:text-emerald-300',
          label: 'Sur',
        };
    }
  });

  readonly trustedPreviewUrl = computed<SafeResourceUrl | null>(() => {
    const preview = this.previewAttachment();
    if (!preview) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(preview.url);
  });

  readonly isSpamEmail = computed(() => {
    const mail = this.email();
    if (!mail) return false;
    const normalizedFolder = mail.folder.trim().toLowerCase();
    return this.emailService.folders().some(
      (folder) => folder.path === mail.folder && folder.specialUse === '\\Junk'
    ) || normalizedFolder === 'spam' || normalizedFolder === 'junk';
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

    html = html.replace(/<img\b[^>]*>/gi, (imgTag) => {
      const srcMatch = imgTag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
      if (!srcMatch) return imgTag;
      const src = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3];
      if (!src || !src.startsWith('http') || src.includes(window.location.host)) return imgTag;

      let domain = '';
      try { domain = new URL(src).hostname; } catch { return imgTag; }

      // Blocked domains always block
      if (blockedDomains.some(d => domain === d || domain.endsWith('.' + d))) {
        return '';
      }
      // Allowed domains always allow
      if (allowedDomains.some(d => domain === d || domain.endsWith('.' + d))) {
        return imgTag;
      }
      // Apply general policy
      if (blockImages) {
        return '';
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
  private readonly collapsedRecipientCount = 2;

  constructor() {
    effect(() => {
      if (!this.aiEnabled()) {
        this.clearAiResults();
      }
    });

    effect(() => {
      const access = this.aiFeatureAccess();
      if (!access.summary) this.aiSummary.set(null);
      if (!access.replies) this.aiReplies.set([]);
      if (!access.actions) this.aiActionItems.set([]);
      if (!access.phishing) this.aiPhishing.set(null);
      if (!access.categorization) this.aiCategory.set(null);
      if (!access.translation) this.aiTranslation.set(null);
    });

    effect(() => {
      this.authService.user();
      this.dismissAiHint.set(false);
    });
  }

  ngOnInit(): void {
    this.route.params.subscribe(async (params) => {
      // Same guard as LayoutComponent / EmailListComponent: wait for the initial
      // auth check to settle before making API calls so we don't spray 401s in
      // the console when the browser restores a discarded tab after sleep.
      await (this.authService.getInitialLoadPromise() ?? Promise.resolve());
      if (!this.authService.isAuthenticated()) return;

      const folder = params['folder'];
      const uid = params['uid'];

      if (folder && uid) {
        const msg = await this.emailService.fetchEmail(folder, parseInt(uid, 10));
        if (msg) {
          this.clearAiResults();
          this.recipientsExpanded.set(false);
          this.email.set(msg);
          this.emailService.markAsRead(msg);
          this.loadLabels(folder, parseInt(uid, 10));
          this.loadThread(folder, parseInt(uid, 10));
          if (this.aiFeatureAccess().phishing) {
            void this.detectPhishing(true);
          }
        }
      }
    });

    this.shortcutSub = this.shortcutService.actions.subscribe((action) => {
      switch (action) {
        case 'reply': this.openReply('reply'); break;
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
      const delay = (this.authService.user()?.undoSendDelay || 0) * 1000;
      await this.emailService.trashEmail(mail, delay);
      this.goBack();
    }
  }

  async spam(): Promise<void> {
    const mail = this.email();
    if (mail) {
      await this.emailService.spamEmail(mail);
      this.goBack();
    }
  }

  async markAsNotSpam(): Promise<void> {
    const mail = this.email();
    if (mail) {
      await this.emailService.markAsNotSpam(mail);
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

  openReply(mode: 'reply' | 'replyAll' | 'forward'): void {
    const mail = this.email();
    if (!mail) return;

    if (mode === 'forward') {
      this.replyTo.set('');
      this.replyCc.set('');
      this.replyBcc.set('');
      this.replySubject.set(this.withSubjectPrefix(mail.subject, 'Fwd:'));
      this.replyBody.set(this.buildForwardBody(mail));
    } else if (mode === 'replyAll') {
      const recipients = this.buildReplyAllRecipients(mail);
      this.replyTo.set(recipients.to);
      this.replyCc.set(recipients.cc);
      this.replyBcc.set(recipients.bcc);
      this.replySubject.set(this.withSubjectPrefix(mail.subject, 'Re:'));
      this.replyBody.set('');
    } else {
      this.replyTo.set(mail.from.email);
      this.replyCc.set('');
      this.replyBcc.set('');
      this.replySubject.set(this.withSubjectPrefix(mail.subject, 'Re:'));
      this.replyBody.set('');
    }

    this.replyMode.set(mode);

    const editor = this.replyEditor();
    if (editor) {
      editor.setHtml(this.replyBody());
    }
  }

  closeReplyComposer(): void {
    this.replyMode.set(null);
    this.replyTo.set('');
    this.replyCc.set('');
    this.replyBcc.set('');
    this.replySubject.set('');
    this.replyBody.set('');
    this.replyEditor()?.clear();
  }

  async sendReply(): Promise<void> {
    const mail = this.email();
    const editor = this.replyEditor();
    const mode = this.replyMode();
    const body = (editor ? editor.getFullHtml() : this.replyBody()).trim();
    if (!mail || !body || !mode) return;

    const to = this.replyTo().trim();
    const cc = this.replyCc().trim();
    const bcc = this.replyBcc().trim();
    const subject = this.replySubject().trim();
    if (!to) return;

    const isReply = mode === 'reply' || mode === 'replyAll';
    await this.emailService.sendEmail(
      to,
      subject,
      body,
      cc,
      bcc,
      isReply ? mail.messageId || '' : '',
      isReply ? mail.messageId || '' : '',
    );
    this.closeReplyComposer();
  }

  onReplyChange(html: string): void {
    this.replyBody.set(html);
  }

  printEmail(): void {
    const mail = this.email();
    if (!mail) return;

    const bodyHtml = this.getPrintableBodyHtml(mail);
    const printable = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <title>${this.escapeHtml(mail.subject || 'Message')}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #1f2937; line-height: 1.5; }
      h1 { font-size: 24px; margin: 0 0 16px; }
      .meta { margin-bottom: 24px; font-size: 14px; }
      .meta-row { margin: 4px 0; }
      .label { font-weight: 700; }
      .content { border-top: 1px solid #d1d5db; padding-top: 24px; }
      pre { white-space: pre-wrap; font-family: Arial, sans-serif; }
      img { max-width: 100%; height: auto; }
    </style>
  </head>
  <body>
    <h1>${this.escapeHtml(mail.subject || '(Sans objet)')}</h1>
    <div class="meta">
      <div class="meta-row"><span class="label">De :</span> ${this.escapeHtml(this.formatAddress(mail.from))}</div>
      <div class="meta-row"><span class="label">Date :</span> ${this.escapeHtml(new Date(mail.date).toLocaleString())}</div>
      <div class="meta-row"><span class="label">A :</span> ${this.escapeHtml(this.formatRecipientDetails(mail.to))}</div>
      ${mail.cc.length ? `<div class="meta-row"><span class="label">Cc :</span> ${this.escapeHtml(this.formatRecipientDetails(mail.cc))}</div>` : ''}
      ${mail.bcc.length ? `<div class="meta-row"><span class="label">Cci :</span> ${this.escapeHtml(this.formatRecipientDetails(mail.bcc))}</div>` : ''}
    </div>
    <div class="content">${bodyHtml}</div>
  </body>
</html>`;

    // The printable HTML contains untrusted email content. Instead of using
    // window.open() + document.write() (which loads the content in the same
    // origin, exposing cookies/localStorage to any residual <script> inside
    // the email), we render it into a hidden sandboxed iframe that disables
    // scripts entirely, then trigger the browser's print dialog from there.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    // allow-same-origin is NOT granted → scripts and event handlers in the
    // email HTML cannot execute at all.
    iframe.setAttribute('sandbox', 'allow-modals');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.srcdoc = printable;

    const cleanup = () => {
      window.setTimeout(() => iframe.remove(), 250);
    };

    iframe.addEventListener('load', () => {
      try {
        const win = iframe.contentWindow;
        if (!win) {
          cleanup();
          return;
        }
        win.focus();
        win.print();
      } finally {
        cleanup();
      }
    });

    document.body.appendChild(iframe);
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

  async copyEmailAddress(address: string): Promise<void> {
    if (!address) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
        this.toastService.show('success', `Adresse ${address} copiee.`);
        return;
      }
    } catch {
      // Fall back to the legacy copy approach below.
    }

    try {
      const input = document.createElement('textarea');
      input.value = address;
      input.setAttribute('readonly', 'true');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(input);

      if (!copied) {
        throw new Error('copy-failed');
      }

      this.toastService.show('success', `Adresse ${address} copiee.`);
    } catch {
      this.toastService.show('error', "L'adresse n'a pas pu etre copiee.");
    }
  }

  formatRecipientsPreview(mail: Email): string {
    const recipients = [...(mail.to ?? []), ...(mail.cc ?? [])];
    return recipients
      .slice(0, this.collapsedRecipientCount)
      .map((recipient) => recipient.name || recipient.email)
      .join(', ');
  }

  hasCollapsedRecipients(mail: Email): boolean {
    return (mail.to?.length ?? 0) + (mail.cc?.length ?? 0) > this.collapsedRecipientCount;
  }

  toggleRecipientsExpanded(): void {
    this.recipientsExpanded.update((expanded) => !expanded);
  }

  replyModeLabel(): string {
    switch (this.replyMode()) {
      case 'replyAll':
        return 'Repondre a tous';
      case 'forward':
        return 'Transferer';
      case 'reply':
      default:
        return 'Repondre';
    }
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1048576) return `${Math.round(bytes / 1024)} Ko`;
    return `${(bytes / 1048576).toFixed(1)} Mo`;
  }

  // AI Methods
  private getEmailText(): string {
    const mail = this.email();
    if (!mail) return '';
    if (mail.body) return mail.body;
    // Basic HTML to text if body is missing
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = mail.htmlBody || '';
    return tempDiv.textContent || tempDiv.innerText || '';
  }

  async summarize(): Promise<void> {
    this.showAiMenu.set(false);
    if (!this.aiFeatureAccess().summary) return;
    const content = this.getEmailText();
    if (!content) return;
    this.aiLoading.set(true);
    try {
      const summary = await this.aiService.summarize(content);
      this.aiSummary.set(summary);
    } catch (e) {
      console.error('Failed to summarize', e);
      this.toastService.show('error', 'Erreur lors du resume IA.');
    } finally {
      this.aiLoading.set(false);
    }
  }

  async generateReplies(): Promise<void> {
    this.showAiMenu.set(false);
    if (!this.aiFeatureAccess().replies) return;
    const content = this.getEmailText();
    if (!content) return;
    this.aiLoading.set(true);
    try {
      const replies = await this.aiService.reply(content);
      this.aiReplies.set(replies);
    } catch (e) {
      console.error('Failed to generate replies', e);
      this.toastService.show('error', 'Erreur lors de la generation des reponses.');
    } finally {
      this.aiLoading.set(false);
    }
  }

  applyReply(text: string): void {
    this.aiReplies.set([]);
    if (!this.replyTo().trim()) {
      this.openReply('reply');
    }
    this.replyBody.set(text);
    this.replyMode.set('reply');
    setTimeout(() => {
      const editor = this.replyEditor();
      if (editor) editor.setHtml(text);
    }, 100);
  }

  async extractActions(): Promise<void> {
    this.showAiMenu.set(false);
    if (!this.aiFeatureAccess().actions) return;
    const content = this.getEmailText();
    if (!content) return;
    this.aiLoading.set(true);
    try {
      const actions = await this.aiService.extract(content);
      this.aiActionItems.set(actions);
    } catch (e) {
      console.error('Failed to extract actions', e);
      this.toastService.show('error', "Erreur lors de l'extraction.");
    } finally {
      this.aiLoading.set(false);
    }
  }

  async detectPhishing(silent = false): Promise<void> {
    if (!silent) {
      this.showAiMenu.set(false);
    }
    if (!this.aiFeatureAccess().phishing) return;
    const content = this.getEmailText();
    const mail = this.email();
    if (!content) return;
    this.aiLoading.set(true);
    try {
      const result = await this.aiService.phishing(content, {
        messageId: mail?.messageId,
        folder: mail?.folder,
        uid: mail?.uid,
      });
      this.aiPhishing.set(result);
    } catch (e) {
      console.error('Failed to detect phishing', e);
      if (!silent) {
        this.toastService.show('error', "Erreur lors de l'analyse.");
      }
    } finally {
      this.aiLoading.set(false);
    }
  }

  async categorize(): Promise<void> {
    this.showAiMenu.set(false);
    if (!this.aiFeatureAccess().categorization) return;
    const content = this.getEmailText();
    const mail = this.email();
    if (!content) return;
    this.aiLoading.set(true);
    try {
      const category = await this.aiService.categorize(content, {
        messageId: mail?.messageId,
        folder: mail?.folder,
        uid: mail?.uid,
      });
      this.aiCategory.set(category);
    } catch (e) {
      console.error('Failed to categorize', e);
      this.toastService.show('error', 'Erreur lors de la categorisation.');
    } finally {
      this.aiLoading.set(false);
    }
  }

  async translate(targetLanguage: string = 'fr'): Promise<void> {
    this.showAiMenu.set(false);
    if (!this.aiFeatureAccess().translation) return;
    const content = this.getEmailText();
    if (!content) return;
    this.aiLoading.set(true);
    try {
      const translation = await this.aiService.translate(content, targetLanguage);
      this.aiTranslation.set(translation);
    } catch (e) {
      console.error('Failed to translate', e);
      this.toastService.show('error', 'Erreur lors de la traduction.');
    } finally {
      this.aiLoading.set(false);
    }
  }

  dismissAiResult(type: 'summary' | 'replies' | 'actions' | 'phishing' | 'category' | 'translation'): void {
    if (type === 'summary') this.aiSummary.set(null);
    if (type === 'replies') this.aiReplies.set([]);
    if (type === 'actions') this.aiActionItems.set([]);
    if (type === 'phishing') this.aiPhishing.set(null);
    if (type === 'category') this.aiCategory.set(null);
    if (type === 'translation') this.aiTranslation.set(null);
  }

  saveActionAsTask(action: AiActionItem): void {
    const mail = this.email();
    if (!mail) return;
    this.taskService.addTask({
      title: action.title,
      details: action.details,
      dueDate: action.dueDate,
      sourceSubject: mail.subject || '(sans objet)',
      sourceSender: mail.from.email,
    });
  }

  downloadActionCalendar(action: AiActionItem): void {
    if (!action.dueDate) return;

    const start = new Date(action.dueDate);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const formatIcsDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const uid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `kyma-mail-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const mail = this.email();
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KYMA Mail//AI Action Items//FR',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${escape(action.title)}`,
      `DESCRIPTION:${escape(action.details || `Depuis: ${mail?.subject || '(sans objet)'}`)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${action.title || 'evenement'}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  }

  formatAiDueDate(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString('fr-FR', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
  }

  private clearAiResults(): void {
    this.showAiMenu.set(false);
    this.aiSummary.set(null);
    this.aiReplies.set([]);
    this.aiActionItems.set([]);
    this.aiPhishing.set(null);
    this.aiCategory.set(null);
    this.aiTranslation.set(null);
  }

  private buildReplyAllRecipients(mail: Email): { to: string; cc: string; bcc: string } {
    const ownEmails = new Set(this.getCurrentAccountEmails());
    const to = this.uniqueEmails(
      [mail.from.email, ...mail.to.map((address) => address.email)],
      ownEmails,
    );
    const cc = this.uniqueEmails(
      mail.cc.map((address) => address.email),
      ownEmails,
      new Set(to.map((email) => email.toLowerCase())),
    );
    const bcc = this.uniqueEmails(
      mail.bcc.map((address) => address.email),
      ownEmails,
      new Set([...to, ...cc].map((email) => email.toLowerCase())),
    );

    if (!to.length && mail.from.email) {
      to.push(mail.from.email);
    }

    return {
      to: to.join(', '),
      cc: cc.join(', '),
      bcc: bcc.join(', '),
    };
  }

  private uniqueEmails(emails: string[], ...excludedSets: Set<string>[]): string[] {
    const excluded = new Set<string>();
    for (const set of excludedSets) {
      for (const value of set) {
        excluded.add(value.toLowerCase());
      }
    }

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const email of emails) {
      const trimmed = email.trim();
      if (!trimmed) continue;
      const normalized = trimmed.toLowerCase();
      if (excluded.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(trimmed);
    }
    return unique;
  }

  private getCurrentAccountEmails(): string[] {
    return this.settingsService.accounts
      .map((account) => account.email.trim().toLowerCase())
      .filter(Boolean);
  }

  private withSubjectPrefix(subject: string, prefix: 'Re:' | 'Fwd:'): string {
    const trimmed = (subject || '').trim();
    if (!trimmed) return prefix;

    const normalizedPrefix = prefix.replace(':', '');
    const alreadyPrefixed = new RegExp(`^${normalizedPrefix}:`, 'i');
    if (alreadyPrefixed.test(trimmed)) return trimmed;
    return `${prefix} ${trimmed}`;
  }

  private buildForwardBody(mail: Email): string {
    const originalBody = mail.htmlBody
      ? mail.htmlBody
      : this.escapeHtml(mail.body || '').replace(/\n/g, '<br>');

    return [
      '<p><br></p>',
      '<p>---------- Message transfere ----------</p>',
      `<p><strong>De :</strong> ${this.escapeHtml(this.formatAddress(mail.from))}<br>`,
      `<strong>Date :</strong> ${this.escapeHtml(new Date(mail.date).toLocaleString())}<br>`,
      `<strong>Objet :</strong> ${this.escapeHtml(mail.subject || '(Sans objet)')}<br>`,
      `<strong>A :</strong> ${this.escapeHtml(this.formatRecipientDetails(mail.to))}`,
      `${mail.cc.length ? `<br><strong>Cc :</strong> ${this.escapeHtml(this.formatRecipientDetails(mail.cc))}` : ''}`,
      `${mail.bcc.length ? `<br><strong>Cci :</strong> ${this.escapeHtml(this.formatRecipientDetails(mail.bcc))}` : ''}</p>`,
      '<hr>',
      originalBody,
    ].join('');
  }

  private getPrintableBodyHtml(mail: Email): string {
    const decrypted = this.decryptedBody();
    if (decrypted) {
      return `<pre>${this.escapeHtml(decrypted)}</pre>`;
    }

    const html = this.sanitizedHtml();
    if (html) return html;

    return `<pre>${this.escapeHtml(mail.body || '')}</pre>`;
  }

  private formatAddress(address: EmailAddress): string {
    if (!address) return '';
    return address.name ? `${address.name} <${address.email}>` : address.email;
  }

  private formatRecipientDetails(addresses: EmailAddress[]): string {
    return addresses.map((address) => this.formatAddress(address)).join(', ');
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

}
