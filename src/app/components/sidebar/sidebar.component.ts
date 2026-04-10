import { Component, inject, input, output, signal, ChangeDetectionStrategy, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { EmailService } from '../../services/email.service';
import { AuthService } from '../../services/auth.service';
import { SettingsService } from '../../services/settings.service';
import { LabelService } from '../../services/label.service';
import { SnoozeService } from '../../services/snooze.service';
import { Email, ImapFolder } from '../../models/email.model';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  folderPath: string;
  specialUse: string;
}

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, FormsModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
})
export class SidebarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly emailService = inject(EmailService);
  protected readonly settingsService = inject(SettingsService);
  protected readonly labelService = inject(LabelService);
  protected readonly snoozeService = inject(SnoozeService);

  readonly isOpen = input(true);
  readonly compose = output<void>();
  readonly signOut = output<void>();

  readonly showLabelsSection = signal(true);
  readonly showAddFolder = signal(false);
  readonly newFolderName = signal('');
  readonly contextMenu = signal<{ x: number; y: number; folder: ImapFolder } | null>(null);
  readonly dragOverFolder = signal<string | null>(null);
  readonly downloadingFolders = signal<Set<string>>(new Set());
  readonly downloadProgress = signal<Map<string, number | null>>(new Map());
  readonly toasts = signal<Array<{ id: string; type: 'info' | 'success' | 'error'; message: string }>>([]);

  readonly defaultNavItems: NavItem[] = [
    { label: 'Boite de reception', icon: '&#128229;', route: '/inbox', folderPath: 'INBOX', specialUse: '\\Inbox' },
    { label: 'Messages envoyes', icon: '&#128228;', route: '/sent', folderPath: '', specialUse: '\\Sent' },
    { label: 'Brouillons', icon: '&#128196;', route: '/drafts', folderPath: '', specialUse: '\\Drafts' },
    { label: 'Spam', icon: '&#9940;', route: '/spam', folderPath: '', specialUse: '\\Junk' },
    { label: 'Corbeille', icon: '&#128465;', route: '/trash', folderPath: '', specialUse: '\\Trash' },
  ];

  readonly navItems = computed(() => {
    const folders = this.emailService.folders();
    return this.defaultNavItems.map((item) => {
      const folder = folders.find(
        (f) => f.specialUse === item.specialUse || f.path === item.folderPath
      );
      return {
        ...item,
        folderPath: folder?.path || item.folderPath,
      };
    });
  });

  readonly customFolders = computed(() => {
    const folders = this.emailService.folders();
    const specialPaths = new Set(this.navItems().map((i) => i.folderPath));
    return folders.filter((f) => !specialPaths.has(f.path) && f.listed);
  });

  getUnreadCount(folderPath: string): number {
    const statuses = this.emailService.folderStatuses();
    return statuses.get(folderPath)?.unseen ?? 0;
  }

  toggleFolders(): void {
    this.settingsService.toggleShowFolders();
  }

  onFolderContextMenu(event: MouseEvent, folder: ImapFolder): void {
    event.preventDefault();
    this.contextMenu.set({
      x: event.clientX,
      y: event.clientY,
      folder,
    });
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  async deleteFolder(folder: ImapFolder): Promise<void> {
    this.contextMenu.set(null);
    if (confirm(`Supprimer le dossier "${folder.name}" ?`)) {
      try {
        await this.emailService.deleteFolder(folder.path);
      } catch (err) {
        console.error('Failed to delete folder', err);
      }
    }
  }

  async downloadFolderArchive(folderPath: string, folderName: string, event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.downloadingFolders().has(folderPath)) return;

    this.downloadingFolders.update((folders) => new Set(folders).add(folderPath));
    this.downloadProgress.update((progress) => {
      const next = new Map(progress);
      next.set(folderPath, null);
      return next;
    });
    const startToastId = this.showToast('info', `Telechargement de "${folderName}" en cours...`);

    try {
      await this.emailService.downloadFolderArchive(folderPath, `${folderName}.mbox`, (progress) => {
        this.downloadProgress.update((current) => {
          const next = new Map(current);
          next.set(folderPath, progress);
          return next;
        });
      });
      this.dismissToast(startToastId);
      this.showToast('success', `Archive de "${folderName}" telechargee.`);
    } catch (err) {
      console.error('Failed to download folder archive', err);
      this.dismissToast(startToastId);
      this.showToast('error', `Echec du telechargement de "${folderName}".`);
    } finally {
      this.downloadingFolders.update((folders) => {
        const next = new Set(folders);
        next.delete(folderPath);
        return next;
      });
      this.downloadProgress.update((progress) => {
        const next = new Map(progress);
        next.delete(folderPath);
        return next;
      });
    }
  }

  dismissToast(id: string): void {
    this.toasts.update((items) => items.filter((item) => item.id !== id));
  }

  private showToast(type: 'info' | 'success' | 'error', message: string): string {
    const id = Math.random().toString(36).slice(2, 10);
    this.toasts.update((items) => [...items, { id, type, message }]);

    setTimeout(() => {
      this.dismissToast(id);
    }, type === 'info' ? 8000 : 5000);

    return id;
  }

  onDragOver(event: DragEvent, folderPath: string): void {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    this.dragOverFolder.set(folderPath);
  }

  onDragLeave(): void {
    this.dragOverFolder.set(null);
  }

  async onDrop(event: DragEvent, folderPath: string): Promise<void> {
    event.preventDefault();
    this.dragOverFolder.set(null);
    const data = event.dataTransfer?.getData('application/json');
    if (!data) return;
    try {
      const emails: { folder: string; uid: number }[] = JSON.parse(data);
      for (const e of emails) {
        await this.emailService.moveToFolder({ folder: e.folder, uid: e.uid } as Email, folderPath);
      }
    } catch (err) {
      console.error('Drop failed', err);
    }
  }

  async addFolder(): Promise<void> {
    const name = this.newFolderName().trim();
    if (!name) return;
    try {
      await this.emailService.createFolder(name);
      this.newFolderName.set('');
      this.showAddFolder.set(false);
    } catch (err) {
      console.error('Failed to create folder', err);
    }
  }
}
