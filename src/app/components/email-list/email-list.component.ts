import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, OnDestroy, viewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { EmailService } from '../../services/email.service';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { Email, ImapFolder } from '../../models/email.model';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { SwipeDirective } from '../../directives/swipe.directive';

const FOLDER_MAP: Record<string, string> = {
  inbox: 'INBOX',
};

const FOLDER_TITLES: Record<string, string> = {
  inbox: 'Boite de reception',
  sent: 'Messages envoyes',
  drafts: 'Brouillons',
  spam: 'Spam',
  trash: 'Corbeille',
};

@Component({
  selector: 'app-email-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RelativeTimePipe, SwipeDirective],
  templateUrl: './email-list.component.html',
  styleUrl: './email-list.component.css',
})
export class EmailListComponent implements OnInit, OnDestroy {
  protected readonly emailService = inject(EmailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly shortcutService = inject(KeyboardShortcutService);

  readonly selectedIds = signal<Set<string>>(new Set());
  readonly focusedIndex = signal(-1);
  private currentFolder = 'INBOX';
  private currentQuery = '';

  readonly emails = computed(() => this.emailService.currentEmails());
  readonly title = signal('Boite de reception');
  readonly isSentFolder = signal(false);
  readonly contextMenu = signal<{ x: number; y: number; email: Email } | null>(null);
  private readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  readonly allSelected = computed(() => {
    const emails = this.emails();
    const selected = this.selectedIds();
    return emails.length > 0 && emails.every((e) => selected.has(this.emailKey(e)));
  });

  private shortcutSub?: Subscription;

  ngOnInit(): void {
    this.route.params.subscribe(async (params) => {
      const label = params['label'] ?? 'inbox';
      const folderParam = params['folder'];

      if (this.emailService.folders().length === 0) {
        await this.emailService.fetchFolders();
      }

      if (folderParam) {
        this.currentFolder = folderParam;
        this.title.set(folderParam);
        this.isSentFolder.set(false);
      } else {
        this.currentFolder = this.resolveFolder(label);
        this.title.set(FOLDER_TITLES[label] ?? label);
        this.isSentFolder.set(label === 'sent');
      }

      this.selectedIds.set(new Set());
      this.focusedIndex.set(-1);
      this.emailService.selectedEmail.set(null);
      await this.emailService.fetchEmails(this.currentFolder, this.currentQuery);
      const saved = this.emailService.savedScrollState();
      if (saved && saved.folder === this.currentFolder) {
        this.emailService.savedScrollState.set(null);
        setTimeout(() => {
          const el = this.scrollContainer()?.nativeElement;
          if (el) el.scrollTop = saved.scrollTop;
        });
      }
    });

    this.route.queryParams.subscribe((qp) => {
      if (qp['q']) {
        this.currentQuery = qp['q'];
        this.title.set('Resultats : ' + qp['q']);
        this.emailService.fetchEmails(this.currentFolder, this.currentQuery);
      }
    });

    this.shortcutSub = this.shortcutService.actions.subscribe((action) => {
      const emails = this.emails();
      const idx = this.focusedIndex();

      switch (action) {
        case 'nextEmail':
          this.focusedIndex.set(Math.min(idx + 1, emails.length - 1));
          break;
        case 'prevEmail':
          this.focusedIndex.set(Math.max(idx - 1, 0));
          break;
        case 'openEmail':
          if (idx >= 0 && idx < emails.length) this.openEmail(emails[idx]);
          break;
        case 'toggleStar':
          if (idx >= 0 && idx < emails.length) this.toggleStar(emails[idx]);
          break;
        case 'trash':
          if (this.selectedIds().size > 0) this.bulkTrash();
          else if (idx >= 0 && idx < emails.length) this.emailService.trashEmail(emails[idx]);
          break;
        case 'toggleReadUnread':
          if (idx >= 0 && idx < emails.length) {
            const email = emails[idx];
            if (email.isRead) this.emailService.markAsUnread(email);
            else this.emailService.markAsRead(email);
          }
          break;
      }
    });
  }

  ngOnDestroy(): void {
    this.shortcutSub?.unsubscribe();
  }

  refresh(): void {
    this.emailService.fetchEmails(this.currentFolder, this.currentQuery);
  }

  openEmail(email: Email): void {
    const scrollEl = this.scrollContainer()?.nativeElement;
    if (scrollEl) {
      this.emailService.savedScrollState.set({ folder: this.currentFolder, scrollTop: scrollEl.scrollTop });
    }
    this.emailService.selectedEmail.set(email);
    this.emailService.markAsRead(email);
    this.router.navigate(['/email', email.folder, email.uid]);
  }

  toggleStar(email: Email): void {
    this.emailService.toggleStar(email);
  }

  toggleSelect(email: Email): void {
    const key = this.emailKey(email);
    this.selectedIds.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  isSelected(email: Email): boolean {
    return this.selectedIds().has(this.emailKey(email));
  }

  toggleSelectAll(): void {
    if (this.allSelected()) {
      this.selectedIds.set(new Set());
    } else {
      this.selectedIds.set(new Set(this.emails().map((e) => this.emailKey(e))));
    }
  }

  loadMore(): void {
    if (this.emailService.hasMoreEmails()) {
      const nextPage = this.emailService.currentPage() + 1;
      this.emailService.fetchEmails(this.currentFolder, this.currentQuery, nextPage);
    }
  }

  hasMore(): boolean {
    return this.emailService.hasMoreEmails();
  }

  bulkTrash(): void {
    const ids = this.selectedIds();
    const emailsToTrash = this.emails().filter((e) => ids.has(this.emailKey(e)));
    this.emailService.bulkTrashInBackground(emailsToTrash);
    this.selectedIds.set(new Set());
  }

  async bulkMarkRead(): Promise<void> {
    const ids = this.selectedIds();
    for (const email of this.emails().filter((e) => ids.has(this.emailKey(e)))) {
      await this.emailService.markAsRead(email);
    }
    this.selectedIds.set(new Set());
  }

  onSwipeLeft(email: Email): void {
    this.emailService.trashEmail(email);
  }

  onSwipeRight(email: Email): void {
    this.emailService.toggleStar(email);
  }

  // Drag & Drop
  onDragStart(event: DragEvent, email: Email): void {
    const selected = this.selectedIds();
    let draggedEmails: { folder: string; uid: number }[];
    if (selected.has(this.emailKey(email))) {
      draggedEmails = this.emails()
        .filter(e => selected.has(this.emailKey(e)))
        .map(e => ({ folder: e.folder, uid: e.uid }));
    } else {
      draggedEmails = [{ folder: email.folder, uid: email.uid }];
    }
    event.dataTransfer!.setData('application/json', JSON.stringify(draggedEmails));
    event.dataTransfer!.effectAllowed = 'move';
  }

  // Context menu
  onContextMenu(event: MouseEvent, email: Email): void {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - 220);
    const y = Math.min(event.clientY, window.innerHeight - 350);
    this.contextMenu.set({ x, y, email });
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  contextReply(email: Email): void {
    this.closeContextMenu();
    this.openEmail(email);
  }

  contextToggleStar(email: Email): void {
    if (this.isSelected(email)) {
      for (const e of this.emails().filter(e => this.selectedIds().has(this.emailKey(e)))) {
        this.emailService.toggleStar(e);
      }
    } else {
      this.emailService.toggleStar(email);
    }
    this.closeContextMenu();
  }

  contextToggleRead(email: Email): void {
    if (this.isSelected(email)) {
      this.bulkMarkRead();
    } else {
      if (email.isRead) this.emailService.markAsUnread(email);
      else this.emailService.markAsRead(email);
    }
    this.closeContextMenu();
  }

  contextMoveToFolder(folderPath: string): void {
    const menu = this.contextMenu();
    if (!menu) return;
    const emailsToMove = this.isSelected(menu.email)
      ? this.emails().filter(e => this.selectedIds().has(this.emailKey(e)))
      : [menu.email];
    for (const email of emailsToMove) {
      this.emailService.moveToFolder(email, folderPath);
    }
    this.selectedIds.set(new Set());
    this.closeContextMenu();
  }

  contextTrash(): void {
    const menu = this.contextMenu();
    if (!menu) return;
    if (this.isSelected(menu.email)) {
      this.bulkTrash();
    } else {
      this.emailService.trashEmail(menu.email);
    }
    this.closeContextMenu();
  }

  emailKey(email: Email): string {
    return `${email.folder}:${email.uid}`;
  }

  private resolveFolder(label: string): string {
    if (FOLDER_MAP[label]) return FOLDER_MAP[label];
    const specialUseMap: Record<string, string> = {
      sent: '\\Sent',
      drafts: '\\Drafts',
      spam: '\\Junk',
      trash: '\\Trash',
    };
    const specialUse = specialUseMap[label];
    if (specialUse) {
      const folder = this.emailService.folders().find((f) => f.specialUse === specialUse);
      if (folder) return folder.path;
    }
    return label;
  }
}
