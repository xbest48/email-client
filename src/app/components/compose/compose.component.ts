import { Component, inject, signal, output, computed, ChangeDetectionStrategy, viewChild, OnInit, OnDestroy, ElementRef, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EmailService } from '../../services/email.service';
import { SettingsService, EmailTemplate } from '../../services/settings.service';
import { AuthService } from '../../services/auth.service';
import { ScheduledService } from '../../services/scheduled.service';
import { ContactService, Contact } from '../../services/contact.service';
import { PgpService } from '../../services/pgp.service';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { RichEditorComponent } from '../rich-editor/rich-editor.component';

@Component({
  selector: 'app-compose',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RichEditorComponent],
  templateUrl: './compose.component.html',
  styleUrl: './compose.component.css',
})
export class ComposeComponent implements OnInit, OnDestroy {
  private readonly emailService = inject(EmailService);
  protected readonly settingsService = inject(SettingsService);
  private readonly authService = inject(AuthService);
  protected readonly scheduledService = inject(ScheduledService);
  protected readonly contactService = inject(ContactService);
  protected readonly pgpService = inject(PgpService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly close = output<void>();

  readonly to = signal('');
  readonly cc = signal('');
  readonly bcc = signal('');
  readonly subject = signal('');
  readonly htmlBody = signal('');
  readonly showCc = signal(false);
  readonly minimized = signal(false);
  readonly maximized = signal(false);
  readonly sending = signal(false);
  readonly showTemplates = signal(false);
  readonly showSchedule = signal(false);
  readonly scheduleDate = signal('');
  readonly requestReadReceipt = signal(false);
  readonly encryptPgp = signal(false);
  readonly dragOver = signal(false);
  readonly attachments = signal<File[]>([]);
  readonly toSuggestions = signal<Contact[]>([]);
  readonly showToSuggestions = signal(false);
  readonly draftSavedAt = signal<string | null>(null);
  readonly sendError = signal<string | null>(null);

  readonly bodyEditor = viewChild<RichEditorComponent>('bodyEditor');
  readonly fileInputRef = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  readonly toInputRef = viewChild<ElementRef<HTMLInputElement>>('toInput');

  readonly templates = computed(() => this.settingsService.templates);

  private draftInterval: ReturnType<typeof setInterval> | null = null;
  private contactTimeout: ReturnType<typeof setTimeout> | null = null;
  private remoteDraft: { folder: string; uid: number | null } | null = null;
  private draftSaveInFlight = false;

  constructor() {
    effect(() => {
      const signatureHtml = this.settingsService.getDefaultSignature()?.html ?? '';
      const currentBody = this.htmlBody();
      if (!signatureHtml || !currentBody) return;

      const strippedBody = this.stripDetachedSignature(currentBody, signatureHtml);
      if (strippedBody === currentBody) return;

      this.htmlBody.set(strippedBody);

      const editor = this.bodyEditor();
      if (editor && editor.getHtml() !== strippedBody) {
        editor.setHtml(strippedBody);
      }
    });
  }

  ngOnInit(): void {
    // Auto-save draft every 3 seconds
    this.draftInterval = setInterval(() => void this.saveDraft(), 3000);
  }

  ngOnDestroy(): void {
    if (this.draftInterval) clearInterval(this.draftInterval);
    if (this.contactTimeout) clearTimeout(this.contactTimeout);
  }

  private async saveDraft(): Promise<void> {
    if (this.draftSaveInFlight) return;
    this.draftSaveInFlight = true;

    const to = this.to();
    const subject = this.subject();
    const cc = this.cc();
    const bcc = this.bcc();
    const editor = this.bodyEditor();
    const html = this.stripDetachedSignature(editor ? editor.getHtml() : this.htmlBody());
    const fullHtml = editor ? editor.getFullHtml() : html;

    try {
      if (!to && !cc && !bcc && !subject && !html) {
        this.settingsService.clearDraft();
        if (this.remoteDraft?.folder && this.remoteDraft.uid) {
          await this.emailService.deleteDraftMessage(this.remoteDraft.folder, this.remoteDraft.uid);
        }
        this.remoteDraft = null;
        this.draftSavedAt.set(null);
        return;
      }

      this.settingsService.saveDraft({
        to,
        cc,
        bcc,
        subject,
        htmlBody: html,
        savedAt: new Date().toISOString(),
      });

      this.remoteDraft = await this.emailService.saveDraftMessage(
        to,
        subject,
        fullHtml,
        cc,
        bcc,
        this.remoteDraft,
      );
      this.draftSavedAt.set(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Failed to save draft', err);
    } finally {
      this.draftSaveInFlight = false;
    }
  }

  onBodyChange(html: string): void {
    this.sendError.set(null);
    this.htmlBody.set(html);
  }

  // Contact autocomplete
  onToInput(): void {
    this.sendError.set(null);
    const query = this.to();
    if (this.contactTimeout) clearTimeout(this.contactTimeout);
    if (query.length < 2) {
      this.showToSuggestions.set(false);
      return;
    }
    this.contactTimeout = setTimeout(async () => {
      const results = await this.contactService.search(query);
      this.toSuggestions.set(results);
      this.showToSuggestions.set(results.length > 0);
    }, 300);
  }

  selectContact(contact: Contact): void {
    this.to.set(contact.email);
    this.showToSuggestions.set(false);
  }

  // Templates
  applyTemplate(template: EmailTemplate): void {
    this.subject.set(template.subject);
    const editor = this.bodyEditor();
    if (editor) {
      editor.setHtml(template.htmlBody);
    }
    this.htmlBody.set(template.htmlBody);
    this.showTemplates.set(false);
  }

  // Drag & drop attachments
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(): void {
    this.dragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files) this.addFiles(files);
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(input.files);
    input.value = '';
  }

  private addFiles(fileList: FileList): void {
    const current = this.attachments();
    const newFiles = Array.from(fileList);
    this.attachments.set([...current, ...newFiles]);
  }

  removeAttachment(index: number): void {
    this.attachments.update((files) => files.filter((_, i) => i !== index));
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1048576) return `${Math.round(bytes / 1024)} Ko`;
    return `${(bytes / 1048576).toFixed(1)} Mo`;
  }

