import { Injectable, inject } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

/** Minimum delay between two update checks triggered by the app regaining focus. */
const UPDATE_CHECK_MIN_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Keeps the installed app (desktop PWA) in sync with the deployed version.
 *
 * The service worker serves the cached build until told otherwise. An app
 * left open for days never picked up a new deploy, and once the old version
 * was evicted its lazy-loaded chunks could no longer be fetched: navigation
 * broke until the app was closed and reopened.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly router = inject(Router);

  private updateReady = false;
  private lastCheckAt = Date.now();

  constructor() {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe(() => {
        this.updateReady = true;
      });

    // The cached version is broken (files evicted, hash mismatch): only a
    // full reload recovers.
    this.swUpdate.unrecoverable.subscribe(() => {
      document.location.reload();
    });

    // Apply a pending update on the next in-app navigation, as a full page
    // load: the user is leaving the current screen anyway, so nothing typed
    // in it is lost.
    this.router.events
      .pipe(filter((event): event is NavigationStart => event instanceof NavigationStart))
      .subscribe((event) => {
        if (!this.updateReady) return;
        this.updateReady = false;
        document.location.assign(event.url);
      });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkForUpdateThrottled();
    });
  }

  private checkForUpdateThrottled(): void {
    if (Date.now() - this.lastCheckAt < UPDATE_CHECK_MIN_INTERVAL_MS) return;
    this.lastCheckAt = Date.now();
    this.swUpdate.checkForUpdate().catch(() => {
      // Offline or server unreachable: try again on a later focus.
    });
  }
}
