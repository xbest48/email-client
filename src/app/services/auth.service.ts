import { Injectable, signal, computed } from '@angular/core';
import { environment } from '../environments/environment';

declare const google: {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: { access_token: string; error?: string; expires_in: number }) => void;
      }): { requestAccessToken(): void };
    };
  };
};

export interface UserProfile {
  email: string;
  name: string;
  picture: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly accessToken = signal<string>('');
  private readonly userProfile = signal<UserProfile | null>(null);
  private readonly tokenExpiry = signal<number>(0);

  readonly isAuthenticated = computed(() => {
    const token = this.accessToken();
    const expiry = this.tokenExpiry();
    return !!token && Date.now() < expiry;
  });

  readonly user = computed(() => this.userProfile());
  readonly token = computed(() => this.accessToken());

  signIn(): void {
    if (typeof google === 'undefined') {
      console.error('Google Identity Services not loaded');
      return;
    }

    const client = google.accounts.oauth2.initTokenClient({
      client_id: environment.googleClientId,
      scope: environment.scopes,
      callback: (response) => {
        if (response.error) {
          console.error('Auth error:', response.error);
          return;
        }
        this.accessToken.set(response.access_token);
        this.tokenExpiry.set(Date.now() + response.expires_in * 1000);
        this.fetchUserProfile(response.access_token);
      },
    });

    client.requestAccessToken();
  }

  signOut(): void {
    this.accessToken.set('');
    this.userProfile.set(null);
    this.tokenExpiry.set(0);
  }

  getAuthHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken()}` };
  }

  private async fetchUserProfile(token: string): Promise<void> {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      this.userProfile.set({
        email: data.email,
        name: data.name,
        picture: data.picture,
      });
    } catch (err) {
      console.error('Failed to fetch user profile', err);
    }
  }
}
