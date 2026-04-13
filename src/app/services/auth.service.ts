import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export type ImagePolicy = 'ask' | 'always' | 'never';

export interface UserProfile {
  id?: string;
  email: string;
  darkMode?: boolean;
  undoSendDelay?: number;
  blockTrackingPixels?: boolean;
  imagePolicy?: ImagePolicy;
  imageAllowedDomains?: string[];
  imageBlockedDomains?: string[];
}

export interface LoginCredentials {
  email: string;
  password?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  private readonly userProfile = signal<UserProfile | null>(null);
  private readonly authenticated = signal(false);
  private readonly token = signal<string | null>(localStorage.getItem('auth_token'));
  readonly loginError = signal('');

  readonly isAuthenticated = computed(() => this.authenticated());
  readonly user = computed(() => this.userProfile());

  // We keep a promise to ensure we only load once on startup
  private initialLoadPromise: Promise<void> | null = null;

  constructor() {
    this.initialLoadPromise = this.checkAuthStatus();
  }

  getInitialLoadPromise(): Promise<void> | null {
    return this.initialLoadPromise;
  }

  getToken(): string | null {
    return this.token();
  }

  async checkAuthStatus(): Promise<void> {
    const currentToken = this.token();
    if (!currentToken) {
      this.authenticated.set(false);
      this.userProfile.set(null);
      return;
    }

    try {
      // Using the new NestJS /api/auth/profile endpoint
      const user = await firstValueFrom(
        this.http.get<UserProfile>(`${this.apiUrl}/auth/profile`)
      );
      this.authenticated.set(true);
      this.userProfile.set(user);
    } catch {
      this.setToken(null);
      this.authenticated.set(false);
      this.userProfile.set(null);
    }
  }

  private setToken(newToken: string | null) {
    this.token.set(newToken);
    if (newToken) {
      localStorage.setItem('auth_token', newToken);
    } else {
      localStorage.removeItem('auth_token');
    }
  }

  async register(credentials: LoginCredentials): Promise<boolean> {
    this.loginError.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<{ access_token: string }>(
          `${this.apiUrl}/auth/register`,
          credentials
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

  async signIn(credentials: LoginCredentials): Promise<{ success: boolean; requires2FA?: boolean; tempToken?: string }> {
    this.loginError.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<{ access_token?: string; isTwoFactorRequired?: boolean; temp_token?: string }>(
          `${this.apiUrl}/auth/login`,
          credentials
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

  async verify2FA(tempToken: string, code: string): Promise<boolean> {
    this.loginError.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<{ access_token: string }>(`${this.apiUrl}/auth/2fa/authenticate`, { tempToken, code })
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

  async signInWithWebAuthn(email: string | null, response: any): Promise<{ success: boolean; requires2FA?: boolean; tempToken?: string }> {
    this.loginError.set('');
    try {
      const payload: { email?: string; response: any } = { response };
      if (email) {
        payload.email = email;
      }
      const res = await firstValueFrom(
        this.http.post<{ access_token?: string; isTwoFactorRequired?: boolean; temp_token?: string }>(
          `${this.apiUrl}/auth/webauthn/login/verify`,
          payload
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
      this.http.post<{ otpauthUrl: string }>(`${this.apiUrl}/auth/2fa/generate`, {})
    );
  }

  async turnOn2FA(code: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(`${this.apiUrl}/auth/2fa/turn-on`, { code })
      );
      return true;
    } catch {
      return false;
    }
  }

  async generateWebAuthnRegisterOptions(): Promise<any> {
    return firstValueFrom(
      this.http.get(`${this.apiUrl}/auth/webauthn/register/generate-options`)
    );
  }

  async verifyWebAuthnRegister(response: any): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ verified: boolean }>(`${this.apiUrl}/auth/webauthn/register/verify`, response)
      );
      return res.verified;
    } catch {
      return false;
    }
  }

  async updateSettings(settings: Partial<UserProfile>): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/auth/profile/settings`, settings)
    );
    await this.checkAuthStatus();
  }

  signOut(): void {
    this.setToken(null);
    this.authenticated.set(false);
    this.userProfile.set(null);
  }
}
