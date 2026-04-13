import { Injectable, signal, computed, effect } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'kyma_theme_mode';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(this.readStoredMode());
  private readonly systemPrefersDark = signal(this.readSystemPrefersDark());

  readonly isDark = computed(() => {
    const current = this.mode();
    if (current === 'system') {
      return this.systemPrefersDark();
    }
    return current === 'dark';
  });

  constructor() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (event: MediaQueryListEvent) => this.systemPrefersDark.set(event.matches);
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', listener);
      } else if (typeof (media as MediaQueryList & { addListener?: (l: unknown) => void }).addListener === 'function') {
        (media as MediaQueryList & { addListener: (l: (e: MediaQueryListEvent) => void) => void }).addListener(listener);
      }
    }

    effect(() => {
      const dark = this.isDark();
      if (typeof document === 'undefined') return;
      if (dark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    });
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore persistence errors
    }
  }

  private readStoredMode(): ThemeMode {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {
      // ignore
    }
    return 'system';
  }

  private readSystemPrefersDark(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
}
