import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';
import { ConfirmDialogComponent } from './components/confirm-dialog/confirm-dialog.component';
import { ToastStackComponent } from './components/toast-stack/toast-stack.component';
import { InboxWatcherService } from './services/inbox-watcher.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ConfirmDialogComponent, ToastStackComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    '(document:contextmenu)': 'onDocumentContextMenu($event)',
  },
})
export class AppComponent {
  // ThemeService manages the light/dark/system theme via an internal effect,
  // so injecting it here is enough to ensure it is instantiated at bootstrap.
  private readonly themeService = inject(ThemeService);
  // Same pattern: instantiating InboxWatcherService wires up the effect that
  // starts/stops the new-email poll based on auth state + notification opt-in.
  private readonly inboxWatcher = inject(InboxWatcherService);

  onDocumentContextMenu(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      event.preventDefault();
      return;
    }

    const allowNativeMenu = target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-allow-native-context-menu]',
    );

    if (!allowNativeMenu) {
      event.preventDefault();
    }
  }
}
