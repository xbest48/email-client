import { Component, inject, signal, output, computed, ChangeDetectionStrategy, viewChild, OnInit, OnDestroy, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EmailService } from '../../services/email.service';
import { SettingsService, EmailTemplate } from '../../services/settings.service';
import { AuthService } from '../../services/auth.service';
import { ScheduledService } from '../../services/scheduled.service';
import { ContactService, Contact } from '../../services/contact.service';
import { PgpService } from '../../services/pgp.service';
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

  readonly bodyEditor = viewChild<RichEditorComponent>('bodyEditor');
  readonly fileInputRef = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly templates = computed(() => this.settingsService.templates);

  private draftInterval: ReturnType<typeof setInterval> | null = null;
  private contactTimeout: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    // Load draft if exists
    const draft = this.settingsService.loadDraft();
    if (draft) {
      this.to.set(draft.to);
      this.cc.set(draft.cc);
      this.bcc.set(draft.bcc);
      this.subject.set(draft.subject);
      this.htmlBody.set(draft.htmlBody);
      if (draft.cc || draft.bcc) this.showCc.set(true);
    } else {
      const sig = this.settingsService.getDefaultSignature();
      if (sig) {
        this.htmlBody.set('<br><br>--<br>' + sig.html);
      }
    }

    // Auto-save draft every 3 seconds
    this.draftInterval = setInterval(() => this.saveDraft(), 3000);
  }

  ngOnDestroy(): void {
    if (this.draftInterval) clearInterval(this.draftInterval);
    if (this.contactTimeout) clearTimeout(this.contactTimeout);
  }

  private saveDraft(): void {
    const to = this.to();
    const subject = this.subject();
    const editor = this.bodyEditor();
    const html = editor ? editor.getHtml() : this.htmlBody();
    if (!to && !subject && (!html || html === '<br><br>--<br>')) return;

    this.settingsService.saveDraft({
      to,
      cc: this.cc(),
      bcc: this.bcc(),
      subject,
      htmlBody: html,
      savedAt: new Date().toISOString(),
    });
    this.draftSavedAt.set(new Date().toLocaleTimeString());
  }

  onBodyInit(): void {
    const draft = this.settingsService.loadDraft();
    if (draft?.htmlBody) {
      const editor = this.bodyEditor();
      if (editor && editor.isEmpty()) {
        editor.setHtml(draft.htmlBody);
      }
    } else {
      const sig = this.settingsService.getDefaultSignature();
      if (sig) {
        const editor = this.bodyEditor();
        if (editor && editor.isEmpty()) {
          editor.setHtml('<br><br>--<br>' + sig.html);
        }
      }
    }
  }

  onBodyChange(html: string): void {
    this.htmlBody.set(html);
  }

  // Contact autocomplete
  onToInput(): void {
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
  async onSend(event: Event): Promise<void> {
    event.preventDefault();
    const editor = this.bodyEditor();
    if (!this.to() || !editor || editor.isEmpty()) return;

    this.sending.set(true);
    try {
      let html = editor.getHtml();

      // PGP encryption
      if (this.encryptPgp()) {
        const encrypted = await this.pgpService.encrypt(html, this.to());
        if (encrypted) html = encrypted;
      }

      const delay = this.authService.user()?.undoSendDelay || 0;
      if (delay > 0) {
        this.emailService.sendEmail(this.to(), this.subject(), html, this.cc(), this.bcc(), '', '', delay * 1000);
      } else {
        await this.emailService.sendEmail(this.to(), this.subject(), html, this.cc(), this.bcc());
      }
      this.settingsService.clearDraft();
      this.close.emit();
    } catch (err) {
      console.error('Failed to send email', err);
    } finally {
      this.sending.set(false);
    }
  }

  // Scheduled send
  async onScheduleSend(): Promise<void> {
    const editor = this.bodyEditor();
    const dateStr = this.scheduleDate();
    if (!this.to() || !editor || editor.isEmpty() || !dateStr) return;

    this.sending.set(true);
    try {
      const html = editor.getHtml();
      await this.scheduledService.schedule({
        to: this.to(),
        subject: this.subject(),
        body: html,
        cc: this.cc() || undefined,
        bcc: this.bcc() || undefined,
        scheduledAt: new Date(dateStr),
      });
      this.settingsService.clearDraft();
      this.close.emit();
    } catch (err) {
      console.error('Failed to schedule email', err);
    } finally {
      this.sending.set(false);
    }
  }

  toggleMaximize(): void {
    this.maximized.set(!this.maximized());
  }

  onClose(): void {
    this.saveDraft();
    this.close.emit();
  }
}