  // Send
  async onSend(): Promise<void> {
    if (this.sending()) return;

    this.sendError.set(null);

    const to = this.to().trim();
    const editor = this.bodyEditor();
    if (!to) {
      this.sendError.set('Ajoutez au moins un destinataire.');
      this.toInputRef()?.nativeElement.focus();
      return;
    }
    if (!this.areRecipientsValid(to)) {
      this.sendError.set('L’adresse du destinataire semble invalide.');
      this.toInputRef()?.nativeElement.focus();
      return;
    }
    if (!editor) {
      this.sendError.set("L'editeur du message n'est pas pret.");
      return;
    }
    const subject = this.subject().trim();
    const bodyHtml = this.stripDetachedSignature(editor.getHtml());
    if (this.isMeaningfullyEmpty(bodyHtml) && !subject) {
      this.sendError.set('Ajoutez un sujet ou du contenu au message avant l’envoi.');
      return;
    }
    if (!subject && !await this.confirmDialog.confirm({
      title: 'Sujet vide',
      message: 'Le sujet est vide. Voulez-vous envoyer le message quand meme ?',
      confirmLabel: 'Envoyer',
      cancelLabel: 'Annuler',
    })) {
      return;
    }

    this.sending.set(true);
    try {
      let html = editor.getFullHtml();

      // PGP encryption
      if (this.encryptPgp()) {
        const encrypted = await this.pgpService.encrypt(html, to);
        if (encrypted) html = encrypted;
      }

      const delay = this.authService.user()?.undoSendDelay || 0;
      const files = this.attachments();
      const readReceipt = this.requestReadReceipt();
      if (delay > 0) {
        this.emailService.sendEmail(to, this.subject(), html, this.cc(), this.bcc(), '', '', delay * 1000, files, readReceipt);
      } else {
        await this.emailService.sendEmail(to, this.subject(), html, this.cc(), this.bcc(), '', '', 0, files, readReceipt);
      }
      this.settingsService.clearDraft();
      if (this.remoteDraft?.folder && this.remoteDraft.uid) {
        try {
          await this.emailService.deleteDraftMessage(this.remoteDraft.folder, this.remoteDraft.uid);
        } catch (err) {
          console.warn('Failed to delete remote draft after send', err);
        }
      }
      this.remoteDraft = null;
      this.close.emit();
    } catch (err) {
      console.error('Failed to send email', err);
      this.sendError.set("L'envoi du message a echoue.");
    } finally {
      this.sending.set(false);
    }
  }

  // Scheduled send
  async onScheduleSend(): Promise<void> {
    this.sendError.set(null);

    const editor = this.bodyEditor();
    const dateStr = this.scheduleDate();
    const to = this.to().trim();
    if (!to) {
      this.sendError.set('Ajoutez au moins un destinataire.');
      this.toInputRef()?.nativeElement.focus();
      return;
    }
    if (!this.areRecipientsValid(to)) {
      this.sendError.set('L’adresse du destinataire semble invalide.');
      this.toInputRef()?.nativeElement.focus();
      return;
    }
    if (!editor) {
      this.sendError.set("L'editeur du message n'est pas pret.");
      return;
    }
    const subject = this.subject().trim();
    const bodyHtml = this.stripDetachedSignature(editor.getHtml());
    if (this.isMeaningfullyEmpty(bodyHtml) && !subject) {
      this.sendError.set("Ajoutez un sujet ou du contenu avant de programmer l'envoi.");
      return;
    }
    if (!subject && !await this.confirmDialog.confirm({
      title: 'Sujet vide',
      message: "Le sujet est vide. Voulez-vous programmer l'envoi quand meme ?",
      confirmLabel: 'Programmer',
      cancelLabel: 'Annuler',
    })) {
      return;
    }
    if (!dateStr) {
      this.sendError.set("Choisissez une date d'envoi.");
      return;
    }

    this.sending.set(true);
    try {
      const html = editor.getFullHtml();
      await this.scheduledService.schedule({
        to,
        subject: this.subject(),
        body: html,
        cc: this.cc() || undefined,
        bcc: this.bcc() || undefined,
        scheduledAt: new Date(dateStr),
      });
      this.settingsService.clearDraft();
      if (this.remoteDraft?.folder && this.remoteDraft.uid) {
        try {
          await this.emailService.deleteDraftMessage(this.remoteDraft.folder, this.remoteDraft.uid);
        } catch (err) {
          console.warn('Failed to delete remote draft after scheduling', err);
        }
      }
      this.remoteDraft = null;
      this.close.emit();
    } catch (err) {
      console.error('Failed to schedule email', err);
      this.sendError.set("La programmation de l'envoi a echoue.");
    } finally {
      this.sending.set(false);
    }
  }

