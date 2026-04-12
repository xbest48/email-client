import { Component, ChangeDetectionStrategy, inject, effect, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';
import { ConfirmDialogComponent } from './components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ConfirmDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  private readonly authService = inject(AuthService);

  constructor() {
    effect(() => {
      const user = this.authService.user();
      if (user?.darkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    });
  }

  @HostListener('document:contextmenu', ['$event'])
  onDocumentContextMenu(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      event.preventDefault();
      return;
    }

    const allowNativeMenu = target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-allow-native-context-menu]'
    );

    if (!allowNativeMenu) {
      event.preventDefault();
    }
  }
}
