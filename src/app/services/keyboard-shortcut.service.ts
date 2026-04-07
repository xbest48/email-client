import { Injectable, signal, computed, NgZone, inject, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';

export interface ShortcutDefinition {
  key: string;
  description: string;
  category: string;
}

export type ShortcutAction =
  | 'compose'
  | 'reply'
  | 'toggleStar'
  | 'trash'
  | 'nextEmail'
  | 'prevEmail'
  | 'openEmail'
  | 'goBack'
  | 'focusSearch'
  | 'showHelp'
  | 'closeModal'
  | 'toggleReadUnread';

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService implements OnDestroy {
  private readonly ngZone = inject(NgZone);

  private readonly action$ = new Subject<ShortcutAction>();
  readonly actions = this.action$.asObservable();

  readonly showHelp = signal(false);

  readonly shortcuts = signal<ShortcutDefinition[]>([
    { key: 'c', description: 'Nouveau message', category: 'General' },
    { key: '/', description: 'Rechercher', category: 'General' },
    { key: '?', description: 'Afficher les raccourcis', category: 'General' },
    { key: 'Echap', description: 'Fermer la modale', category: 'General' },
    { key: 'j / Fleche bas', description: 'Email suivant', category: 'Liste' },
    { key: 'k / Fleche haut', description: 'Email precedent', category: 'Liste' },
    { key: 'Entree / o', description: 'Ouvrir l\'email', category: 'Liste' },
    { key: 's', description: 'Suivre / Ne plus suivre', category: 'Email' },
    { key: 'e / #', description: 'Supprimer', category: 'Email' },
    { key: 'r', description: 'Repondre', category: 'Email' },
    { key: 'u', description: 'Retour a la liste', category: 'Email' },
    { key: 'Shift+i', description: 'Lu / Non lu', category: 'Email' },
  ]);

  readonly shortcutsByCategory = computed(() => {
    const all = this.shortcuts();
    const categories = new Map<string, ShortcutDefinition[]>();
    for (const s of all) {
      const list = categories.get(s.category) ?? [];
      list.push(s);
      categories.set(s.category, list);
    }
    return categories;
  });

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();

    // Ignore when typing in inputs, textareas, or contenteditable elements
    if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
      // Still allow Escape from inputs
      if (event.key === 'Escape') {
        this.ngZone.run(() => this.action$.next('closeModal'));
      }
      return;
    }

    // Avoid firing when modifier keys (except Shift) are pressed
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const action = this.resolveAction(event);
    if (action) {
      event.preventDefault();
      this.ngZone.run(() => this.action$.next(action));
    }
  };

  constructor() {
    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.onKeyDown);
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.onKeyDown);
  }

  private resolveAction(event: KeyboardEvent): ShortcutAction | null {
    const key = event.key;

    if (key === 'Escape') return 'closeModal';

    if (event.shiftKey) {
      if (key === '?' || key === '/') return 'showHelp';
      if (key === 'I') return 'toggleReadUnread';
      if (key === '#' || key === '3') return 'trash';
      return null;
    }

    switch (key) {
      case 'c': return 'compose';
      case 'r': return 'reply';
      case 's': return 'toggleStar';
      case 'e': return 'trash';
      case 'j':
      case 'ArrowDown': return 'nextEmail';
      case 'k':
      case 'ArrowUp': return 'prevEmail';
      case 'Enter':
      case 'o': return 'openEmail';
      case 'u': return 'goBack';
      case '/': return 'focusSearch';
      default: return null;
    }
  }
}
