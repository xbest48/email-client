import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EmailService } from '../../services/email.service';
import { RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { Email } from '../../models/email.model';

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
  imports: [RelativeTimePipe],
  templateUrl: './email-list.component.html',
  styleUrl: './email-list.component.css',
})
export class EmailListComponent implements OnInit {
  protected readonly emailService = inject(EmailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly selectedIds = signal<Set<string>>(new Set());
  private currentFolder = 'INBOX';
  private currentQuery = '';

  readonly emails = computed(() => this.emailService.currentEmails());
  readonly title = signal('Boite de reception');

  readonly allSelected = computed(() => {
    const emails = this.emails();
    const selected = this.selectedIds();
    return emails.length > 0 && emails.every((e) => selected.has(this.emailKey(e)));
  });

  ngOnInit(): void {
    this.route.params.subscribe(async (params) => {
      const label = params['label'] ?? 'inbox';
      const folderParam = params['folder'];

      // Ensure folders are loaded so we can resolve special folders accurately
      if (this.emailService.folders().length === 0) {
        await this.emailService.fetchFolders();
      }

      if (folderParam) {
        this.currentFolder = folderParam;
        this.title.set(folderParam);
      } else {
        this.currentFolder = this.resolveFolder(label);
        this.title.set(FOLDER_TITLES[label] ?? label);
      }

      this.selectedIds.set(new Set());
      this.emailService.selectedEmail.set(null);
      this.emailService.fetchEmails(this.currentFolder, this.currentQuery);
    });

    this.route.queryParams.subscribe((qp) => {
      if (qp['q']) {
        this.currentQuery = qp['q'];
        this.title.set('Resultats : ' + qp['q']);
        this.emailService.fetchEmails(this.currentFolder, this.currentQuery);
      }
    });
  }

  refresh(): void {
    this.emailService.fetchEmails(this.currentFolder, this.currentQuery);
  }

  openEmail(email: Email): void {
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
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
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
    for (const email of this.emails().filter((e) => ids.has(this.emailKey(e)))) {
      await this.emailService.trashEmail(email);
    }
    this.selectedIds.set(new Set());
  }

  async bulkMarkRead(): Promise<void> {
    const ids = this.selectedIds();
    for (const email of this.emails().filter((e) => ids.has(this.emailKey(e)))) {
      await this.emailService.markAsRead(email);
    }
    this.selectedIds.set(new Set());
  }

  emailKey(email: Email): string {
    return `${email.folder}:${email.uid}`;
  }

  private resolveFolder(label: string): string {
    if (FOLDER_MAP[label]) return FOLDER_MAP[label];

    // Try to find folder by specialUse
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

    // Fallback: use label as folder path
    return label;
  }
}
