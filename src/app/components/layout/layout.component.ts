import { Component, inject, signal, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { SearchBarComponent } from '../search-bar/search-bar.component';
import { ComposeComponent } from '../compose/compose.component';
import { SettingsComponent } from '../settings/settings.component';
import { AuthService } from '../../services/auth.service';
import { EmailService } from '../../services/email.service';

@Component({
  selector: 'app-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, SidebarComponent, SearchBarComponent, ComposeComponent, SettingsComponent],
  host: {
    '(window:keydown.escape)': 'onEscapeKey()',
  },
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.css',
})
export class LayoutComponent implements OnInit {
  private readonly auth = inject(AuthService);
  protected readonly emailService = inject(EmailService);
  private readonly router = inject(Router);

  readonly sidebarOpen = signal(true);
  readonly showCompose = signal(false);
  readonly showSettings = signal(false);

  ngOnInit(): void {
    this.emailService.fetchFolders();
    this.checkMobile();
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

  onEscapeKey(): void {
    if (this.showSettings()) {
      this.showSettings.set(false);
    } else if (this.showCompose()) {
      this.showCompose.set(false);
    }
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
