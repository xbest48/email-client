import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, OnDestroy, viewChild, ElementRef, effect } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { EmailService } from '../../services/email.service';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { Email, ImapFolder } from '../../models/email.model';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { SwipeDirective } from '../../directives/swipe.directive';
import { LabelService, Label } from '../../services/label.service';
import { SettingsService } from '../../services/settings.service';
import { AuthService } from '../../services/auth.service';
import { AiService, EmailTriageResult } from '../../services/ai.service';
import { TaskService } from '../../services/task.service';

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
  protected readonly settingsService = inject(SettingsService);
  protected readonly authService = inject(AuthService);
  private readonly aiService = inject(AiService);
  protected readonly taskService = inject(TaskService);

  readonly selectedIds = signal<Set<string>>(new Set());
  readonly focusedIndex = signal(-1);
  private currentFolder = 'INBOX';
  private currentQuery = '';
  private readonly triageInFlight = new Set<string>();
  readonly triagePendingCount = signal(0);

  readonly emails = computed(() => this.emailService.currentEmails());
  readonly title = signal('Boite de reception');
  readonly activeAiTagFilter = signal<string | null>(null);
  readonly activeAiTagLabel = signal<string | null>(null);
  readonly aiTagFilterTargetCount = signal<number | null>(null);
  readonly isSentFolder = signal(false);
  readonly isTrashFolder = signal(false);
  readonly isSpamFolder = signal(false);
  readonly contextMenu = signal<{ x: number; y: number; email: Email } | null>(null);
  readonly contextSubmenu = signal<'labels' | null>(null);
  readonly contextEmailLabelIds = signal<Set<string>>(new Set());
  readonly mobileActionMenu = signal<Email | null>(null);
  readonly mobileSelectionMode = signal(false);
  readonly dismissAiHint = signal(false);
  readonly aiEnabled = computed(() =>
    !!this.authService.user()?.hasAiApiKey && !!this.authService.user()?.isAiEnabled
  );
  readonly aiSettingsHint = computed(() => {
    const user = this.authService.user();
    if (!user) return null;
    if (user.hideAiHints || this.dismissAiHint()) return null;
    if (user.hasAiApiKey && !user.isAiEnabled) {
      return "Le tri intelligent est desactive. Activez l'IA dans Reglages > Intelligence Artificielle.";
    }
    if (!user.hasAiApiKey) {
      return "Configurez une cle API dans Reglages > Intelligence Artificielle pour activer le tri intelligent.";
    }
    return null;
  });
  readonly aiInsights = signal<Map<string, EmailTriageResult>>(new Map());
  readonly showTaskPanel = signal(false);
  private readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');
  private readonly contextMenuEl = viewChild<ElementRef<HTMLDivElement>>('contextMenuEl');

  readonly allSelected = computed(() => {
    const emails = this.visibleEmails();
    const selected = this.selectedIds();
    return emails.length > 0 && emails.every((e) => selected.has(this.emailKey(e)));
  });

  readonly visibleEmails = computed(() => {
    const activeTag = this.activeAiTagFilter();
    const emails = this.emails();
    if (!activeTag) return emails;

    const [kind, value] = activeTag.split(':', 2);
    return emails.filter((email) => {
      const insight = this.triageFor(email);
      if (!insight) return false;

      switch (kind) {
        case 'category':
          return this.normalizeCategory(insight.category) === value;
        case 'urgency':
          return insight.urgency === value;
        case 'phishing':
          return insight.phishingLevel === value;
        default:
          return false;
      }
    });
  });

  readonly useStrongerDarkUnreadAccent = computed(() =>
    this.getRelativeLuminance(this.settingsService.accentColor) < 0.12
  );
  readonly isAiFilterLoadingMore = computed(() => {
    const activeTag = this.activeAiTagFilter();
    const targetCount = this.aiTagFilterTargetCount();
    if (!activeTag || !targetCount) return false;
    return this.emailService.loading() && this.visibleEmails().length < targetCount;
  });
  readonly showLoadMoreControl = computed(() =>
    this.emailService.hasMoreEmails() || this.isAiFilterLoadingMore()
  );

  private shortcutSub?: Subscription;

  constructor() {
    effect(() => {
      this.authService.user();
      this.dismissAiHint.set(false);
    });

    effect(() => {
      if (!this.aiEnabled()) {
        this.aiInsights.set(new Map());
        this.triageInFlight.clear();
        this.triagePendingCount.set(0);
        this.showTaskPanel.set(false);
        return;
      }

      if (this.isSentFolder() || this.isTrashFolder()) {
        return;
      }

      const emails = this.emails();
      if (!emails.length) return;

      const insights = this.aiInsights();
      const pendingEmails = emails
        .filter((email) => !insights.has(this.emailKey(email)) && !this.triageInFlight.has(this.emailKey(email)))
        .slice(0, 12);

      if (!pendingEmails.length) return;

      for (const email of pendingEmails) {
        this.triageInFlight.add(this.emailKey(email));
      }
      this.triagePendingCount.set(this.triageInFlight.size);

      void this.loadAiInsights(pendingEmails);
    });

    effect(() => {
      const activeTag = this.activeAiTagFilter();
      const targetCount = this.aiTagFilterTargetCount();
      const visibleCount = this.visibleEmails().length;
      const pendingTriage = this.triagePendingCount();
      const insights = this.aiInsights();
      const hasUnclassifiedLoadedEmails = this.emails().some(
        (email) => !insights.has(this.emailKey(email)) && !this.triageInFlight.has(this.emailKey(email))
      );
      const hasMoreEmails = this.emailService.hasMoreEmails();
      const loading = this.emailService.loading();

      if (!activeTag || !targetCount || visibleCount >= targetCount) return;
      if (pendingTriage > 0 || hasUnclassifiedLoadedEmails || loading || !hasMoreEmails) return;

      const nextPage = this.emailService.currentPage() + 1;
      void this.emailService.fetchEmails(this.currentFolder, this.currentQuery, nextPage);
    });
  }

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
        this.isSpamFolder.set(this.isJunkFolderPath(folderParam));
      } else {
        this.currentFolder = this.resolveFolder(label);
        this.title.set(FOLDER_TITLES[label] ?? label);
        this.isSentFolder.set(label === 'sent');
        this.isTrashFolder.set(label === 'trash');
        this.isSpamFolder.set(label === 'spam');
      }

      this.selectedIds.set(new Set());
      this.activeAiTagFilter.set(null);
      this.activeAiTagLabel.set(null);
      this.aiTagFilterTargetCount.set(null);
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
        // savedListState is a one-shot hint posted by openEmail(). If we can't
        // use it now (folder changed, query changed, cache empty), it's stale
        // and must be dropped — otherwise, navigating later back to its folder
        // would short-circuit the fetch and display whichever emails are
        // currently cached (e.g. from the folder we visited in between).
        if (savedList) {
          this.emailService.savedListState.set(null);
        }
        await this.emailService.fetchEmails(this.currentFolder, this.currentQuery);
      }

      const saved = this.emailService.savedScrollState();
      if (saved && saved.folder === this.currentFolder) {
        this.emailService.savedScrollState.set(null);
        setTimeout(() => {
          const el = this.scrollContainer()?.nativeElement;
          if (el) el.scrollTop = saved.scrollTop;
        });
      } else if (saved) {
        // Same story as savedListState: drop stale scroll hints so they don't
        // leak into a later visit to the original folder.
        this.emailService.savedScrollState.set(null);
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
    this.clearLabelsSubmenuTimers();
  }

  refresh(): void {
    this.aiInsights.set(new Map());
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
      this.selectedIds.set(new Set(this.visibleEmails().map((e) => this.emailKey(e))));
    }
  }

  loadMore(): void {
    if (this.activeAiTagFilter()) {
      this.aiTagFilterTargetCount.update((current) =>
        (current ?? this.visibleEmails().length) + this.emailService.currentPageSize
      );
      return;
    }

    if (this.emailService.hasMoreEmails()) {
      const nextPage = this.emailService.currentPage() + 1;
      void this.emailService.fetchEmails(this.currentFolder, this.currentQuery, nextPage);
    }
  }

  hasMore(): boolean {
    return this.emailService.hasMoreEmails();
  }

  async bulkTrash(): Promise<void> {
    const ids = this.selectedIds();
    const emailsToTrash = this.visibleEmails().filter((e) => ids.has(this.emailKey(e)));
    this.emailService.bulkTrashInBackground(emailsToTrash);
    this.selectedIds.set(new Set());
    await this.refillVisibleEmails();
  }

  async bulkSpam(): Promise<void> {
    const ids = this.selectedIds();
    const emailsToSpam = this.visibleEmails().filter((e) => ids.has(this.emailKey(e)));
    this.emailService.bulkSpamInBackground(emailsToSpam);
    this.selectedIds.set(new Set());
    await this.refillVisibleEmails();
  }

  async bulkNotSpam(): Promise<void> {
    const ids = this.selectedIds();
    const emailsToRestore = this.visibleEmails().filter((e) => ids.has(this.emailKey(e)));
    this.emailService.bulkNotSpamInBackground(emailsToRestore);
    this.selectedIds.set(new Set());
    await this.refillVisibleEmails();
  }

  async bulkToggleStar(): Promise<void> {
    const ids = this.selectedIds();
    for (const email of this.visibleEmails().filter((e) => ids.has(this.emailKey(e)))) {
      await this.emailService.toggleStar(email);
    }
  }

  async bulkMarkRead(): Promise<void> {
    const ids = this.selectedIds();
    for (const email of this.visibleEmails().filter((e) => ids.has(this.emailKey(e)))) {
      await this.emailService.markAsRead(email);
    }
    this.selectedIds.set(new Set());
  }

  private getRelativeLuminance(hex: string): number {
    const normalized = hex.replace('#', '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return 1;

    const [r, g, b] = [
      parseInt(normalized.slice(0, 2), 16),
      parseInt(normalized.slice(2, 4), 16),
      parseInt(normalized.slice(4, 6), 16),
    ].map((channel) => {
      const srgb = channel / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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
    // Rough initial placement to avoid a visible flash outside the viewport.
    // A precise adjustment is performed once the menu is rendered and can
    // be measured (see adjustContextMenuPosition).
    const estWidth = 288;
    const estHeight = 520;
    const margin = 8;
    const initialX = Math.max(margin, Math.min(event.clientX, window.innerWidth - estWidth - margin));
    const initialY = Math.max(margin, Math.min(event.clientY, window.innerHeight - estHeight - margin));
    this.contextMenu.set({ x: initialX, y: initialY, email });
    this.contextSubmenu.set(null);
    const cachedIds = this.labelService.emailLabelMap().get(`${email.folder}:${email.uid}`);
    this.contextEmailLabelIds.set(new Set(cachedIds ?? []));
    const clickX = event.clientX;
    const clickY = event.clientY;
    // Wait for Angular to render the menu so we can measure its actual size.
    requestAnimationFrame(() => this.adjustContextMenuPosition(clickX, clickY));
  }

  private adjustContextMenuPosition(clickX: number, clickY: number): void {
    const el = this.contextMenuEl()?.nativeElement;
    const menu = this.contextMenu();
    if (!el || !menu) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const x = Math.max(margin, Math.min(clickX, maxX));
    const y = Math.max(margin, Math.min(clickY, maxY));
    if (x !== menu.x || y !== menu.y) {
      this.contextMenu.set({ ...menu, x, y });
    }
  }

  closeContextMenu(): void {
    this.clearLabelsSubmenuTimers();
    this.contextMenu.set(null);
    this.contextSubmenu.set(null);
    this.contextEmailLabelIds.set(new Set());
    this.mobileActionMenu.set(null);
  }

  toggleContextSubmenu(menu: 'labels'): void {
    this.contextSubmenu.update((current) => current === menu ? null : menu);
  }

  private labelsSubmenuOpenTimer: ReturnType<typeof setTimeout> | null = null;
  private labelsSubmenuCloseTimer: ReturnType<typeof setTimeout> | null = null;

  onLabelsHoverEnter(): void {
    if (this.labelsSubmenuCloseTimer !== null) {
      clearTimeout(this.labelsSubmenuCloseTimer);
      this.labelsSubmenuCloseTimer = null;
    }
    if (this.contextSubmenu() === 'labels') return;
    if (this.labelsSubmenuOpenTimer !== null) clearTimeout(this.labelsSubmenuOpenTimer);
    this.labelsSubmenuOpenTimer = setTimeout(() => {
      this.contextSubmenu.set('labels');
      this.labelsSubmenuOpenTimer = null;
    }, 1000);
  }

  onLabelsHoverLeave(): void {
    if (this.labelsSubmenuOpenTimer !== null) {
      clearTimeout(this.labelsSubmenuOpenTimer);
      this.labelsSubmenuOpenTimer = null;
    }
    if (this.contextSubmenu() !== 'labels') return;
    if (this.labelsSubmenuCloseTimer !== null) clearTimeout(this.labelsSubmenuCloseTimer);
    this.labelsSubmenuCloseTimer = setTimeout(() => {
      this.contextSubmenu.set(null);
      this.labelsSubmenuCloseTimer = null;
    }, 200);
  }

  private clearLabelsSubmenuTimers(): void {
    if (this.labelsSubmenuOpenTimer !== null) {
      clearTimeout(this.labelsSubmenuOpenTimer);
      this.labelsSubmenuOpenTimer = null;
    }
    if (this.labelsSubmenuCloseTimer !== null) {
      clearTimeout(this.labelsSubmenuCloseTimer);
      this.labelsSubmenuCloseTimer = null;
    }
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

  contextNotSpam(): void {
    const menu = this.contextMenu();
    if (!menu) return;
    if (this.isSelected(menu.email)) {
      void this.bulkNotSpam();
    } else {
      void this.notSpamEmailAndRefill(menu.email);
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

  mobileMenuNotSpam(): void {
    const email = this.mobileActionMenu();
    if (!email) return;
    void this.notSpamEmailAndRefill(email);
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

  async notSpamEmail(email: Email): Promise<void> {
    await this.notSpamEmailAndRefill(email);
  }

  private async notSpamEmailAndRefill(email: Email): Promise<void> {
    await this.emailService.markAsNotSpam(email);
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

  triageFor(email: Email): EmailTriageResult | null {
    return this.aiInsights().get(this.emailKey(email)) ?? null;
  }

  toggleCategoryFilter(category: string): void {
    this.toggleAiTagFilter(`category:${this.normalizeCategory(category)}`, category);
  }

  toggleUrgencyFilter(level: 'low' | 'medium' | 'high', label: string): void {
    this.toggleAiTagFilter(`urgency:${level}`, label);
  }

  togglePhishingFilter(level: 'low' | 'medium' | 'high', label: string): void {
    if (level === 'low') return;
    this.toggleAiTagFilter(`phishing:${level}`, label);
  }

  private toggleAiTagFilter(key: string, label: string): void {
    const nextKey = this.activeAiTagFilter() === key ? null : key;
    this.activeAiTagFilter.set(nextKey);
    this.activeAiTagLabel.set(nextKey ? label : null);
    this.aiTagFilterTargetCount.set(
      nextKey ? Math.max(this.emails().length, this.emailService.currentPageSize) : null
    );
    this.selectedIds.set(new Set());
    this.mobileSelectionMode.set(false);
  }

  clearAiTagFilter(): void {
    this.activeAiTagFilter.set(null);
    this.activeAiTagLabel.set(null);
    this.aiTagFilterTargetCount.set(null);
  }

  isCategoryFilterActive(category: string): boolean {
    return this.activeAiTagFilter() === `category:${this.normalizeCategory(category)}`;
  }

  isUrgencyFilterActive(level: 'low' | 'medium' | 'high'): boolean {
    return this.activeAiTagFilter() === `urgency:${level}`;
  }

  isPhishingFilterActive(level: 'medium' | 'high'): boolean {
    return this.activeAiTagFilter() === `phishing:${level}`;
  }

  formatTaskDate(value: string | null): string {
    if (!value) return 'Sans date';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString('fr-FR', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
  }

  toggleTaskPanel(): void {
    if (!this.aiEnabled()) {
      this.showTaskPanel.set(false);
      return;
    }
    this.showTaskPanel.update((value) => !value);
  }

  toggleTaskCompleted(taskId: string): void {
    this.taskService.toggleCompleted(taskId);
  }

  removeTask(taskId: string): void {
    this.taskService.removeTask(taskId);
  }

  recipientLabel(email: Email): string {
    const first = email.to.length > 0 ? email.to[0] : null;
    return first?.name || first?.email || '(sans destinataire)';
  }

  private isJunkFolderPath(path: string): boolean {
    const normalizedPath = path.trim().toLowerCase();
    return this.emailService.folders().some(
      (folder) => folder.path === path && folder.specialUse === '\\Junk'
    ) || normalizedPath === 'spam' || normalizedPath === 'junk';
  }

  private async loadAiInsights(emails: Email[]): Promise<void> {
    try {
      const results = await this.aiService.triage(
        emails.map((email) => ({
          id: this.emailKey(email),
          from: email.from.email || email.from.name,
          subject: email.subject,
          snippet: email.snippet,
          messageId: email.messageId,
          folder: email.folder,
          uid: email.uid,
        })),
      );

      this.aiInsights.update((existing) => {
        const next = new Map(existing);
        for (const result of results) {
          next.set(result.id, result);
        }
        return next;
      });
    } catch (err) {
      console.error('Failed to load AI triage insights', err);
    } finally {
      for (const email of emails) {
        this.triageInFlight.delete(this.emailKey(email));
      }
      this.triagePendingCount.set(this.triageInFlight.size);
    }
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

  private normalizeCategory(category: string): string {
    return category.trim().toLowerCase();
  }
}