  toggleMaximize(): void {
    this.maximized.set(!this.maximized());
  }

  onClose(): void {
    void this.saveDraft();
    this.close.emit();
  }

  private stripDetachedSignature(html: string, signatureHtml = this.settingsService.getDefaultSignature()?.html ?? ''): string {
    if (!html) return html;
    if (!signatureHtml) return this.stripTrailingSignatureMarkers(html);

    const normalizedSignature = signatureHtml.replace(/\s+/g, ' ').trim();
    let bodyHtml = html.trim();
    const footerPrefix = signatureHtml.slice(0, 200);

    const candidates = [
      `<br><br>--<br>${signatureHtml}`,
      `<div><br><br>--<br></div>${signatureHtml}`,
      signatureHtml,
    ];

    for (const candidate of candidates) {
      if (bodyHtml.includes(candidate)) {
        bodyHtml = bodyHtml.replace(candidate, '').trim();
      }
    }

    if (footerPrefix && bodyHtml.includes(footerPrefix)) {
      bodyHtml = bodyHtml.slice(0, bodyHtml.indexOf(footerPrefix)).trim();
    }

    const normalizedBody = bodyHtml.replace(/\s+/g, ' ').trim();
    if (normalizedBody.endsWith(normalizedSignature)) {
      bodyHtml = bodyHtml.slice(0, Math.max(0, bodyHtml.length - signatureHtml.length)).trim();
      bodyHtml = bodyHtml.replace(/(<br\s*\/?>\s*){1,3}--(<br\s*\/?>\s*)?$/i, '').trim();
    }

    const footerContainer = document.createElement('div');
    footerContainer.innerHTML = signatureHtml;
    const footerText = footerContainer.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!footerText) return bodyHtml;

    const bodyContainer = document.createElement('div');
    bodyContainer.innerHTML = bodyHtml;
    const bodyText = bodyContainer.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!bodyText.endsWith(footerText)) return bodyHtml;

    const removedContainer = document.createElement('div');
    while (bodyContainer.lastChild) {
      const lastChild = bodyContainer.lastChild;
      removedContainer.prepend(lastChild);
      const removedText = removedContainer.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (removedText.includes(footerText)) {
        break;
      }
    }

    bodyHtml = bodyContainer.innerHTML.trim();
    bodyHtml = this.stripTrailingSignatureMarkers(bodyHtml);

    return bodyHtml;
  }

  private stripTrailingSignatureMarkers(html: string): string {
    let cleaned = html.trim();
    const patterns = [
      /(?:<br\s*\/?>|\s|&nbsp;)*--(?:<br\s*\/?>|\s|&nbsp;)*$/i,
      /(?:<p|<div)[^>]*>\s*--\s*<\/(?:p|div)>(?:<br\s*\/?>|\s|&nbsp;)*$/i,
      /<hr[^>]*>(?:<br\s*\/?>|\s|&nbsp;)*$/i,
      /(?:<p|<div)[^>]*>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/(?:p|div)>(?:<br\s*\/?>|\s|&nbsp;)*$/i,
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const pattern of patterns) {
        const next = cleaned.replace(pattern, '').trim();
        if (next !== cleaned) {
          cleaned = next;
          changed = true;
        }
      }
    }

    if (this.isVisuallyEmpty(cleaned)) {
      return '';
    }

    return cleaned;
  }

  private areRecipientsValid(value: string): boolean {
    return value
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  }

  private isMeaningfullyEmpty(html: string): boolean {
    const normalized = html
      .replace(/<hr[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<\/?(div|p|span)[^>]*>/gi, '')
      .replace(/&nbsp;/gi, '')
      .replace(/-/g, '')
      .replace(/\s+/g, '')
      .trim();

    return normalized === '';
  }

  private isVisuallyEmpty(html: string): boolean {
    const normalized = html
      .replace(/<hr[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<\/?(div|p|span)[^>]*>/gi, '')
      .replace(/&nbsp;/gi, '')
      .replace(/-/g, '')
      .replace(/\s+/g, '')
      .trim();

    return normalized === '';
  }
}
