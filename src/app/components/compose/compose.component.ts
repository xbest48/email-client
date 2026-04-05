import { Component, inject, signal, output, ChangeDetectionStrategy, viewChild, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EmailService } from '../../services/email.service';
import { SettingsService } from '../../services/settings.service';
import { AuthService } from '../../services/auth.service';
import { RichEditorComponent } from '../rich-editor/rich-editor.component';

@Component({
  selector: 'app-compose',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RichEditorComponent],
  templateUrl: './compose.component.html',
  styleUrl: './compose.component.css',
})
export class ComposeComponent implements OnInit {
  private readonly emailService = inject(EmailService);
  private readonly settingsService = inject(SettingsService);
  private readonly authService = inject(AuthService);

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

  readonly bodyEditor = viewChild<RichEditorComponent>('bodyEditor');

  ngOnInit(): void {
    const sig = this.settingsService.getDefaultSignature();
    if (sig) {
      this.htmlBody.set('<br><br>--<br>' + sig.html);
    }
  }

  onBodyInit(): void {
    const sig = this.settingsService.getDefaultSignature();
    if (sig) {
      const editor = this.bodyEditor();
      if (editor && editor.isEmpty()) {
        editor.setHtml('<br><br>--<br>' + sig.html);
      }
    }
  }

  onBodyChange(html: string): void {
    this.htmlBody.set(html);
  }

  async onSend(event: Event): Promise<void> {
    event.preventDefault();
    const editor = this.bodyEditor();
    if (!this.to() || !editor || editor.isEmpty()) return;

    this.sending.set(true);
    try {
      const html = editor.getHtml();
      const delay = this.authService.user()?.undoSendDelay || 0;
      // We don't await here if there is a delay, we want to close the composer immediately
      // and let the service handle the background sending.
      if (delay > 0) {
        this.emailService.sendEmail(this.to(), this.subject(), html, this.cc(), this.bcc(), '', '', delay * 1000);
      } else {
        await this.emailService.sendEmail(this.to(), this.subject(), html, this.cc(), this.bcc());
      }
      this.close.emit();
    } catch (err) {
      console.error('Failed to send email', err);
    } finally {
      this.sending.set(false);
    }
  }

  toggleMaximize(): void {
    this.maximized.set(!this.maximized());
  }

  onClose(): void {
    this.close.emit();
  }
}
