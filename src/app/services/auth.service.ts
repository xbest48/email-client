import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export interface UserProfile {
  email: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  private readonly userProfile = signal<UserProfile | null>(null);
  private readonly authenticated = signal(false);
  readonly loginError = signal('');

  readonly isAuthenticated = computed(() => this.authenticated());
  readonly user = computed(() => this.userProfile());

  async checkAuthStatus(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ authenticated: boolean; user?: UserProfile }>(
          `${this.apiUrl}/auth/status`,
          { withCredentials: true }
        )
      );
      this.authenticated.set(res.authenticated);
      if (res.authenticated && res.user) {
        this.userProfile.set(res.user);
      }
    } catch {
      this.authenticated.set(false);
    }
  }

  async signIn(credentials: LoginCredentials): Promise<boolean> {
    this.loginError.set('');
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; user: UserProfile }>(
          `${this.apiUrl}/auth/login`,
          credentials,
          { withCredentials: true }
        )
      );
      this.authenticated.set(true);
      this.userProfile.set(res.user);
      return true;
    } catch (err: unknown) {
      const message =
        (err as { error?: { error?: string } })?.error?.error || 'Connexion echouee';
      this.loginError.set(message);
      return false;
    }
  }

  async signOut(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${this.apiUrl}/auth/logout`, {}, { withCredentials: true })
      );
    } catch {
      // ignore
    }
    this.authenticated.set(false);
    this.userProfile.set(null);
  }
}
