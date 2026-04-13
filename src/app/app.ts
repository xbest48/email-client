import { Component, ChangeDetectionStrategy, inject, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './services/theme.service';
import { ConfirmDialogComponent } from './components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ConfirmDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  // ThemeService manages the light/dark/system theme via an internal effect,
  // so injecting it here is enough to ensure it is instantiated at bootstrap.
  private readonly themeService = inject(ThemeService);

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
