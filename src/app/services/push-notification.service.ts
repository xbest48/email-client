import { Injectable, inject, signal, DestroyRef, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService } from './auth.service';

/**
 * Wraps `SwPush` (the ngsw-built-in service worker handles the OS-level
 * notification when a push lands while the app is closed) plus our backend
 * subscription store.
 *
 * The SW only runs in production builds (see `provideServiceWorker` in
 * app.config.ts), so this service silently no-ops in `ng serve`.
 *
 * Why a separate service from NotificationService? Web Push and the plain
 * Notification API are different beasts — Push works while the app is closed
 * but requires a server, a subscription, VAPID keys, and (on iOS) PWA
 * installation. Splitting them keeps the UX wiring honest.
 */
@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly http = inject(HttpClient);
  private readonly swPush = inject(SwPush);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly apiUrl = environment.apiUrl;

  /** Browser support for Web Push + service workers. */
  readonly supported = signal(this.detectSupport());

  /** True iff there is a live PushSubscription currently registered. */
  readonly subscribed = signal(false);

  /**
   * iOS Safari needs the PWA to be installed (Add to Home Screen) for Web
   * Push to be available. We expose this so the Settings screen can show a
   * dedicated explanation instead of a generic "not supported" message.
   */
  readonly isStandalone = signal(this.detectStandalone());
  readonly isIos = signal(this.detectIos());

  private renewalChecked = false;

  constructor() {
    if (this.swPush.isEnabled) {
      // Track current subscription state so the UI can reflect it.
      const sub = this.swPush.subscription.subscribe((s) => this.subscribed.set(!!s));
      this.destroyRef.onDestroy(() => sub.unsubscribe());

      // When the user clicks a push, the ngsw SW forwards the event here.
      const click = this.swPush.notificationClicks.subscribe((event) => {
        try { window.focus(); } catch { /* noop */ }
        const data = (event.notification.data ?? {}) as { url?: string; folder?: string; uid?: number };
        let url = data.url;
        if (!url && data.folder && data.uid !== undefined) {
          url = `/email/${encodeURIComponent(data.folder)}/${data.uid}`;
        }
        void this.router.navigateByUrl(url ?? '/inbox');
      });
      this.destroyRef.onDestroy(() => click.unsubscribe());

      // After login, if the user has push enabled, verify the local
      // subscription still matches the server's current VAPID public key.
      // If the operator rotated the keys, transparently renew the
      // subscription so the user keeps receiving pushes without manual
      // intervention.
      effect(() => {
        const user = this.auth.user();
        if (!user || !user.pushNotificationsEnabled) return;
        if (this.renewalChecked) return;
        this.renewalChecked = true;
        void this.ensureSubscriptionMatchesServerKey();
      });
    }
  }

  private async ensureSubscriptionMatchesServerKey(): Promise<void> {
    try {
      const current = await firstValueFrom(this.swPush.subscription);
      if (!current) return;

      const { publicKey } = await firstValueFrom(
        this.http.get<{ publicKey: string }>(`${this.apiUrl}/push/vapid-public-key`, { withCredentials: true }),
      );
      if (!publicKey) return;

      const localKey = this.applicationServerKeyAsBase64Url(current);
      if (!localKey || localKey === publicKey) return;

      // VAPID key rotated server-side. Drop the stale row + the local
      // subscription, then re-subscribe with the new key. Permission was
      // already granted, so requestSubscription() does not prompt again.
      try {
        await firstValueFrom(
          this.http.request('DELETE', `${this.apiUrl}/push/subscribe`, {
            body: { endpoint: current.endpoint },
            withCredentials: true,
          }),
        );
      } catch { /* ignore — server may have already pruned it */ }
      try { await this.swPush.unsubscribe(); } catch { /* ignore */ }
      await this.enable();
    } catch {
      // Best-effort: never let a renewal check break the app.
    }
  }

  private applicationServerKeyAsBase64Url(sub: PushSubscription): string | null {
    try {
      const key = sub.options?.applicationServerKey;
      if (!key) return null;
      const bytes = new Uint8Array(key as ArrayBuffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch {
      return null;
    }
  }

  /**
   * Subscribe the browser to the push service and persist the subscription on
   * the backend. MUST be called from a user gesture so the permission prompt
   * is allowed to show.
   */
  async enable(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.supported()) {
      return { ok: false, reason: 'Votre navigateur ne supporte pas les notifications push.' };
    }
    if (!this.swPush.isEnabled) {
      return { ok: false, reason: 'Le service worker n\'est pas actif (les notifications push sont disponibles uniquement en production).' };
    }
    if (this.isIos() && !this.isStandalone()) {
      return {
        ok: false,
        reason: 'Sur iOS, ajoutez Kyma a votre ecran d\'accueil avant d\'activer les notifications push.',
      };
    }

    try {
      const { publicKey } = await firstValueFrom(
        this.http.get<{ publicKey: string }>(`${this.apiUrl}/push/vapid-public-key`, { withCredentials: true }),
      );
      if (!publicKey) {
        return { ok: false, reason: 'Le serveur n\'expose pas de cle VAPID.' };
      }

      const subscription = await this.swPush.requestSubscription({ serverPublicKey: publicKey });
      const json = subscription.toJSON();
      const keys = (json.keys ?? {}) as { p256dh?: string; auth?: string };
      if (!json.endpoint || !keys.p256dh || !keys.auth) {
        return { ok: false, reason: 'L\'abonnement push est incomplet.' };
      }

      await firstValueFrom(
        this.http.post(`${this.apiUrl}/push/subscribe`, {
          endpoint: json.endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          userAgent: navigator.userAgent,
        }, { withCredentials: true }),
      );

      await this.auth.updateSettings({ pushNotificationsEnabled: true });
      this.subscribed.set(true);
      return { ok: true };
    } catch (err: any) {
      const message = err?.message || 'Impossible d\'activer les notifications push.';
      return { ok: false, reason: message };
    }
  }

  /** Unsubscribe locally + clean up the server-side row. */
  async disable(): Promise<void> {
    try {
      const current = await firstValueFrom(this.swPush.subscription);
      if (current) {
        await firstValueFrom(
          this.http.request('DELETE', `${this.apiUrl}/push/subscribe`, {
            body: { endpoint: current.endpoint },
            withCredentials: true,
          }),
        );
        await this.swPush.unsubscribe();
      }
    } catch {
      // Best-effort: still flip the user preference off so the UI is honest.
    }
    await this.auth.updateSettings({ pushNotificationsEnabled: false });
    this.subscribed.set(false);
  }

  /** Sends a server-side push to all the user's registered subscriptions. */
  async sendTest(): Promise<{ sent: number; removed: number }> {
    return firstValueFrom(
      this.http.post<{ sent: number; removed: number }>(
        `${this.apiUrl}/push/test`,
        {},
        { withCredentials: true },
      ),
    );
  }

  private detectSupport(): boolean {
    try {
      return typeof window !== 'undefined'
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window;
    } catch {
      return false;
    }
  }

  private detectStandalone(): boolean {
    try {
      const mq = window.matchMedia?.('(display-mode: standalone)').matches;
      const iosStandalone = (navigator as any).standalone === true;
      return !!(mq || iosStandalone);
    } catch {
      return false;
    }
  }

  private detectIos(): boolean {
    try {
      const ua = navigator.userAgent || '';
      return /iPhone|iPad|iPod/i.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
    } catch {
      return false;
    }
  }
}
