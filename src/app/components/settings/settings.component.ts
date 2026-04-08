import { Component, inject, signal, computed, output, ChangeDetectionStrategy, viewChild, ElementRef, afterNextRender } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService, EmailSignature, EmailTemplate } from '../../services/settings.service';
import { RichEditorComponent } from '../rich-editor/rich-editor.component';
import { AuthService } from '../../services/auth.service';
import { LabelService, Label } from '../../services/label.service';
import { FilterService, FilterRule } from '../../services/filter.service';
import { PgpService } from '../../services/pgp.service';
import * as QRCode from 'qrcode';
import { startRegistration } from '@simplewebauthn/browser';

type SettingsTab = 'accounts' | 'signatures' | 'security' | 'general' | 'labels' | 'filters' | 'templates' | 'privacy';

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
  protected readonly labelService = inject(LabelService);
  protected readonly filterService = inject(FilterService);
  protected readonly pgpService = inject(PgpService);
  readonly activeTab = signal<SettingsTab>('general');

  // Security
  readonly qrCodeUrl = signal<string | null>(null);
  readonly twoFactorCode = signal('');
  readonly twoFactorEnabled = signal(false);

  // Account form
  readonly accountEmail = signal('');
  readonly accountPassword = signal('');
  readonly accountDisplayName = signal('');
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
  readonly accentPresetColors = ['#403d84', '#ffd200', '#b6d0f2', '#ffcbba', '#c6ebc5', '#ffbacd', '#a4cfff', '#ffb347', '#d5a6bd', '#92a9d1'];
  readonly selectedAccentColor = signal(this.settingsService.accentColor);
  readonly customAccentColor = signal(this.settingsService.accentColor);
  readonly darkMode = computed(() => this.authService.user()?.darkMode ?? false);
  readonly blockTrackingPixels = computed(() => this.authService.user()?.blockTrackingPixels ?? false);
  readonly undoSendDelay = computed(() => this.authService.user()?.undoSendDelay ?? 0);

  readonly signatureEditor = viewChild<RichEditorComponent>('signatureEditor');
  readonly signatureSourceMode = signal(false);
  readonly signatureHtmlSource = signal('');

  readonly testConnectionLoading = signal(false);

  // Labels
  readonly labelName = signal('');
  readonly labelColor = signal('#3b82f6');
  readonly editingLabelId = signal<string | null>(null);

  // Filters
  readonly filterName = signal('');
  readonly filterConditionField = signal<FilterRule['conditionField']>('from');
  readonly filterConditionOperator = signal<FilterRule['conditionOperator']>('contains');
  readonly filterConditionValue = signal('');
  readonly filterActionType = signal<FilterRule['actionType']>('move');
  readonly filterActionValue = signal('');
  readonly editingFilterId = signal<string | null>(null);

  // Templates
  readonly templateName = signal('');
  readonly templateSubject = signal('');
  readonly editingTemplateId = signal<string | null>(null);
  readonly templateEditorRef = viewChild<RichEditorComponent>('templateEditor');
  readonly tabsContainer = viewChild<ElementRef<HTMLDivElement>>('tabsContainer');
  readonly tabsCanScrollLeft = signal(false);
  readonly tabsCanScrollRight = signal(false);

  // PGP
  readonly pgpName = signal('');
  readonly pgpEmail = signal('');
  readonly pgpPassphrase = signal('');
  readonly pgpContactEmail = signal('');
  readonly pgpContactKey = signal('');
  readonly generatingKey = signal(false);

  // Privacy
  readonly imagePolicy = computed(() => this.authService.user()?.imagePolicy ?? 'ask');
  readonly imageAllowedDomains = computed(() => this.authService.user()?.imageAllowedDomains ?? []);
  readonly imageBlockedDomains = computed(() => this.authService.user()?.imageBlockedDomains ?? []);
  readonly newAllowedDomain = signal('');
  readonly newBlockedDomain = signal('');

  constructor() {
    afterNextRender(() => {
      this.updateTabsScrollState();
    });
  }

  onTabsWheel(event: WheelEvent): void {
    const containerRef = this.tabsContainer();
    if (!containerRef) return;

    const container = containerRef.nativeElement;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    if (maxScrollLeft <= 0) return;

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    if (delta === 0) return;

    const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, container.scrollLeft + delta));
    if (nextScrollLeft !== container.scrollLeft) {
      container.scrollLeft = nextScrollLeft;
      event.preventDefault();
      this.updateTabsScrollState();
    }
  }

  updateTabsScrollState(): void {
    const containerRef = this.tabsContainer();
    if (!containerRef) return;

    const container = containerRef.nativeElement;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    if (maxScrollLeft <= 0) {
      this.tabsCanScrollLeft.set(false);
      this.tabsCanScrollRight.set(false);
      return;
    }

    const epsilon = 1;
    this.tabsCanScrollLeft.set(container.scrollLeft > epsilon);
    this.tabsCanScrollRight.set(container.scrollLeft < maxScrollLeft - epsilon);
  }

  scrollTabs(direction: 'left' | 'right'): void {
    const containerRef = this.tabsContainer();
    if (!containerRef) return;

    const container = containerRef.nativeElement;
    const amount = direction === 'left' ? -220 : 220;
    container.scrollBy({ left: amount, behavior: 'smooth' });
    requestAnimationFrame(() => this.updateTabsScrollState());
  }

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
      displayName: this.accountDisplayName(),
      imapHost: this.accountImapHost(),
      imapPort: this.accountImapPort(),
      smtpHost: this.accountSmtpHost(),
      smtpPort: this.accountSmtpPort(),
    });
    this.resetAccountForm();
  }

  async updateAccountDisplayName(accountId: string, displayName: string): Promise<void> {
    await this.settingsService.updateAccount(accountId, { displayName });
  }

  removeAccount(id: string): void {
    this.settingsService.removeAccount(id);
  }

  toggleSignatureSourceMode(): void {
    const sourceMode = this.signatureSourceMode();
    const editor = this.signatureEditor();
    if (sourceMode) {
      // Switching from source to visual: apply HTML source to editor
      if (editor) {
        editor.setHtml(this.signatureHtmlSource());
      }
    } else {
      // Switching from visual to source: copy editor content to textarea
      if (editor) {
        this.signatureHtmlSource.set(editor.getHtml());
      }
    }
    this.signatureSourceMode.set(!sourceMode);
  }

  saveSignature(): void {
    const name = this.signatureName();
    if (!name) return;

    let html: string;
    if (this.signatureSourceMode()) {
      html = this.signatureHtmlSource();
    } else {
      const editor = this.signatureEditor();
      if (!editor) return;
      html = editor.getHtml();
    }

    if (!html) return;
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
    this.signatureHtmlSource.set(sig.html);
    if (this.signatureSourceMode()) {
      // Already in source mode, just update the textarea
    } else {
      const editor = this.signatureEditor();
      if (editor) {
        editor.setHtml(sig.html);
      }
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

  selectAccentColor(color: string): void {
    this.selectedAccentColor.set(color);
    this.customAccentColor.set(color);
    this.settingsService.setAccentColor(color);
  }

  applyCustomAccentColor(): void {
    this.selectedAccentColor.set(this.customAccentColor());
    this.settingsService.setAccentColor(this.customAccentColor());
  }

  async updateSetting(key: string, value: unknown): Promise<void> {
    try {
      const current = this.authService.user() || { email: '' };
      await this.authService.updateSettings({
        darkMode: current.darkMode,
        undoSendDelay: current.undoSendDelay,
        blockTrackingPixels: current.blockTrackingPixels,
        imagePolicy: current.imagePolicy,
        imageAllowedDomains: current.imageAllowedDomains,
        imageBlockedDomains: current.imageBlockedDomains,
        [key]: value
      });
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  }

  // Labels
  async saveLabel(): Promise<void> {
    const name = this.labelName();
    const color = this.labelColor();
    if (!name) return;
    const editId = this.editingLabelId();
    if (editId) {
      await this.labelService.update(editId, { name, color });
    } else {
      await this.labelService.create(name, color);
    }
    this.resetLabelForm();
  }

  editLabel(label: Label): void {
    this.editingLabelId.set(label.id);
    this.labelName.set(label.name);
    this.labelColor.set(label.color);
  }

  async deleteLabel(id: string): Promise<void> {
    await this.labelService.remove(id);
    if (this.editingLabelId() === id) this.resetLabelForm();
  }

  private resetLabelForm(): void {
    this.editingLabelId.set(null);
    this.labelName.set('');
    this.labelColor.set('#3b82f6');
  }

  // Filters
  async saveFilter(): Promise<void> {
    const name = this.filterName();
    if (!name || !this.filterConditionValue()) return;
    const data = {
      name,
      conditionField: this.filterConditionField(),
      conditionOperator: this.filterConditionOperator(),
      conditionValue: this.filterConditionValue(),
      actionType: this.filterActionType(),
      actionValue: this.filterActionValue(),
      isEnabled: true,
    };
    const editId = this.editingFilterId();
    if (editId) {
      await this.filterService.update(editId, data);
    } else {
      await this.filterService.create(data as Omit<FilterRule, 'id'>);
    }
    this.resetFilterForm();
  }

  editFilter(filter: FilterRule): void {
    this.editingFilterId.set(filter.id);
    this.filterName.set(filter.name);
    this.filterConditionField.set(filter.conditionField);
    this.filterConditionOperator.set(filter.conditionOperator);
    this.filterConditionValue.set(filter.conditionValue);
    this.filterActionType.set(filter.actionType);
    this.filterActionValue.set(filter.actionValue);
  }

  async deleteFilter(id: string): Promise<void> {
    await this.filterService.remove(id);
    if (this.editingFilterId() === id) this.resetFilterForm();
  }

  async applyFilter(id: string): Promise<void> {
    const result = await this.filterService.apply(id, 'INBOX');
    alert(`Filtre applique a ${result.applied} message(s).`);
  }

  private resetFilterForm(): void {
    this.editingFilterId.set(null);
    this.filterName.set('');
    this.filterConditionField.set('from');
    this.filterConditionOperator.set('contains');
    this.filterConditionValue.set('');
    this.filterActionType.set('move');
    this.filterActionValue.set('');
  }

  // Templates
  saveTemplate(): void {
    const name = this.templateName();
    const editor = this.templateEditorRef();
    if (!name || !editor) return;
    const htmlBody = editor.getHtml();
    const editId = this.editingTemplateId();
    if (editId) {
      this.settingsService.updateTemplate(editId, { name, subject: this.templateSubject(), htmlBody });
    } else {
      this.settingsService.addTemplate({ name, subject: this.templateSubject(), htmlBody });
    }
    this.resetTemplateForm();
  }

  editTemplate(tpl: EmailTemplate): void {
    this.editingTemplateId.set(tpl.id);
    this.templateName.set(tpl.name);
    this.templateSubject.set(tpl.subject);
    const editor = this.templateEditorRef();
    if (editor) editor.setHtml(tpl.htmlBody);
  }

  deleteTemplate(id: string): void {
    this.settingsService.removeTemplate(id);
    if (this.editingTemplateId() === id) this.resetTemplateForm();
  }

  private resetTemplateForm(): void {
    this.editingTemplateId.set(null);
    this.templateName.set('');
    this.templateSubject.set('');
    this.templateEditorRef()?.clear();
  }

  // PGP
  async generatePgpKey(): Promise<void> {
    const name = this.pgpName();
    const email = this.pgpEmail();
    const passphrase = this.pgpPassphrase();
    if (!name || !email || !passphrase) return;
    this.generatingKey.set(true);
    try {
      await this.pgpService.generateKeyPair(name, email, passphrase);
      this.pgpName.set('');
      this.pgpEmail.set('');
      this.pgpPassphrase.set('');
    } catch (e) {
      console.error('PGP key generation failed', e);
    } finally {
      this.generatingKey.set(false);
    }
  }

  async importPgpContact(): Promise<void> {
    const email = this.pgpContactEmail();
    const key = this.pgpContactKey();
    if (!email || !key) return;
    await this.pgpService.importPublicKey(email, key);
    this.pgpContactEmail.set('');
    this.pgpContactKey.set('');
  }

  async removePgpContact(email: string): Promise<void> {
    await this.pgpService.removeContactKey(email);
  }

  // Privacy
  async updateImagePolicy(policy: string): Promise<void> {
    await this.updateSetting('imagePolicy' as any, policy);
  }

  async addAllowedDomain(): Promise<void> {
    const domain = this.newAllowedDomain().trim().toLowerCase();
    if (!domain) return;
    const current = this.imageAllowedDomains();
    if (current.includes(domain)) { this.newAllowedDomain.set(''); return; }
    await this.updateSetting('imageAllowedDomains' as any, [...current, domain]);
    this.newAllowedDomain.set('');
  }

  async removeAllowedDomain(domain: string): Promise<void> {
    const current = this.imageAllowedDomains();
    await this.updateSetting('imageAllowedDomains' as any, current.filter(d => d !== domain));
  }

  async addBlockedDomain(): Promise<void> {
    const domain = this.newBlockedDomain().trim().toLowerCase();
    if (!domain) return;
    const current = this.imageBlockedDomains();
    if (current.includes(domain)) { this.newBlockedDomain.set(''); return; }
    await this.updateSetting('imageBlockedDomains' as any, [...current, domain]);
    this.newBlockedDomain.set('');
  }

  async removeBlockedDomain(domain: string): Promise<void> {
    const current = this.imageBlockedDomains();
    await this.updateSetting('imageBlockedDomains' as any, current.filter(d => d !== domain));
  }

  private resetAccountForm(): void {
    this.accountEmail.set('');
    this.accountPassword.set('');
    this.accountDisplayName.set('');
    this.accountImapHost.set('');
    this.accountImapPort.set(993);
    this.accountSmtpHost.set('');
    this.accountSmtpPort.set(465);
  }

  private resetSignatureForm(): void {
    this.editingSignatureId.set(null);
    this.signatureName.set('');
    this.signatureIsDefault.set(false);
    this.signatureSourceMode.set(false);
    this.signatureHtmlSource.set('');
    this.signatureEditor()?.clear();
  }
}
