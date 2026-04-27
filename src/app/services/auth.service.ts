import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export type ImagePolicy = 'ask' | 'always' | 'never';
export type AiProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'other';
export type DarkEmailRendering = 'preserve' | 'force-dark';
export type AiFeaturePreferenceKey =
  | 'aiComposeEnabled'
  | 'aiSummaryEnabled'
  | 'aiReplySuggestionsEnabled'
  | 'aiActionExtractionEnabled'
  | 'aiPhishingEnabled'
  | 'aiCategorizationEnabled'
  | 'aiTranslationEnabled'
  | 'aiTriageEnabled';

export interface UserProfile {
  id?: string;
  email: string;
  darkMode?: boolean;
  undoSendDelay?: number;
  blockTrackingPixels?: boolean;
  imagePolicy?: ImagePolicy;
  imageAllowedDomains?: string[];
  imageBlockedDomains?: string[];
  hasAiApiKey?: boolean;
  hasOpenAiApiKey?: boolean;
  aiApiKey?: string;
  openAiApiKey?: string;
  aiProvider?: AiProvider;
  aiApiUrl?: string;
  isAiEnabled?: boolean;
  aiComposeEnabled?: boolean;
  aiSummaryEnabled?: boolean;
  aiReplySuggestionsEnabled?: boolean;
  aiActionExtractionEnabled?: boolean;
  aiPhishingEnabled?: boolean;
  aiCategorizationEnabled?: boolean;
  aiTranslationEnabled?: boolean;
  aiTriageEnabled?: boolean;
  hideAiHints?: boolean;
  pushNotificationsEnabled?: boolean;
  pushPayloadMode?: PushPayloadMode;
  darkEmailRendering?: DarkEmailRendering;
}

export type PushPayloadMode = 'subject' | 'sender-only' | 'generic';

export interface LoginCredentials {
  email: string;
  password?: string;
}

export interface ActiveSession {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  rememberMe: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  isCurrent: boolean;
}
@Injectable({ providedIn: 'root' })
export class AuthService {
  private static readonly TOKEN_STORAGE_KEY = 'auth_token';
  private static readonly TOKEN_STORAGE_MODE_KEY = 'auth_token_storage_mode';

  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  private readonly userProfile = signal<UserProfile | null>(null);
  private readonly authenticated = signal(false);
  private readonly token = signal<string | null>(null);
  readonly loginError = signal('');

  readonly isAuthenticated = computed(() => this.authenticated());
  readonly user = computed(() => this.userProfile());

  // We keep a promise to ensure we only load once on startup
  private initialLoadPromise: Promise<void> | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor() {
    this.clearStoredAccessTokens();
    // Defer the initial auth check to a microtask so the constructor finishes
    // and DI fully wires this instance before the HTTP interceptor runs and
    // re-injects AuthService — without this defer, the synchronous chain
    // constructor → checkAuthStatus → http.post → interceptor → inject(AuthService)
    // hits a partially-constructed instance and Angular blows up with a
    // "Cannot read properties of undefined" error in core.js, which silently
    // aborts the refresh attempt and forces the user to re-login.
    this.initialLoadPromise = Promise.resolve().then(() => this.checkAuthStatus());
    this.installVisibilityRefresh();
  }

