import { Component, inject, input, output, signal, ChangeDetectionStrategy, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { EmailService } from '../../services/email.service';
import { AuthService } from '../../services/auth.service';
import { SettingsService } from '../../services/settings.service';
import { ImapFolder } from '../../models/email.model';

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

  readonly isOpen = input(true);
  readonly compose = output<void>();
  readonly signOut = output<void>();

  readonly showAddFolder = signal(false);
  readonly newFolderName = signal('');
  readonly contextMenu = signal<{ x: number; y: number; folder: ImapFolder } | null>(null);

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
