import { Component, inject, signal, ChangeDetectionStrategy, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
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

  private shortcutSub?: Subscription;

  ngOnInit(): void {
    this.emailService.fetchFolders();
    this.labelService.fetchLabels();
    this.snoozeService.fetchCount();
    this.pgpService.loadFromServer();
    this.checkMobile();

    this.shortcutSub = this.shortcutService.actions.subscribe((action) => {
      switch (action) {
        case 'compose':
          this.showCompose.set(true);
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
          // The search bar will handle this via its own subscription
          break;
      }
    });
  }

  ngOnDestroy(): void {
    this.shortcutSub?.unsubscribe();
  }

  onSearch(query: string): void {
    if (query) {
      this.router.navigate(['/inbox'], { queryParams: { q: query } });
    } else {
      this.router.navigate(['/inbox']);
    }
  }

  onSignOut(): void {
    this.auth.signOut();
    this.router.navigate(['/login']);
  }

  isMobile(): boolean {
    return window.innerWidth < 1024;
  }

  private checkMobile(): void {
    if (this.isMobile()) {
      this.sidebarOpen.set(false);
    }
  }
}
