import { Component, inject, signal, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { SearchBarComponent } from '../search-bar/search-bar.component';
import { ComposeComponent } from '../compose/compose.component';
import { AuthService } from '../../services/auth.service';
import { GmailService } from '../../services/gmail.service';

@Component({
  selector: 'app-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, SidebarComponent, SearchBarComponent, ComposeComponent],
  host: {
    '(window:keydown.escape)': 'onEscapeKey()',
  },
  template: `
    <div class="flex h-screen bg-white overflow-hidden">
      <!-- Mobile sidebar backdrop -->
      @if (sidebarOpen() && isMobile()) {
        <div
          class="fixed inset-0 bg-black/30 z-30 lg:hidden"
          (click)="sidebarOpen.set(false)"
          role="presentation"
          aria-hidden="true"></div>
      }

      <!-- Sidebar -->
      <div
        class="fixed lg:static z-40 h-full w-64 shrink-0 transition-transform duration-200 ease-in-out"
        [class.translate-x-0]="sidebarOpen()"
        [class.-translate-x-full]="!sidebarOpen()"
        [class.lg:translate-x-0]="true">
        <app-sidebar
          [isOpen]="true"
          (compose)="showCompose.set(true)"
          (signOut)="onSignOut()"/>
      </div>

      <!-- Main content -->
      <div class="flex-1 flex flex-col min-w-0">
        <!-- Top bar -->
        <header class="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 bg-white shrink-0">
          <!-- Hamburger menu (mobile) -->
          <button
            (click)="sidebarOpen.set(!sidebarOpen())"
            class="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors
                   lg:hidden focus:outline-none focus:ring-2 focus:ring-amber-400"
            type="button"
            aria-label="Ouvrir le menu">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>

          <!-- Search bar -->
          <app-search-bar (search)="onSearch($event)" class="flex-1"/>
        </header>

        <!-- Content area -->
        <main class="flex-1 overflow-hidden">
          <router-outlet/>
        </main>
      </div>

      <!-- Compose overlay -->
      @if (showCompose()) {
        <app-compose (close)="showCompose.set(false)"/>
      }
    </div>
  `,
})
export class LayoutComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly gmail = inject(GmailService);
  private readonly router = inject(Router);

  readonly sidebarOpen = signal(true);
  readonly showCompose = signal(false);

  ngOnInit(): void {
    this.gmail.fetchLabels();
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
    if (this.showCompose()) {
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
