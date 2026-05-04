import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { OAuthMailProvider } from './settings.service';

interface OauthResultMessage {
  type: 'oauth-mail-result';
  ok: boolean;
  email?: string;
  message?: string;
  provider?: OAuthMailProvider;
}

/**
 * Drives the popup-based OAuth2 flow used to connect Microsoft / Google
 * accounts via XOAUTH2. The actual token exchange happens server-side; the
 * popup just shuttles the user through the provider's consent screen and
 * posts a result message back to this window.
 */
@Injectable({ providedIn: 'root' })
export class OauthMailService {
  private readonly http = inject(HttpClient);

  /** Providers the backend has been configured for (env vars present). */
  readonly availableProviders = signal<OAuthMailProvider[]>([]);
  private providersLoaded = false;

  async loadAvailableProviders(): Promise<OAuthMailProvider[]> {
    if (this.providersLoaded) return this.availableProviders();
    try {
      const res = await firstValueFrom(
        this.http.get<{ providers: OAuthMailProvider[] }>('/api/oauth-mail/providers'),
      );
      this.providersLoaded = true;
      this.availableProviders.set(res.providers ?? []);
      return res.providers ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Open the provider's consent screen in a popup. Resolves with the result
   * message posted back from the popup; rejects if the user closes the popup
   * before completing the flow.
   */
  async connect(provider: OAuthMailProvider): Promise<{ email: string }> {
    const popup = window.open(
      `/api/oauth-mail/${provider}/start`,
      'kyma-oauth-mail',
      'width=520,height=720,resizable=yes,scrollbars=yes',
    );
    if (!popup) {
      throw new Error("Popup bloque par le navigateur. Autorisez les popups pour ce site.");
    }

    return new Promise((resolve, reject) => {
      const expectedOrigin = window.location.origin;
      let watchdog: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        if (watchdog !== null) {
          clearInterval(watchdog);
          watchdog = null;
        }
      };

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== expectedOrigin) return;
        const data = event.data as OauthResultMessage | undefined;
        if (!data || data.type !== 'oauth-mail-result') return;
        cleanup();
        if (data.ok && data.email) resolve({ email: data.email });
        else reject(new Error(data.message || 'Connexion OAuth annulee.'));
      };

      window.addEventListener('message', onMessage);

      // Detect popup-closed-without-completion so the caller can hide their
      // spinner instead of waiting forever.
      watchdog = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error('Fenetre OAuth fermee sans completer la connexion.'));
        }
      }, 500);
    });
  }
}
