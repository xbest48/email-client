import { Injectable, inject, effect, DestroyRef } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { SettingsService } from './settings.service';
import { EmailService } from './email.service';

interface FolderStatus {
  path: string;
  messages: number;
  unseen: number;
  recent: number;
}

/**
 * Lightweight foreground watcher that polls the IMAP folder status endpoint
 * and fires an OS notification when the "unseen" counter increases. Runs only
 * when:
 *   - the user is authenticated
 *   - notifications are supported, granted, and opted-in
 *   - the document is visible (we pause when the tab is hidden to save both
 *     client and IMAP resources; the server already has per-endpoint rate
 *     limits but we want to be a good citizen)
 *
 * Why a poll and not a WebSocket? The backend currently has no event bus or
 * WS gateway. A 60s foreground poll per user keeps complexity low and still
 * delivers a usable experience. The watcher is trivial to replace with a
 * WebSocket/SSE listener later — just swap `tick()`.
 */
@Injectable({ providedIn: 'root' })
export class InboxWatcherService {
  private static readonly POLL_INTERVAL_MS = 60_000;

  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly settings = inject(SettingsService);
  private readonly emails = inject(EmailService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly apiUrl = environment.apiUrl;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastUnseen: number | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor() {
    // Start/stop automatically based on readiness. Readiness takes into
    // account auth, user setting, browser support and browser permission.
    effect(() => {
      const shouldRun = this.auth.isAuthenticated() && this.notifications.isReady();
      if (shouldRun) {
        this.start();
      } else {
        this.stop();
      }
    });

    this.destroyRef.onDestroy(() => this.stop());
  }

  private start(): void {
    if (this.timer) return;

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        // Immediate catch-up when the tab regains focus.
        void this.tick();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Prime the baseline quickly so a user who was already at, say, 42 unseen
    // when they logged in doesn't get spammed with "42 new messages".
    this.lastUnseen = null;
    void this.tick(/* baselineOnly */ true);

    this.timer = setInterval(() => { void this.tick(); }, InboxWatcherService.POLL_INTERVAL_MS);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.lastUnseen = null;
  }

  private async tick(baselineOnly = false): Promise<void> {
    if (document.visibilityState !== 'visible') return;

    // We need an account to target. `activeAccountId()` returns null until
    // the user has configured at least one IMAP account — silently skip.
    const accountId = this.settings.activeAccountId();
    if (!accountId) return;

    const inboxPath = this.resolveInboxPath();
    if (!inboxPath) return;

    const headers = new HttpHeaders({ 'x-account-id': accountId });

    try {
      const folder = encodeURIComponent(inboxPath);
      const status = await firstValueFrom(
        this.http.get<FolderStatus>(`${this.apiUrl}/folders/${folder}/status`, {
          headers,
          withCredentials: true,
        }),
      );
      const current = status?.unseen ?? 0;

      if (this.lastUnseen === null) {
        this.lastUnseen = current;
        return;
      }

      if (!baselineOnly && current > this.lastUnseen) {
        const delta = current - this.lastUnseen;
        this.notifications.notify(
          delta === 1 ? 'Nouveau message' : `${delta} nouveaux messages`,
          {
            body:
              delta === 1
                ? 'Vous avez reçu un nouveau message dans votre boîte de réception.'
                : `Vous avez reçu ${delta} nouveaux messages dans votre boîte de réception.`,
            tag: 'mailflow-inbox',
            onClick: () => { void this.router.navigate(['/']); },
          },
        );
      }

      this.lastUnseen = current;
    } catch {
      // Network or auth glitch — swallow and retry on next tick. Don't reset
      // lastUnseen here so a transient error doesn't trigger a spurious
      // notification on recovery.
    }
  }

  /**
   * Best-effort inbox path resolution. Matches EmailService.getInboxFolderPath
   * so we hit the same folder the rest of the app treats as the inbox.
   * Falls back to "INBOX" which is the IMAP spec default.
   */
  private resolveInboxPath(): string {
    const folders = this.emails.folders();
    const bySpecial = folders.find((f) => f.specialUse === '\\Inbox');
    if (bySpecial) return bySpecial.path;
    const byName = folders.find((f) => f.path.toLowerCase() === 'inbox');
    if (byName) return byName.path;
    // Folders haven't been fetched yet — fall back to the canonical name.
    return 'INBOX';
  }
}
