import { Component, inject, signal, output, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EmailService } from '../../services/email.service';

@Component({
  selector: 'app-compose',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './compose.component.html',
  styleUrl: './compose.component.css',
})
export class ComposeComponent {
  private readonly emailService = inject(EmailService);

  readonly close = output<void>();

  readonly to = signal('');
  readonly cc = signal('');
  readonly bcc = signal('');
  readonly subject = signal('');
  readonly body = signal('');
  readonly showCc = signal(false);
  readonly minimized = signal(false);
  readonly sending = signal(false);

  async onSend(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.to() || !this.body()) return;

    this.sending.set(true);
    try {
      await this.emailService.sendEmail(this.to(), this.subject(), this.body(), this.cc(), this.bcc());
      this.close.emit();
    } catch (err) {
      console.error('Failed to send email', err);
    } finally {
      this.sending.set(false);
    }
  }

  onClose(): void {
    this.close.emit();
  }
}
