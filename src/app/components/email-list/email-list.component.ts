import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, OnDestroy, viewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { EmailService } from '../../services/email.service';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { Email, ImapFolder } from '../../models/email.model';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { SwipeDirective } from '../../directives/swipe.directive';
import { LabelService, Label } from '../../services/label.service';

const FOLDER_MAP: Record<string, string> = {
  inbox: 'INBOX',
  starred: 'starred',
};

const FOLDER_TITLES: Record<string, string> = {
  inbox: 'Boite de reception',
  starred: 'Suivis',
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
  protected readonly labelService = inject(LabelService);

  readonly selectedIds = signal<Set<string>>(new Set());
  readonly focusedIndex = signal(-1);
  private currentFolder = 'INBOX';
  private currentQuery = '';

  readonly emails = computed(() => this.emailService.currentEmails());
  readonly title = signal('Boite de reception');
  readonly isSentFolder = signal(false);
  readonly isTrashFolder = signal(false);
  readonly contextMenu = signal<{ x: number; y: number; email: Email } | null>(null);
  readonly contextSubmenu = signal<'labels' | null>(null);
  readonly contextEmailLabelIds = signal<Set<string>>(new Set());
  readonly mobileActionMenu = signal<Email | null>(null);
  readonly mobileSelectionMode = signal(false);
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
        this.title.set(this.getFolderTitle(folderParam));
        this.isSentFolder.set(false);
        this.isTrashFolder.set(this.emailService.folders().some((f) => f.path === folderParam && f.specialUse === '\\Trash'));
      } else {
        this.currentFolder = this.resolveFolder(label);
        this.title.set(FOLDER_TITLES[label] ?? label);
        this.isSentFolder.set(label === 'sent');
        this.isTrashFolder.set(label === 'trash');
      }

      this.selectedIds.set(new Set());
      this.mobileSelectionMode.set(false);
      this.mobileActionMenu.set(null);
      this.focusedIndex.set(-1);
      this.emailService.selectedEmail.set(null);
      const savedList = this.emailService.savedListState();
      const canRestoreList = !!savedList
        && savedList.folder === this.currentFolder
        && savedList.query === this.currentQuery
        && this.emailService.currentEmails().length > 0;

      if (canRestoreList) {
        this.emailService.currentPage.set(savedList.page);
        this.emailService.savedListState.set(null);
      } else {
        await this.emailService.fetchEmails(this.currentFolder, this.currentQuery);
      }

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
        void this.emailService.fetchEmails(this.currentFolder, this.currentQuery);
      } else if (this.currentQuery) {
        this.currentQuery = '';
        const routeLabel = this.route.snapshot.params['label'] ?? 'inbox';
        const routeFolder = this.route.snapshot.params['folder'];
        this.title.set(routeFolder ? this.getFolderTitle(routeFolder) : (FOLDER_TITLES[routeLabel] ?? routeLabel));
        void this.emailService.fetchEmails(this.currentFolder, '');
      }
    });

    this.shortcutSub = this.shortcutService.actions.subscribe(async (action) => {
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
          if (this.selectedIds().size > 0) await this.bulkTrash();
          else if (idx >= 0 && idx < emails.length) await this.trashEmailAndRefill(emails[idx]);
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

  async emptyTrash(): Promise<void> {
    await this.emailService.emptyTrash();
    this.selectedIds.set(new Set());
    this.focusedIndex.set(-1);
    await this.emailService.fetchEmails(this.currentFolder, this.currentQuery);
  }

  openEmail(email: Email): void {
    if (this.mobileSelectionMode()) {
      this.toggleSelect(email);
      return;
    }
    const scrollEl = this.scrollContainer()?.nativeElement;
    if (scrollEl) {
      this.emailService.savedScrollState.set({ folder: this.currentFolder, scrollTop: scrollEl.scrollTop });
    }
    this.emailService.savedListState.set({
      folder: this.currentFolder,
      query: this.currentQuery,
      page: this.emailService.currentPage(),
    });
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

  async bulkTrash(): Promise<void> {
    const ids = this.selectedIds();
    const emailsToTrash = this.emails().filter((e) => ids.has(this.emailKey(e)));
    this.emailService.bulkTrashInBackground(emailsToTrash);
    this.selectedIds.set(new Set());
    await this.refillVisibleEmails();
  }

  async bulkSpam(): Promise<void> {
    const ids = this.selectedIds();
    const emailsToSpam = this.emails().filter((e) => ids.has(this.emailKey(e)));
    this.emailService.bulkSpamInBackground(emailsToSpam);
    this.selectedIds.set(new Set());
    await this.refillVisibleEmails();
  }

  async bulkToggleStar(): Promise<void> {
    const ids = this.selectedIds();
    for (const email of this.emails().filter((e) => ids.has(this.emailKey(e)))) {
      await this.emailService.toggleStar(email);
    }
  }

  async bulkMarkRead(): Promise<void> {
    const ids = this.selectedIds();
    for (const email of this.emails().filter((e) => ids.has(this.emailKey(e)))) {
      await this.emailService.markAsRead(email);
    }
    this.selectedIds.set(new Set());
  }

  async onSwipeLeft(email: Email): Promise<void> {
    await this.trashEmailAndRefill(email);
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
    const menuWidth = 220;
    const menuHeight = 420;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight);
    this.contextMenu.set({ x, y: Math.max(8, y), email });
    this.contextSubmenu.set(null);
    const cachedIds = this.labelService.emailLabelMap().get(`${email.folder}:${email.uid}`);
    this.contextEmailLabelIds.set(new Set(cachedIds ?? []));
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
    this.contextSubmenu.set(null);
    this.contextEmailLabelIds.set(new Set());
    this.mobileActionMenu.set(null);
  }

  toggleContextSubmenu(menu: 'labels'): void {
    this.contextSubmenu.update((current) => current === menu ? null : menu);
  }

  openMobileActionMenu(event: MouseEvent, email: Email): void {
    event.preventDefault();
    event.stopPropagation();
    this.mobileActionMenu.set(email);
  }

  enterMobileSelectionMode(email?: Email): void {
    this.mobileSelectionMode.set(true);
    this.mobileActionMenu.set(null);
    if (email) {
      this.selectedIds.set(new Set([this.emailKey(email)]));
    } else if (this.selectedIds().size === 0) {
      this.selectedIds.set(new Set());
    }
  }

  exitMobileSelectionMode(): void {
    this.mobileSelectionMode.set(false);
    this.selectedIds.set(new Set());
    this.mobileActionMenu.set(null);
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

  async contextAssignLabel(labelId: string): Promise<void> {
    const menu = this.contextMenu();
    if (!menu) return;

    const emailsToLabel = this.isSelected(menu.email)
      ? this.emails().filter((e) => this.selectedIds().has(this.emailKey(e)))
      : [menu.email];

    const alreadyAssigned = this.contextEmailLabelIds().has(labelId);

    for (const email of emailsToLabel) {
      if (alreadyAssigned) {
        await this.labelService.removeEmailFromLabel(labelId, email.folder, email.uid);
      } else {
        await this.labelService.addEmailToLabel(labelId, email.folder, email.uid);
      }
    }

    this.contextEmailLabelIds.update((set) => {
      const next = new Set(set);
      if (alreadyAssigned) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  }

  contextSpam(): void {
    const menu = this.contextMenu();
    if (!menu) return;
    if (this.isSelected(menu.email)) {
      void this.bulkSpam();
    } else {
      void this.spamEmailAndRefill(menu.email);
    }
    this.closeContextMenu();
  }

  contextTrash(): void {
    const menu = this.contextMenu();
    if (!menu) return;
    if (this.isSelected(menu.email)) {
      void this.bulkTrash();
    } else {
      void this.trashEmailAndRefill(menu.email);
    }
    this.closeContextMenu();
  }

  mobileMenuToggleStar(): void {
    const email = this.mobileActionMenu();
    if (!email) return;
    this.emailService.toggleStar(email);
    this.mobileActionMenu.set(null);
  }

  mobileMenuSpam(): void {
    const email = this.mobileActionMenu();
    if (!email) return;
    void this.spamEmailAndRefill(email);
    this.mobileActionMenu.set(null);
  }

  private async trashEmailAndRefill(email: Email): Promise<void> {
    await this.emailService.trashEmail(email);
    await this.refillVisibleEmails();
  }

  async spamEmail(email: Email): Promise<void> {
    await this.spamEmailAndRefill(email);
  }

  private async spamEmailAndRefill(email: Email): Promise<void> {
    await this.emailService.spamEmail(email);
    await this.refillVisibleEmails();
  }

  private async refillVisibleEmails(): Promise<void> {
    const targetCount = this.emailService.currentPage() * this.emailService.currentPageSize;
    while (this.emails().length < targetCount && this.emailService.hasMoreEmails()) {
      const nextPage = this.emailService.currentPage() + 1;
      await this.emailService.fetchEmails(this.currentFolder, this.currentQuery, nextPage);
    }
  }

  emailKey(email: Email): string {
    return `${email.folder}:${email.uid}`;
  }

  labelsFor(email: Email): Label[] {
    return this.labelService.getLabelsForCachedEmail(email.folder, email.uid);
  }

  recipientLabel(email: Email): string {
    const first = email.to.length > 0 ? email.to[0] : null;
    return first?.name || first?.email || '(sans destinataire)';
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

  private getFolderTitle(folder: string): string {
    if (folder.startsWith('label:')) {
      const labelId = folder.slice('label:'.length);
      return this.labelService.labels().find((label) => label.id === labelId)?.name ?? 'Libelle';
    }
    return folder;
  }
}