  /**
   * Proactively refresh the access token when the tab regains focus after
   * being hidden or the machine waking from sleep. Without this, the first
   * few requests after wake-up hit the server with an expired access token
   * and produce a trail of `401 Unauthorized` noise in the console before
   * the interceptor's refresh-and-retry kicks in.
   */
  private installVisibilityRefresh(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      // Only refresh if we think we're logged in — otherwise a refresh would
      // be pointless and might race with an ongoing login flow.
      if (!this.authenticated()) return;
      void this.refreshAccessToken();
    });
  }

  getInitialLoadPromise(): Promise<void> | null {
    return this.initialLoadPromise;
  }

  getToken(): string | null {
    return this.token();
  }

  async checkAuthStatus(): Promise<void> {
    let currentToken = this.getToken();
    if (!currentToken) {
      const refreshed = await this.refreshAccessToken();
      currentToken = this.getToken();
      if (!refreshed || !currentToken) {
        this.authenticated.set(false);
        this.userProfile.set(null);
        return;
      }
    }

    try {
      // Using the new NestJS /api/auth/profile endpoint
      const user = await firstValueFrom(
        this.http.get<UserProfile>(`${this.apiUrl}/auth/profile`, { withCredentials: true })
      );
      this.token.set(currentToken);
      this.authenticated.set(true);
      this.userProfile.set(user);
    } catch (err: unknown) {
      const status = err instanceof HttpErrorResponse ? err.status : undefined;
      if (status === 401 || status === 403) {
        this.clearAuthState();
        return;
      }

      // Temporary backend/network failures should not wipe a valid stored token.
      this.token.set(currentToken);
    }
  }

  private setToken(newToken: string | null) {
    this.token.set(newToken);
    // Access tokens are intentionally memory-only. The httpOnly refresh cookie
    // restores the session after reload without exposing bearer tokens to XSS.
    this.clearStoredAccessTokens();
  }

  private clearStoredAccessTokens(): void {
    localStorage.removeItem(AuthService.TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(AuthService.TOKEN_STORAGE_KEY);
    localStorage.removeItem(AuthService.TOKEN_STORAGE_MODE_KEY);
    sessionStorage.removeItem(AuthService.TOKEN_STORAGE_MODE_KEY);
  }

  async register(credentials: LoginCredentials): Promise<boolean> {
    this.loginError.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<{ access_token: string }>(
          `${this.apiUrl}/auth/register`,
          credentials,
          { withCredentials: true },
        )
      );
      this.setToken(res.access_token);
      await this.checkAuthStatus();
      return true;
    } catch (err: unknown) {
      const message = (err as any)?.error?.message || 'Inscription echouee';
      this.loginError.set(message);
      return false;
    }
  }

  async signIn(
    credentials: LoginCredentials,
    rememberMe = false,
  ): Promise<{ success: boolean; requires2FA?: boolean; tempToken?: string }> {
    this.loginError.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<{ access_token?: string; isTwoFactorRequired?: boolean; temp_token?: string }>(
          `${this.apiUrl}/auth/login`,
          { ...credentials, rememberMe },
          { withCredentials: true },
        )
      );

      if (res.isTwoFactorRequired) {
        return { success: true, requires2FA: true, tempToken: res.temp_token };
      }

      if (res.access_token) {
        this.setToken(res.access_token);
        await this.checkAuthStatus();
        return { success: true };
      }
      return { success: false };
    } catch (err: unknown) {
      const message = (err as any)?.error?.message || 'Connexion echouee';
      this.loginError.set(message);
      return { success: false };
    }
  }

  async verify2FA(tempToken: string, code: string, rememberMe = false): Promise<boolean> {
    this.loginError.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<{ access_token: string }>(
          `${this.apiUrl}/auth/2fa/authenticate`,
          { tempToken, code, rememberMe },
          { withCredentials: true },
        )
      );
      this.setToken(res.access_token);
      await this.checkAuthStatus();
      return true;
    } catch (err: unknown) {
      const message = (err as any)?.error?.message || 'Code 2FA invalide';
      this.loginError.set(message);
      return false;
    }
  }

  async signInWithWebAuthn(
    email: string | null,
    response: any,
    rememberMe = false,
  ): Promise<{ success: boolean; requires2FA?: boolean; tempToken?: string }> {
    this.loginError.set('');
    try {
      const requestBody: { email?: string; response: any; rememberMe: boolean } = { response, rememberMe };
      if (email) {
        requestBody.email = email;
      }
      const res = await firstValueFrom(
        this.http.post<{ access_token?: string; isTwoFactorRequired?: boolean; temp_token?: string }>(
          `${this.apiUrl}/auth/webauthn/login/verify`,
          requestBody,
          { withCredentials: true },
        )
      );

      if (res.isTwoFactorRequired) {
        return { success: true, requires2FA: true, tempToken: res.temp_token };
      }

      if (res.access_token) {
        this.setToken(res.access_token);
        await this.checkAuthStatus();
        return { success: true };
      }
      return { success: false };
    } catch (err: unknown) {
      const message = (err as any)?.error?.message || 'Echec de l\'authentification par Passkey';
      this.loginError.set(message);
      return { success: false };
    }
  }

  async generate2FA(): Promise<{ otpauthUrl: string }> {
    return firstValueFrom(
      this.http.post<{ otpauthUrl: string }>(`${this.apiUrl}/auth/2fa/generate`, {}, { withCredentials: true })
    );
  }

  async turnOn2FA(code: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(`${this.apiUrl}/auth/2fa/turn-on`, { code }, { withCredentials: true })
      );
      return true;
    } catch {
      return false;
    }
  }

  async generateWebAuthnRegisterOptions(): Promise<any> {
    return firstValueFrom(
      this.http.get(`${this.apiUrl}/auth/webauthn/register/generate-options`, { withCredentials: true })
    );
  }

  async verifyWebAuthnRegister(response: any): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ verified: boolean }>(`${this.apiUrl}/auth/webauthn/register/verify`, response, { withCredentials: true })
      );
      return res.verified;
    } catch {
      return false;
    }
  }

  async updateSettings(settings: Partial<UserProfile>): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/auth/profile/settings`, settings, { withCredentials: true })
    );
    await this.checkAuthStatus();
  }

  async getActiveSessions(): Promise<ActiveSession[]> {
    return firstValueFrom(
      this.http.get<ActiveSession[]>(`${this.apiUrl}/auth/sessions`, { withCredentials: true })
    );
  }

  async revokeSessionById(sessionId: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/auth/sessions/${encodeURIComponent(sessionId)}/revoke`, {}, { withCredentials: true })
    );
  }

  async revokeOtherSessions(): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/auth/sessions/revoke-others`, {}, { withCredentials: true })
    );
  }

  async refreshAccessToken(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performRefreshAccessToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * If a refresh is in flight (e.g. kicked off by visibility-change), resolves
   * after it settles; otherwise resolves immediately. The interceptor awaits
   * this before attaching the access token so wake-from-sleep requests use the
   * newly-minted token instead of racing the old one into a guaranteed 401.
   */
  async awaitPendingRefresh(): Promise<void> {
    if (!this.refreshPromise) return;
    try {
      await this.refreshPromise;
    } catch {
      // Errors are handled by the initial caller (performRefreshAccessToken
      // already clears auth state). Here we just want to unblock.
    }
  }

  shouldAttachAccessToken(url: string): boolean {
    return !this.isPublicAuthRoute(url) && !this.isRefreshRoute(url) && !this.isLogoutRoute(url);
  }

  shouldAttemptRefresh(url: string): boolean {
    return !this.isPublicAuthRoute(url) && !this.isRefreshRoute(url) && !this.isLogoutRoute(url);
  }

  async signOut(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${this.apiUrl}/auth/logout`, {}, { withCredentials: true })
      );
    } catch {
      // Local cleanup still matters even if the backend is temporarily unavailable.
    } finally {
      this.clearAuthState();
    }
  }

  clearAuthState(): void {
    this.setToken(null);
    this.authenticated.set(false);
    this.userProfile.set(null);
  }

  private async performRefreshAccessToken(): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ access_token: string }>(
          `${this.apiUrl}/auth/refresh`,
          {},
          { withCredentials: true },
        )
      );

      this.setToken(res.access_token);
      return true;
    } catch {
      this.clearAuthState();
      return false;
    }
  }

  private isPublicAuthRoute(url: string): boolean {
    return [
      '/auth/login',
      '/auth/register',
      '/auth/2fa/authenticate',
      '/auth/webauthn/login/generate-options',
      '/auth/webauthn/login/verify',
    ].some((route) => url.includes(route));
  }

  private isRefreshRoute(url: string): boolean {
    return url.includes('/auth/refresh');
  }

  private isLogoutRoute(url: string): boolean {
    return url.includes('/auth/logout');
  }
}
