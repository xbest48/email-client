import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly imapHost = signal('');
  readonly imapPort = signal(993);
  readonly smtpHost = signal('');
  readonly smtpPort = signal(465);
  readonly loading = signal(false);
  readonly showAdvanced = signal(false);

  async onSignIn(): Promise<void> {
    if (!this.email() || !this.password() || !this.imapHost() || !this.smtpHost()) return;

    this.loading.set(true);
    const success = await this.auth.signIn({
      email: this.email(),
      password: this.password(),
      imapHost: this.imapHost(),
      imapPort: this.imapPort(),
      smtpHost: this.smtpHost(),
      smtpPort: this.smtpPort(),
    });
    this.loading.set(false);

    if (success) {
      this.router.navigate(['/inbox']);
    }
  }

  onEmailChange(): void {
    const email = this.email();
    const domain = email.split('@')[1];
    if (domain && !this.imapHost()) {
      this.imapHost.set(`imap.${domain}`);
      this.smtpHost.set(`smtp.${domain}`);
    }
  }
}
