import { Component, inject, input, output, ChangeDetectionStrategy, computed } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { EmailService } from '../../services/email.service';
import { AuthService } from '../../services/auth.service';

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
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
})
export class SidebarComponent {
  protected readonly auth = inject(AuthService);
  private readonly emailService = inject(EmailService);

  readonly isOpen = input(true);
  readonly compose = output<void>();
  readonly signOut = output<void>();

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
}
