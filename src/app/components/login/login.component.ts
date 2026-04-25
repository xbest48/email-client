import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { startAuthentication } from '@simplewebauthn/browser';
import { KymaLogoComponent } from '../kyma-logo/kyma-logo.component';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, KymaLogoComponent],
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
  readonly rememberMe = signal(false);
  private pendingTempToken: string | null = null;

  constructor() {
    // If the user lands on /login while a refresh cookie is still valid,
    // attempt a silent session restore and redirect to inbox. Without this,
    // browsers that auto-complete to /login in the address bar (or saved
    // bookmarks pointing here) bypass the authGuard on '/' and the user
    // sees the login form despite having a live session.
    void this.auth.getInitialLoadPromise()?.then(() => {
      if (this.auth.isAuthenticated()) {
        this.router.navigate(['/inbox']);
      }
    });
  }

  async onSignIn(): Promise<void> {
    if (this.requires2FA()) {
      if (!this.totpCode()) return;
      this.loading.set(true);
      const success = await this.auth.verify2FA(this.pendingTempToken!, this.totpCode(), this.rememberMe());
      this.loading.set(false);
      if (success) {
        this.router.navigate(['/inbox']);
      }
      return;
    }

    if (!this.email() || !this.password()) return;

    this.loading.set(true);
    const result = await this.auth.signIn(
      {
        email: this.email(),
        password: this.password(),
      },
      this.rememberMe(),
    );
    this.loading.set(false);

    if (result.requires2FA && result.tempToken) {
      this.requires2FA.set(true);
      this.pendingTempToken = result.tempToken;
    } else if (result.success) {
      this.router.navigate(['/inbox']);
    }
  }

  async onPasskeySignIn(): Promise<void> {
    this.loading.set(true);
    this.auth.loginError.set('');

    // Hybrid flow: if an email is provided we scope the challenge to that
    // user (keeps working for legacy passkeys registered without a resident
    // key). Otherwise we fall back to a usernameless/discoverable credential
    // challenge and let the browser pick among resident keys for this site.
    const emailValue = this.email();
    const useUsernameless = !emailValue;

    try {
      const optionsPayload = useUsernameless ? {} : { email: emailValue };
      const options = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/auth/webauthn/login/generate-options`, optionsPayload)
      );

      const asseResp = await startAuthentication({ optionsJSON: options });

      const result = await this.auth.signInWithWebAuthn(
        useUsernameless ? null : emailValue,
        asseResp,
        this.rememberMe(),
      );

      if (result.requires2FA && result.tempToken) {
        this.requires2FA.set(true);
        this.pendingTempToken = result.tempToken;
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
