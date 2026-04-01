import { Component, inject, signal, output, ChangeDetectionStrategy, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService, EmailSignature } from '../../services/settings.service';
import { RichEditorComponent } from '../rich-editor/rich-editor.component';

type SettingsTab = 'accounts' | 'signatures' | 'general';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RichEditorComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
})
export class SettingsComponent {
  protected readonly settingsService = inject(SettingsService);
  readonly close = output<void>();

  readonly activeTab = signal<SettingsTab>('accounts');

  // Account form
  readonly accountEmail = signal('');
  readonly accountPassword = signal('');
  readonly accountImapHost = signal('');
  readonly accountImapPort = signal(993);
  readonly accountSmtpHost = signal('');
  readonly accountSmtpPort = signal(465);

  // Signature form
  readonly signatureName = signal('');
  readonly signatureIsDefault = signal(false);
  readonly editingSignatureId = signal<string | null>(null);

  // General
  readonly pageSize = signal(this.settingsService.pageSize);

  readonly signatureEditor = viewChild<RichEditorComponent>('signatureEditor');

  onAccountEmailChange(): void {
    const email = this.accountEmail();
    const domain = email.split('@')[1];
    if (domain && !this.accountImapHost()) {
      this.accountImapHost.set(`imap.${domain}`);
      this.accountSmtpHost.set(`smtp.${domain}`);
    }
  }

  addAccount(): void {
    if (!this.accountEmail() || !this.accountImapHost() || !this.accountSmtpHost()) return;
    this.settingsService.addAccount({
      email: this.accountEmail(),
      imapHost: this.accountImapHost(),
      imapPort: this.accountImapPort(),
      smtpHost: this.accountSmtpHost(),
      smtpPort: this.accountSmtpPort(),
    });
    this.resetAccountForm();
  }

  removeAccount(id: string): void {
    this.settingsService.removeAccount(id);
  }

  saveSignature(): void {
    const name = this.signatureName();
    const editor = this.signatureEditor();
    if (!name || !editor) return;

    const html = editor.getHtml();
    const editId = this.editingSignatureId();

    if (editId) {
      this.settingsService.updateSignature(editId, {
        name,
        html,
        isDefault: this.signatureIsDefault(),
      });
    } else {
      this.settingsService.addSignature({
        name,
        html,
        isDefault: this.signatureIsDefault(),
      });
    }

    this.resetSignatureForm();
  }

  editSignature(sig: EmailSignature): void {
    this.editingSignatureId.set(sig.id);
    this.signatureName.set(sig.name);
    this.signatureIsDefault.set(sig.isDefault);
    const editor = this.signatureEditor();
    if (editor) {
      editor.setHtml(sig.html);
    }
  }

  removeSignature(id: string): void {
    this.settingsService.removeSignature(id);
    if (this.editingSignatureId() === id) {
      this.resetSignatureForm();
    }
  }

  cancelEditSignature(): void {
    this.editingSignatureId.set(null);
    this.signatureName.set('');
    this.signatureIsDefault.set(false);
    this.signatureEditor()?.clear();
  }

  savePageSize(): void {
    this.settingsService.setPageSize(this.pageSize());
  }

  private resetAccountForm(): void {
    this.accountEmail.set('');
    this.accountPassword.set('');
    this.accountImapHost.set('');
    this.accountImapPort.set(993);
    this.accountSmtpHost.set('');
    this.accountSmtpPort.set(465);
  }

  private resetSignatureForm(): void {
    this.editingSignatureId.set(null);
    this.signatureName.set('');
    this.signatureIsDefault.set(false);
    this.signatureEditor()?.clear();
  }
}
