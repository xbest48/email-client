import { Injectable, signal, computed, effect, inject, DestroyRef } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

export type NotificationPermissionState = NotificationPermission | 'unsupported';

export interface NotifyOptions {
  body?: string;
  tag?: string;
  /** If true, the notification stays on screen until the user interacts. */
  requireInteraction?: boolean;
  /** Called on click (focuses the window first). Defaults to navigating to `/`. */
  onClick?: () => void;
  /** Override the default icon. */
  icon?: string;
  /** Millisecond auto-close delay for non-sticky notifications. 0 = never auto-close. */
  autoCloseMs?: number;
}

/**
 * Thin wrapper around the Web Notification API.
 *
 * Why not Push API? Push requires a VAPID-keyed backend push server and a
 * service worker subscription per user. MailFlow has no event bus yet, so the
 * incremental gain doesn't justify the complexity. The plain Notification API
 * works great as long as the tab is open, which is the common case for a web
 * mail client running in a pinned tab.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private static readonly DEFAULT_ICON = '/favicon.png';
  private static readonly DEFAULT_AUTO_CLOSE_MS = 7_000;

  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  /** Browser capability. `false` for non-HTTPS contexts, iOS Safari in-tab, or older browsers. */
  readonly supported = signal(this.detectSupport());
  /** OS/browser-level permission state. */
  readonly permission = signal<NotificationPermissionState>(this.currentPermission());
  /** User setting (persisted server-side). */
  readonly userEnabled = computed(() => this.authService.user()?.desktopNotificationsEnabled ?? false);

  /** True when we can effectively fire notifications right now. */
  readonly isReady = computed(
    () => this.supported() && this.permission() === 'granted' && this.userEnabled(),
  );

  constructor() {
    // Keep the permission signal in sync: the user may change browser-level
    // permission from site settings while the app is open. We re-sample on
    // visibility change.
    const onVisibility = () => this.permission.set(this.currentPermission());
    document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onVisibility));

    // Opportunistic auto-sync on login: if the user's stored preference is ON
    // but the browser still shows 'default', we don't prompt silently — the
    // settings toggle is in charge of prompting. We only resample here.
    effect(() => {
      // touch the user signal to re-run when profile changes
      this.authService.user();
      this.permission.set(this.currentPermission());
    });
  }

  /**
   * Ask the OS/browser for permission. MUST be called from a user gesture
   * (click handler) — most browsers otherwise ignore the prompt or return
   * `default`. Returns the resulting permission.
   */
  async requestPermission(): Promise<NotificationPermissionState> {
    if (!this.supported()) return 'unsupported';
    try {
      const result = await Notification.requestPermission();
      this.permission.set(result);
      return result;
    } catch {
      // Some browsers throw instead of returning 'denied'.
      this.permission.set('denied');
      return 'denied';
    }
  }

  /**
   * Show a notification if everything lines up (supported + granted + user opt-in).
   * Silently no-ops otherwise; callers don't need to guard.
   */
  notify(title: string, options: NotifyOptions = {}): Notification | null {
    if (!this.isReady()) return null;
    // Don't pop a notification over the user's face if they're actively looking
    // at the tab — they already see the new mail in the list.
    if (document.visibilityState === 'visible' && !options.requireInteraction) {
      return null;
    }

    try {
      const n = new Notification(title, {
        body: options.body,
        tag: options.tag,
        icon: options.icon ?? NotificationService.DEFAULT_ICON,
        requireInteraction: !!options.requireInteraction,
        silent: false,
      });

      n.onclick = () => {
        try { window.focus(); } catch { /* cross-origin isolation, ignore */ }
        if (options.onClick) {
          options.onClick();
        } else {
          void this.router.navigate(['/']);
        }
        n.close();
      };

      const autoClose = options.autoCloseMs ?? NotificationService.DEFAULT_AUTO_CLOSE_MS;
      if (autoClose > 0 && !options.requireInteraction) {
        setTimeout(() => { try { n.close(); } catch { /* noop */ } }, autoClose);
      }

      return n;
    } catch {
      return null;
    }
  }

  /**
   * Triggered from the "Test" button in settings. Bypasses the visibility
   * guard. Returns a structured result so the UI can surface the reason when
   * nothing shows up (OS Focus mode, Chrome site block, …).
   */
  testNotification(): { ok: boolean; reason?: string } {
    if (!this.supported()) {
      return { ok: false, reason: 'Votre navigateur ne supporte pas les notifications.' };
    }
    // Re-sample: the OS permission could have been revoked since last signal
    // update. Reading Notification.permission directly is the source of truth.
    const live = this.currentPermission();
    this.permission.set(live);
    if (live !== 'granted') {
      return {
        ok: false,
        reason: live === 'denied'
          ? "Les notifications sont bloquées pour ce site dans votre navigateur."
          : "L'autorisation des notifications n'a pas encore été accordée.",
      };
    }
    try {
      const n = new Notification('MailFlow — Notification de test', {
        body: 'Vous êtes bien configuré : les notifications bureau fonctionnent.',
        icon: NotificationService.DEFAULT_ICON,
        tag: 'mailflow-test',
      });
      n.onclick = () => {
        try { window.focus(); } catch { /* noop */ }
        n.close();
      };
      setTimeout(() => { try { n.close(); } catch { /* noop */ } }, 5_000);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: `Impossible d'afficher la notification (${(err as Error)?.message ?? 'erreur inconnue'}).`,
      };
    }
  }

  /** Update server-side preference; caller handles the prompt before flipping to true. */
  async setUserEnabled(enabled: boolean): Promise<void> {
    await this.authService.updateSettings({ desktopNotificationsEnabled: enabled });
  }

  private detectSupport(): boolean {
    try {
      return typeof window !== 'undefined' && 'Notification' in window;
    } catch {
      return false;
    }
  }

  private currentPermission(): NotificationPermissionState {
    if (!this.detectSupport()) return 'unsupported';
    try {
      return Notification.permission;
    } catch {
      return 'unsupported';
    }
  }
}
