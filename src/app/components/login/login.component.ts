import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { startAuthentication } from '@simplewebauthn/browser';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  readonly email = signal('');
  readonly password = signal('');
  readonly totpCode = signal('');
  readonly loading = signal(false);
  readonly requires2FA = signal(false);
  private pendingUserId: string | null = null;

  async onSignIn(): Promise<void> {
    if (this.requires2FA()) {
      if (!this.totpCode()) return;
      this.loading.set(true);
      const success = await this.auth.verify2FA(this.pendingUserId!, this.totpCode());
      this.loading.set(false);
      if (success) {
        this.router.navigate(['/inbox']);
      }
      return;
    }

    if (!this.email() || !this.password()) return;

    this.loading.set(true);
    const result = await this.auth.signIn({
      email: this.email(),
      password: this.password(),
    });
    this.loading.set(false);

    if (result.requires2FA && result.userId) {
      this.requires2FA.set(true);
      this.pendingUserId = result.userId;
    } else if (result.success) {
      this.router.navigate(['/inbox']);
    }
  }

  async onPasskeySignIn(): Promise<void> {
    if (!this.email()) return;
    this.loading.set(true);
    this.auth.loginError.set('');

    try {
      const options = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/auth/webauthn/login/generate-options`, { email: this.email() })
      );

      const asseResp = await startAuthentication({ optionsJSON: options });

      const result = await this.auth.signInWithWebAuthn(this.email(), asseResp);

      if (result.requires2FA && result.userId) {
        this.requires2FA.set(true);
        this.pendingUserId = result.userId;
      } else if (result.success) {
        this.router.navigate(['/inbox']);
      }
    } catch (err: any) {
      this.auth.loginError.set(err.message || 'Authentification Passkey echouee');
    } finally {
      this.loading.set(false);
    }
  }

  onEmailChange(): void {
    // Only used for UI feedback if needed
  }
}
