import { Component, inject, signal, ChangeDetectionStrategy, OnInit, OnDestroy, viewChild, effect } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { SearchBarComponent } from '../search-bar/search-bar.component';
import { ComposeComponent } from '../compose/compose.component';
import { SettingsComponent } from '../settings/settings.component';
import { ShortcutsHelpComponent } from '../shortcuts-help/shortcuts-help.component';
import { AuthService } from '../../services/auth.service';
import { EmailService } from '../../services/email.service';
import { LabelService } from '../../services/label.service';
import { SnoozeService } from '../../services/snooze.service';
import { OfflineService } from '../../services/offline.service';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { PgpService } from '../../services/pgp.service';

@Component({
  selector: 'app-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, SidebarComponent, SearchBarComponent, ComposeComponent, SettingsComponent, ShortcutsHelpComponent],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.css',
})
export class LayoutComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  protected readonly emailService = inject(EmailService);
  protected readonly labelService = inject(LabelService);
  protected readonly snoozeService = inject(SnoozeService);
  protected readonly offlineService = inject(OfflineService);
  protected readonly shortcutService = inject(KeyboardShortcutService);
  private readonly pgpService = inject(PgpService);
  private readonly router = inject(Router);

  readonly sidebarOpen = signal(true);
  readonly showCompose = signal(false);
  readonly showSettings = signal(false);
  readonly showShortcuts = signal(false);
  readonly activeSearchQuery = signal('');
  readonly searchBar = viewChild(SearchBarComponent);

  private shortcutSub?: Subscription;
  private routerSub?: Subscription;

  constructor() {
    // Open the compose modal whenever another part of the app drops a prefill
    // hint (e.g. the paper-plane button in email detail). ComposeComponent
    // consumes and clears the signal on its own init.
    effect(() => {
      if (this.emailService.composePrefill()) {
        this.openCompose();
      }
    });
  }

  async ngOnInit(): Promise<void> {
    // Wait for the initial auth check to settle before firing any API calls.
    // Without this, fetchFolders / fetchLabels / etc. race with an in-flight
    // token refresh (triggered when the tab is restored after sleep or a
    // browser tab-discard cycle), hit the server with an expired access token,
    // and produce a flood of 401 errors in the console — even though the
    // interceptor would have retried them successfully after the refresh.
    await (this.auth.getInitialLoadPromise() ?? Promise.resolve());
    if (!this.auth.isAuthenticated()) return;

    this.emailService.fetchFolders();
    this.labelService.fetchLabels();
    this.snoozeService.fetchCount();
    this.pgpService.loadFromServer();
    this.checkMobile();

    this.shortcutSub = this.shortcutService.actions.subscribe((action) => {
      switch (action) {
        case 'compose':
          this.openCompose();
          break;
        case 'closeModal':
          if (this.showShortcuts()) this.showShortcuts.set(false);
          else if (this.showSettings()) this.showSettings.set(false);
          else if (this.showCompose()) this.showCompose.set(false);
          break;
        case 'showHelp':
          this.showShortcuts.set(!this.showShortcuts());
          break;
        case 'focusSearch':
          this.focusSearch();
          break;
      }
    });

    this.syncSearchStateFromUrl(this.router.url);
    this.routerSub = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.syncSearchStateFromUrl(event.urlAfterRedirects);
        if (this.isMobile()) {
          this.sidebarOpen.set(false);
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.shortcutSub?.unsubscribe();
    this.routerSub?.unsubscribe();
  }

  onSearch(query: string): void {
    const target = this.resolveSearchTargetRoute();
    if (query) {
      this.router.navigate(target, { queryParams: { q: query } });
    } else {
      this.router.navigate(target);
    }
  }

  openCompose(): void {
    this.showCompose.set(true);
    if (this.isMobile()) {
      this.sidebarOpen.set(false);
    }
  }

  focusSearch(): void {
    if (this.isMobile()) {
      this.sidebarOpen.set(false);
    }
    this.searchBar()?.focusInput();
  }

  async onSignOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }

  isMobile(): boolean {
    return window.innerWidth < 1024;
  }

  private checkMobile(): void {
    if (this.isMobile()) {
      this.sidebarOpen.set(false);
    }
  }

  private syncSearchStateFromUrl(url: string): void {
    const parsed = this.router.parseUrl(url);
    this.activeSearchQuery.set(parsed.queryParams['q'] ?? '');
  }

  private resolveSearchTargetRoute(): string[] {
    const parsed = this.router.parseUrl(this.router.url);
    const segments = parsed.root.children['primary']?.segments.map((segment) => segment.path) ?? [];

    if (segments[0] === 'folder' && segments[1]) {
      return ['/folder', segments[1]];
    }

    if (segments[0] === 'email' && segments[1]) {
      return ['/folder', segments[1]];
    }

    if (segments[0]) {
      return ['/', segments[0]];
    }

    return ['/inbox'];
  }
}
