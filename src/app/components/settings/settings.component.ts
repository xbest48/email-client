import { Component, inject, signal, computed, output, ChangeDetectionStrategy, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService, EmailSignature } from '../../services/settings.service';
import { RichEditorComponent } from '../rich-editor/rich-editor.component';
import { AuthService } from '../../services/auth.service';
import * as QRCode from 'qrcode';
import { startRegistration } from '@simplewebauthn/browser';

type SettingsTab = 'accounts' | 'signatures' | 'security' | 'general';

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

  protected readonly authService = inject(AuthService);
  readonly activeTab = signal<SettingsTab>('accounts');

  // Security
  readonly qrCodeUrl = signal<string | null>(null);
  readonly twoFactorCode = signal('');
  readonly twoFactorEnabled = signal(false);

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
  readonly darkMode = computed(() => this.authService.user()?.darkMode ?? false);
  readonly blockTrackingPixels = computed(() => this.authService.user()?.blockTrackingPixels ?? false);
  readonly undoSendDelay = computed(() => this.authService.user()?.undoSendDelay ?? 0);

  readonly signatureEditor = viewChild<RichEditorComponent>('signatureEditor');

  readonly testConnectionLoading = signal(false);

  onAccountEmailChange(): void {
    const email = this.accountEmail();
    const domain = email.split('@')[1];
    if (domain && !this.accountImapHost()) {
      this.accountImapHost.set(`imap.${domain}`);
      this.accountSmtpHost.set(`smtp.${domain}`);
    }
  }

  async testConnection(): Promise<void> {
    if (!this.accountEmail() || !this.accountPassword() || !this.accountImapHost() || !this.accountSmtpHost()) {
        alert('Veuillez remplir tous les champs de connexion.');
        return;
    }

    this.testConnectionLoading.set(true);
    const result = await this.settingsService.testAccountConnection({
      email: this.accountEmail(),
      password: this.accountPassword(),
      imapHost: this.accountImapHost(),
      imapPort: this.accountImapPort(),
      smtpHost: this.accountSmtpHost(),
      smtpPort: this.accountSmtpPort(),
    });
    this.testConnectionLoading.set(false);

    if (result.success) {
      alert('Connexion reussie !');
    } else {
      alert('Echec de la connexion : ' + result.message);
    }
  }

  addAccount(): void {
    if (!this.accountEmail() || !this.accountPassword() || !this.accountImapHost() || !this.accountSmtpHost()) return;
    this.settingsService.addAccount({
      email: this.accountEmail(),
      password: this.accountPassword(),
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

  async setup2FA(): Promise<void> {
    try {
      const { otpauthUrl } = await this.authService.generate2FA();
      const qrUrl = await QRCode.toDataURL(otpauthUrl);
      this.qrCodeUrl.set(qrUrl);
    } catch (e) {
      console.error('Failed to setup 2FA', e);
    }
  }

  async confirm2FA(): Promise<void> {
    if (!this.twoFactorCode()) return;
    const success = await this.authService.turnOn2FA(this.twoFactorCode());
    if (success) {
      this.twoFactorEnabled.set(true);
      this.qrCodeUrl.set(null);
      this.twoFactorCode.set('');
    } else {
      alert('Code invalide');
    }
  }

  async registerPasskey(): Promise<void> {
    try {
      const options = await this.authService.generateWebAuthnRegisterOptions();
      const attResp = await startRegistration({ optionsJSON: options });
      const verified = await this.authService.verifyWebAuthnRegister(attResp);
      if (verified) {
        alert('Passkey enregistre avec succes !');
      } else {
        alert('Echec de l\'enregistrement du passkey');
      }
    } catch (e) {
      console.error('Passkey registration failed', e);
    }
  }

  savePageSize(): void {
    this.settingsService.setPageSize(this.pageSize());
  }

  async updateSetting(key: 'darkMode' | 'undoSendDelay' | 'blockTrackingPixels', value: any): Promise<void> {
    try {
      const current = this.authService.user() || { email: '' };
      await this.authService.updateSettings({
        darkMode: current.darkMode,
        undoSendDelay: current.undoSendDelay,
        blockTrackingPixels: current.blockTrackingPixels,
        [key]: value
      });
    } catch (e) {
      console.error('Failed to save settings', e);
    }
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
