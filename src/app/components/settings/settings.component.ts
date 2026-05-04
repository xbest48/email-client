import { environment } from '../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal, computed, output, ChangeDetectionStrategy, viewChild, ElementRef, afterNextRender, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { SettingsService, EmailAccount, EmailSignature, EmailTemplate } from '../../services/settings.service';
import { RichEditorComponent } from '../rich-editor/rich-editor.component';
import { ActiveSession, AiFeaturePreferenceKey, AiProvider, AuthService, DarkEmailRendering, PushPayloadMode } from '../../services/auth.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { ToastService } from '../../services/toast.service';
import { LabelService, Label } from '../../services/label.service';
import { FilterService, FilterRule } from '../../services/filter.service';
import { PgpService } from '../../services/pgp.service';
import { EmailService } from '../../services/email.service';
import { ConfirmDialogService } from '../../services/confirm-dialog.service';
import { ApiKeyService, ApiKeyMeta } from '../../services/api-key.service';
import { OauthMailService } from '../../services/oauth-mail.service';
import { SandboxedHtmlDirective } from '../../directives/sandboxed-html.directive';
import { ThemeService, ThemeMode } from '../../services/theme.service';
import {
  findOversizedEmbeddedSignatureImage,
  formatEmbeddedImageSizeKiB,
  MAX_SIGNATURE_EMBEDDED_IMAGE_BYTES,
} from '../../utils/signature-embedded-image-policy';
import * as QRCode from 'qrcode';
import { startRegistration } from '@simplewebauthn/browser';

type SettingsTab = 'accounts' | 'signatures' | 'security' | 'general' | 'labels' | 'filters' | 'templates' | 'privacy' | 'ai' | 'mcpAccess';
type EmailAccountProvider = 'google' | 'microsoft' | 'apple';
type AiFeatureToggle = {
  key: AiFeaturePreferenceKey;
  label: string;
  description: string;
};
type EmailAccountProviderOption = {
  id: EmailAccountProvider;
  name: string;
  badge: string;
  emailPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  hint: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  domains: readonly string[];
};

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RichEditorComponent, SandboxedHtmlDirective, DatePipe],
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
  protected readonly emailService = inject(EmailService);
  protected readonly themeService = inject(ThemeService);
  protected readonly pushNotificationService = inject(PushNotificationService);
  private readonly toastService = inject(ToastService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly router = inject(Router);
  protected readonly apiKeyService = inject(ApiKeyService);
  protected readonly oauthMailService = inject(OauthMailService);

  readonly themeMode = this.themeService.mode;
  readonly themeModes: ReadonlyArray<{ value: ThemeMode; label: string; description: string }> = [
    { value: 'light', label: 'Clair', description: 'Interface claire en permanence.' },
    { value: 'dark', label: 'Sombre', description: 'Interface sombre en permanence.' },
    { value: 'system', label: 'Systeme', description: "Suit le theme de votre systeme d'exploitation." },
  ];

  setThemeMode(mode: ThemeMode): void {
    this.themeService.setMode(mode);
  }

  readonly darkEmailRendering = computed<DarkEmailRendering>(
    () => this.authService.user()?.darkEmailRendering ?? 'force-dark',
  );
  readonly darkEmailRenderingOptions: ReadonlyArray<{ value: DarkEmailRendering; label: string; description: string }> = [
    {
      value: 'preserve',
      label: 'Conserver la mise en page',
      description: "Affiche l'e-mail avec ses couleurs d'origine sur un fond blanc. Ideal pour les newsletters.",
    },
    {
      value: 'force-dark',
      label: 'Forcer le mode sombre',
      description: "Fond sombre et texte clair meme pour les e-mails qui n'en ont pas. Ideal pour la lecture.",
    },
  ];

  async setDarkEmailRendering(mode: DarkEmailRendering): Promise<void> {
    try {
      await this.authService.updateSettings({ darkEmailRendering: mode });
    } catch (e) {
      console.error('Failed to update darkEmailRendering', e);
      this.toastService.show('error', "Erreur lors de la mise a jour du reglage.");
    }
  }
  readonly activeTab = signal<SettingsTab>('general');

  // Security
  readonly qrCodeUrl = signal<string | null>(null);
  readonly twoFactorCode = signal('');
  readonly twoFactorEnabled = signal(false);
  readonly activeSessions = signal<ActiveSession[]>([]);
  readonly sessionsLoading = signal(false);
  readonly sessionsLoaded = signal(false);
  readonly revokeSessionLoadingId = signal<string | null>(null);
  readonly revokeOtherSessionsLoading = signal(false);

  // Account form
  readonly oauthConnecting = signal<EmailAccountProvider | null>(null);
  readonly oauthAvailableProviders = this.oauthMailService.availableProviders;
  readonly showAccountForm = signal(false);
  readonly editingAccountId = signal<string | null>(null);
  readonly accountEmail = signal('');
  readonly accountPassword = signal('');
  readonly accountDisplayName = signal('');
  readonly accountImapHost = signal('');
  readonly accountImapPort = signal(993);
  readonly accountSmtpHost = signal('');
  readonly accountSmtpPort = signal(465);
  readonly selectedAccountProvider = signal<EmailAccountProvider | null>(null);
  readonly accountProviderOptions: ReadonlyArray<EmailAccountProviderOption> = [
    {
      id: 'google',
      name: 'Google',
      badge: 'Gmail',
      emailPlaceholder: 'vous@gmail.com',
      passwordLabel: "Mot de passe d'application Google",
      passwordPlaceholder: "Mot de passe d'application",
      hint: "Utilise les serveurs Gmail. Activez l'IMAP et creez un mot de passe d'application dans votre compte Google.",
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      domains: ['gmail.com', 'googlemail.com'],
    },
    {
      id: 'microsoft',
      name: 'Microsoft',
      badge: 'Outlook',
      emailPlaceholder: 'vous@outlook.com',
      passwordLabel: "Mot de passe d'application Microsoft",
      passwordPlaceholder: "Mot de passe d'application",
      hint: "Utilise les serveurs Outlook. Si la validation en deux etapes est active, utilisez un mot de passe d'application.",
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    },
    {
      id: 'apple',
      name: 'Apple',
      badge: 'iCloud',
      emailPlaceholder: 'vous@icloud.com',
      passwordLabel: "Mot de passe specifique a l'app Apple",
      passwordPlaceholder: "Mot de passe specifique a l'app",
      hint: "Utilise les serveurs iCloud Mail. Apple demande un mot de passe specifique a l'app pour les clients mail tiers.",
      imapHost: 'imap.mail.me.com',
      imapPort: 993,
      smtpHost: 'smtp.mail.me.com',
      smtpPort: 587,
      domains: ['icloud.com', 'me.com', 'mac.com'],
    },
  ];
  readonly selectedAccountProviderOption = computed(() => {
    const provider = this.selectedAccountProvider();
    return provider
      ? this.accountProviderOptions.find((option) => option.id === provider) ?? null
      : null;
  });

  // Signature form
  readonly showSignatureForm = signal(false);
  readonly signatureName = signal('');
  readonly signatureIsDefault = signal(false);
  readonly editingSignatureId = signal<string | null>(null);

  // General
  readonly pageSize = signal(this.settingsService.pageSize);
  readonly accentPresetColors = ['#403d84', '#1d4ed8', '#0781f2', '#c34b22', '#0e8f0a', '#ff477b', '#ffd200', '#b6d0f2', '#ffcbba', '#c6ebc5', '#ffbacd'];
  readonly selectedAccentColor = signal(this.settingsService.accentColor);
  readonly aiApiKey = signal('');
  readonly aiProvider = signal<AiProvider>('openai');
  readonly aiApiUrl = signal('');
  readonly hideAiHintsPreference = signal(false);
  readonly savingAiSettings = signal(false);
  readonly aiComposeEnabled = signal(true);
  readonly aiSummaryEnabled = signal(true);
  readonly aiReplySuggestionsEnabled = signal(true);
  readonly aiActionExtractionEnabled = signal(true);
  readonly aiPhishingEnabled = signal(true);
  readonly aiCategorizationEnabled = signal(true);
  readonly aiTranslationEnabled = signal(true);
  readonly aiTriageEnabled = signal(true);
  readonly customAccentColor = signal(this.settingsService.accentColor);
  readonly mobileSwipeLeftAction = signal<'trash' | 'move' | 'spam' | 'toggleRead' | 'toggleStar'>(this.settingsService.mobileSwipeLeftAction);
  readonly mobileSwipeLeftMoveFolder = signal(this.settingsService.mobileSwipeLeftMoveFolder);
  readonly mobileSwipeRightAction = signal<'trash' | 'move' | 'spam' | 'toggleRead' | 'toggleStar'>(this.settingsService.mobileSwipeRightAction);
  readonly mobileSwipeRightMoveFolder = signal(this.settingsService.mobileSwipeRightMoveFolder);
  readonly blockTrackingPixels = computed(() => this.authService.user()?.blockTrackingPixels ?? false);
  readonly undoSendDelay = computed(() => this.authService.user()?.undoSendDelay ?? 0);
  readonly pushPayloadMode = computed<PushPayloadMode>(() => this.authService.user()?.pushPayloadMode ?? 'subject');
  readonly pushPayloadModeOptions: ReadonlyArray<{ value: PushPayloadMode; label: string; description: string }> = [
    { value: 'subject', label: 'Sujet visible', description: "Affiche l'expediteur et l'objet du message." },
    { value: 'sender-only', label: 'Expediteur seul', description: "Affiche uniquement l'expediteur, sans l'objet." },
    { value: 'generic', label: 'Generique', description: "N'affiche aucune information personnelle." },
  ];
  readonly aiProviderOptions: ReadonlyArray<{ value: AiProvider; label: string }> = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'google', label: 'Google' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'other', label: 'Autre' },
  ];
  readonly mobileSwipeActionOptions: ReadonlyArray<{
    value: 'trash' | 'move' | 'spam' | 'toggleRead' | 'toggleStar';
    label: string;
    description: string;
  }> = [
    { value: 'trash', label: 'Supprimer', description: 'Envoie le message a la corbeille.' },
    { value: 'move', label: 'Deplacer', description: 'Deplace le message vers un dossier choisi.' },
    { value: 'spam', label: 'Spam', description: 'Marque le message comme spam.' },
    { value: 'toggleRead', label: 'Lu / Non lu', description: 'Bascule l\'etat lu du message.' },
    { value: 'toggleStar', label: 'Suivi', description: 'Ajoute ou retire le suivi du message.' },
  ];
  readonly aiProviderLabel = computed(() => {
    const provider = this.authService.user()?.aiProvider ?? 'openai';
    return this.aiProviderOptions.find((option) => option.value === provider)?.label ?? 'OpenAI';
  });
  readonly aiFeatureToggles: ReadonlyArray<AiFeatureToggle> = [
    {
      key: 'aiComposeEnabled',
      label: "Assistant de redaction",
      description: "Aide a rediger ou ameliorer un brouillon dans la fenetre de composition.",
    },
    {
      key: 'aiSummaryEnabled',
      label: 'Resume des e-mails',
      description: "Affiche l'action pour resumer rapidement le contenu d'un message.",
    },
    {
      key: 'aiReplySuggestionsEnabled',
      label: 'Suggestions de reponse',
      description: 'Propose des reponses courtes pretes a envoyer.',
    },
    {
      key: 'aiActionExtractionEnabled',
      label: "Extraction d'actions",
      description: "Repere les taches, suivis et echeances a partir d'un message.",
    },
    {
      key: 'aiPhishingEnabled',
      label: 'Analyse phishing',
      description: "Analyse le niveau d'alerte d'un e-mail suspect.",
    },
    {
      key: 'aiCategorizationEnabled',
      label: 'Categorisation',
      description: 'Classe un message dans une categorie utile pour la boite mail.',
    },
    {
      key: 'aiTranslationEnabled',
      label: 'Traduction',
      description: "Affiche les actions de traduction dans l'ecran de lecture.",
    },
    {
      key: 'aiTriageEnabled',
      label: 'Tri intelligent de la liste',
      description: "Analyse la liste des messages pour afficher les insights IA et filtres intelligents.",
    },
  ];

  readonly signatureEditor = viewChild<RichEditorComponent>('signatureEditor');
  readonly signatureSourceMode = signal(false);
  readonly signatureHtmlSource = signal('');
  readonly lastAcceptedSignatureHtml = signal('');

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
  readonly aiCategoryOptions = [
    'Factures',
    'Newsletter',
    'Urgent',
    'Personnel',
    'Travail',
    'Promotion',
    'Social',
    'Support',
    'Autre',
  ] as const;

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

    effect(() => {
      const user = this.authService.user();
      this.aiProvider.set(user?.aiProvider ?? 'openai');
      this.aiApiUrl.set(user?.aiApiUrl ?? '');
      this.hideAiHintsPreference.set(!!user?.hideAiHints);
      this.aiComposeEnabled.set(user?.aiComposeEnabled ?? true);
      this.aiSummaryEnabled.set(user?.aiSummaryEnabled ?? true);
      this.aiReplySuggestionsEnabled.set(user?.aiReplySuggestionsEnabled ?? true);
      this.aiActionExtractionEnabled.set(user?.aiActionExtractionEnabled ?? true);
      this.aiPhishingEnabled.set(user?.aiPhishingEnabled ?? true);
      this.aiCategorizationEnabled.set(user?.aiCategorizationEnabled ?? true);
      this.aiTranslationEnabled.set(user?.aiTranslationEnabled ?? true);
      this.aiTriageEnabled.set(user?.aiTriageEnabled ?? true);
    });

    effect(() => {
      if (this.activeTab() === 'security' && !this.sessionsLoaded()) {
        void this.loadActiveSessions();
      }
    });

    effect(() => {
      if (this.activeTab() === 'mcpAccess') {
        void this.loadMcpAccessKeys();
      }
    });

    effect(() => {
      if (this.activeTab() === 'accounts') {
        void this.oauthMailService.loadAvailableProviders();
      }
    });
  }

  /**
   * Launch the popup-based OAuth flow for the selected provider. On success
   * the new account is appended to the list; we re-fetch from the server so
   * the UI reflects the canonical record (including the OAuth provider tag).
   */
  async connectOauthProvider(provider: EmailAccountProvider): Promise<void> {
    if (provider !== 'microsoft' && provider !== 'google') return;
    if (!this.oauthAvailableProviders().includes(provider)) {
      this.toastService.show(
        'error',
        "OAuth n'est pas configure pour ce fournisseur sur ce serveur. Definissez les variables d'environnement requises.",
      );
      return;
    }
    this.oauthConnecting.set(provider);
    try {
      const result = await this.oauthMailService.connect(provider);
      // Reload the canonical account list from the backend to pick up the
      // newly-created (or updated) row, then close the form.
      await this.settingsService.reloadAccounts();
      this.toastService.show('success', `Compte ${result.email} connecte.`);
      this.cancelAccountForm();
    } catch (err: any) {
      this.toastService.show('error', err?.message || 'Connexion OAuth annulee.');
    } finally {
      this.oauthConnecting.set(null);
    }
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
    const domain = email.split('@')[1]?.trim().toLowerCase();
    const provider = domain ? this.findAccountProviderByDomain(domain) : null;
    if (provider) {
      this.applyAccountProvider(provider.id, false);
      return;
    }
    if (domain && !this.accountImapHost()) {
      this.accountImapHost.set(`imap.${domain}`);
      this.accountSmtpHost.set(`smtp.${domain}`);
    }
  }

  async testConnection(): Promise<void> {
    if (!this.accountEmail() || !this.accountPassword() || !this.accountImapHost() || !this.accountSmtpHost()) {
        await this.confirmDialog.alert({
          title: 'Champs manquants',
          message: 'Veuillez remplir tous les champs de connexion.',
          tone: 'warning',
        });
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
      await this.confirmDialog.alert({
        title: 'Connexion reussie',
        message: 'La connexion au compte a fonctionne.',
        tone: 'success',
      });
    } else {
      await this.confirmDialog.alert({
        title: 'Echec de la connexion',
        message: 'La connexion au compte a echoue : ' + result.message,
        tone: 'error',
      });
    }
  }

  openAddAccountForm(provider?: EmailAccountProvider): void {
    this.resetAccountForm();
    if (provider) {
      this.applyAccountProvider(provider);
    }
    this.showAccountForm.set(true);
  }

  openProviderAccountForm(provider: EmailAccountProvider): void {
    this.openAddAccountForm(provider);
  }

  editAccount(account: EmailAccount): void {
    this.editingAccountId.set(account.id);
    this.accountEmail.set(account.email);
    this.accountPassword.set('');
    this.accountDisplayName.set(account.displayName ?? '');
    this.accountImapHost.set(account.imapHost);
    this.accountImapPort.set(account.imapPort);
    this.accountSmtpHost.set(account.smtpHost);
    this.accountSmtpPort.set(account.smtpPort);
    this.selectedAccountProvider.set(this.findAccountProviderByHosts(account.imapHost, account.smtpHost)?.id ?? null);
    this.showAccountForm.set(true);
  }

  applyAccountProvider(providerId: EmailAccountProvider, clearEmail = true): void {
    const provider = this.accountProviderOptions.find((option) => option.id === providerId);
    if (!provider) return;
    this.selectedAccountProvider.set(provider.id);
    this.accountImapHost.set(provider.imapHost);
    this.accountImapPort.set(provider.imapPort);
    this.accountSmtpHost.set(provider.smtpHost);
    this.accountSmtpPort.set(provider.smtpPort);
    if (clearEmail) {
      this.accountEmail.set('');
    }
  }

  cancelAccountForm(): void {
    this.resetAccountForm();
    this.showAccountForm.set(false);
  }

  async saveAccount(): Promise<void> {
    if (!this.accountEmail() || !this.accountImapHost() || !this.accountSmtpHost()) return;

    const editingId = this.editingAccountId();
    if (editingId) {
      const hasNewPassword = !!this.accountPassword();
      const data: Partial<EmailAccount> = {
        email: this.accountEmail(),
        displayName: this.accountDisplayName(),
        imapHost: this.accountImapHost(),
        imapPort: this.accountImapPort(),
        smtpHost: this.accountSmtpHost(),
        smtpPort: this.accountSmtpPort(),
      };
      if (this.accountPassword()) {
        data.password = this.accountPassword();
      }
      const updated = await this.settingsService.updateAccount(editingId, data);
      if (updated) {
        if (hasNewPassword) {
          this.emailService.clearMailboxCredentialError(editingId);
        }
        await this.emailService.refreshActiveMailboxAfterAccountUpdate(editingId);
      }
    } else {
      if (!this.accountPassword()) return;
      await this.settingsService.addAccount({
        email: this.accountEmail(),
        password: this.accountPassword(),
        displayName: this.accountDisplayName(),
        imapHost: this.accountImapHost(),
        imapPort: this.accountImapPort(),
        smtpHost: this.accountSmtpHost(),
        smtpPort: this.accountSmtpPort(),
      });
    }
    this.cancelAccountForm();
  }

  async updateAccountDisplayName(accountId: string, displayName: string): Promise<void> {
    await this.settingsService.updateAccount(accountId, { displayName });
  }

  removeAccount(id: string): void {
    this.settingsService.removeAccount(id);
    if (this.editingAccountId() === id) {
      this.cancelAccountForm();
    }
  }

  toggleSignatureSourceMode(): void {
    const sourceMode = this.signatureSourceMode();
    const editor = this.signatureEditor();
    if (sourceMode) {
      const oversizedImage = findOversizedEmbeddedSignatureImage(this.signatureHtmlSource());
      if (oversizedImage) {
        this.toastService.show('error', this.buildSignatureImageTooLargeMessage(oversizedImage));
        return;
      }
      // Switching from source to visual: apply HTML source to editor
      if (editor) {
        editor.setHtml(this.signatureHtmlSource());
        this.lastAcceptedSignatureHtml.set(this.signatureHtmlSource());
      }
    } else {
      // Switching from visual to source: copy editor content to textarea
      if (editor) {
        const html = editor.getHtml();
        this.signatureHtmlSource.set(html);
        this.lastAcceptedSignatureHtml.set(html);
      }
    }
    this.signatureSourceMode.set(!sourceMode);
  }

  openAddSignatureForm(): void {
    this.resetSignatureForm();
    this.showSignatureForm.set(true);
  }

  async saveSignature(): Promise<void> {
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
    const oversizedImage = findOversizedEmbeddedSignatureImage(html);
    if (oversizedImage) {
      this.toastService.show('error', this.buildSignatureImageTooLargeMessage(oversizedImage));
      return;
    }

    const editId = this.editingSignatureId();

    if (editId) {
      await this.settingsService.updateSignature(editId, {
        name,
        html,
        isDefault: this.signatureIsDefault(),
      });
    } else {
      await this.settingsService.addSignature({
        name,
        html,
        isDefault: this.signatureIsDefault(),
      });
    }

    this.cancelSignatureForm();
  }

  onSignatureEditorChange(html: string): void {
    const oversizedImage = findOversizedEmbeddedSignatureImage(html);
    if (oversizedImage) {
      this.toastService.show('error', this.buildSignatureImageTooLargeMessage(oversizedImage));
      const editor = this.signatureEditor();
      if (editor) {
        editor.setHtml(this.lastAcceptedSignatureHtml());
      }
      return;
    }

    this.signatureHtmlSource.set(html);
    this.lastAcceptedSignatureHtml.set(html);
  }

  editSignature(sig: EmailSignature): void {
    this.editingSignatureId.set(sig.id);
    this.signatureName.set(sig.name);
    this.signatureIsDefault.set(sig.isDefault);
    this.signatureHtmlSource.set(sig.html);
    this.lastAcceptedSignatureHtml.set(sig.html);
    this.showSignatureForm.set(true);
  }

  removeSignature(id: string): void {
    this.settingsService.removeSignature(id);
    if (this.editingSignatureId() === id) {
      this.cancelSignatureForm();
    }
  }

  cancelSignatureForm(): void {
    this.resetSignatureForm();
    this.showSignatureForm.set(false);
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
      await this.confirmDialog.alert({
        title: 'Code invalide',
        message: 'Le code 2FA saisi est invalide.',
        tone: 'error',
      });
    }
  }

  async registerPasskey(): Promise<void> {
    try {
      const options = await this.authService.generateWebAuthnRegisterOptions();
      const attResp = await startRegistration({ optionsJSON: options });
      const verified = await this.authService.verifyWebAuthnRegister(attResp);
      if (verified) {
        await this.confirmDialog.alert({
          title: 'Passkey enregistre',
          message: 'Le passkey a ete enregistre avec succes.',
          tone: 'success',
        });
      } else {
        await this.confirmDialog.alert({
          title: "Echec de l'enregistrement",
          message: "Le passkey n'a pas pu etre enregistre.",
          tone: 'error',
        });
      }
    } catch (e) {
      console.error('Passkey registration failed', e);
    }
  }

  async loadActiveSessions(force = false): Promise<void> {
    if (this.sessionsLoading()) return;
    if (this.sessionsLoaded() && !force) return;

    this.sessionsLoading.set(true);
    try {
      const sessions = await this.authService.getActiveSessions();
      this.activeSessions.set(sessions);
      this.sessionsLoaded.set(true);
    } catch (e) {
      console.error('Failed to load active sessions', e);
      await this.confirmDialog.alert({
        title: 'Sessions indisponibles',
        message: "La liste des sessions actives n'a pas pu etre chargee.",
        tone: 'error',
      });
    } finally {
      this.sessionsLoading.set(false);
    }
  }

  async revokeSession(session: ActiveSession): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: session.isCurrent ? 'Fermer cette session' : 'Revoquer la session',
      message: session.isCurrent
        ? 'Cette action va fermer votre session actuelle sur cet appareil.'
        : 'Cette session sera deconnectee et ne pourra plus se rafraichir.',
      confirmLabel: session.isCurrent ? 'Fermer la session' : 'Revoquer',
      cancelLabel: 'Annuler',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.revokeSessionLoadingId.set(session.id);
    try {
      await this.authService.revokeSessionById(session.id);
      this.activeSessions.update((sessions) => sessions.filter((item) => item.id !== session.id));
      if (session.isCurrent) {
        await this.authService.signOut();
        this.close.emit();
        await this.router.navigate(['/login']);
        return;
      }
      await this.loadActiveSessions(true);
    } catch (e) {
      console.error('Failed to revoke session', e);
      await this.confirmDialog.alert({
        title: 'Action impossible',
        message: "La session n'a pas pu etre revoquee.",
        tone: 'error',
      });
    } finally {
      this.revokeSessionLoadingId.set(null);
    }
  }

  async revokeOtherSessions(): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Fermer les autres sessions',
      message: 'Toutes les autres sessions actives seront deconnectees. Votre session actuelle restera ouverte.',
      confirmLabel: 'Fermer les autres',
      cancelLabel: 'Annuler',
      tone: 'danger',
    });
    if (!confirmed) return;

    this.revokeOtherSessionsLoading.set(true);
    try {
      await this.authService.revokeOtherSessions();
      await this.loadActiveSessions(true);
    } catch (e) {
      console.error('Failed to revoke other sessions', e);
      await this.confirmDialog.alert({
        title: 'Action impossible',
        message: "Les autres sessions n'ont pas pu etre revoquees.",
        tone: 'error',
      });
    } finally {
      this.revokeOtherSessionsLoading.set(false);
    }
  }

  sessionLabel(session: ActiveSession): string {
    const userAgent = (session.userAgent || '').toLowerCase();
    if (userAgent.includes('iphone') || userAgent.includes('ipad')) return 'iPhone / iPad';
    if (userAgent.includes('android')) return 'Android';
    if (userAgent.includes('mac os') || userAgent.includes('macintosh')) return 'Mac';
    if (userAgent.includes('windows')) return 'Windows';
    if (userAgent.includes('linux')) return 'Linux';
    return 'Appareil inconnu';
  }

  sessionDetails(session: ActiveSession): string {
    const parts = [
      session.rememberMe ? 'Session persistante' : 'Session temporaire',
      session.ipAddress || null,
    ].filter(Boolean);
    return parts.join(' • ');
  }

  formatSessionDate(value: string | null): string {
    if (!value) return 'Inconnue';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString('fr-FR', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
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

  saveMobileSwipeSettings(): void {
    this.settingsService.update({
      mobileSwipeLeftAction: this.mobileSwipeLeftAction(),
      mobileSwipeLeftMoveFolder: this.mobileSwipeLeftMoveFolder(),
      mobileSwipeRightAction: this.mobileSwipeRightAction(),
      mobileSwipeRightMoveFolder: this.mobileSwipeRightMoveFolder(),
    });
  }

  async updateSetting(key: string, value: unknown): Promise<void> {
    try {
      const current = this.authService.user() || { email: '' };
      await this.authService.updateSettings({
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

  async togglePushNotifications(): Promise<void> {
    if (this.pushNotificationService.subscribed()) {
      await this.pushNotificationService.disable();
      this.toastService.show('success', 'Notifications push desactivees.');
      return;
    }
    const result = await this.pushNotificationService.enable();
    if (result.ok) {
      this.toastService.show('success', 'Notifications push activees.');
    } else {
      this.toastService.show('error', result.reason ?? "Impossible d'activer les notifications push.");
    }
  }

  async testPushNotification(): Promise<void> {
    try {
      const result = await this.pushNotificationService.sendTest();
      if (result.sent > 0) {
        this.toastService.show('success', `Notification de test envoyee (${result.sent} appareil${result.sent > 1 ? 's' : ''}).`);
      } else {
        this.toastService.show('error', "Aucun appareil enregistre pour les notifications push.");
      }
    } catch (err) {
      this.toastService.show('error', "Impossible d'envoyer la notification de test.");
    }
  }

  async setPushPayloadMode(mode: PushPayloadMode): Promise<void> {
    try {
      await this.authService.updateSettings({ pushPayloadMode: mode });
    } catch (err) {
      this.toastService.show('error', "Impossible de mettre a jour la confidentialite des notifications.");
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
    await this.confirmDialog.alert({
      title: 'Filtre applique',
      message: `Filtre applique a ${result.applied} message(s).`,
      tone: 'success',
    });
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
    this.editingAccountId.set(null);
    this.selectedAccountProvider.set(null);
    this.accountEmail.set('');
    this.accountPassword.set('');
    this.accountDisplayName.set('');
    this.accountImapHost.set('');
    this.accountImapPort.set(993);
    this.accountSmtpHost.set('');
    this.accountSmtpPort.set(465);
  }

  private findAccountProviderByDomain(domain: string): EmailAccountProviderOption | null {
    return this.accountProviderOptions.find((option) => option.domains.includes(domain)) ?? null;
  }

  private findAccountProviderByHosts(imapHost: string, smtpHost: string): EmailAccountProviderOption | null {
    const normalizedImap = imapHost.trim().toLowerCase();
    const normalizedSmtp = smtpHost.trim().toLowerCase();
    return this.accountProviderOptions.find(
      (option) => option.imapHost === normalizedImap && option.smtpHost === normalizedSmtp,
    ) ?? null;
  }

  private resetSignatureForm(): void {
    this.editingSignatureId.set(null);
    this.signatureName.set('');
    this.signatureIsDefault.set(false);
    this.signatureSourceMode.set(false);
    this.signatureHtmlSource.set('');
    this.lastAcceptedSignatureHtml.set('');
    this.signatureEditor()?.clear();
  }

  private buildSignatureImageTooLargeMessage(
    oversizedImage: ReturnType<typeof findOversizedEmbeddedSignatureImage> extends infer T
      ? Exclude<T, null>
      : never,
  ): string {
    const label = oversizedImage.alt?.trim() ? `"${oversizedImage.alt.trim()}"` : `Image ${oversizedImage.index}`;
    return `${label} est trop lourde (${formatEmbeddedImageSizeKiB(oversizedImage.approxBytes)}). `
      + `Limite: ${formatEmbeddedImageSizeKiB(MAX_SIGNATURE_EMBEDDED_IMAGE_BYTES)} par image integree dans une signature.`;
  }

  async saveAiSettings(): Promise<void> {
    this.savingAiSettings.set(true);
    try {
      const apiKey = this.aiApiKey().trim();
      const provider = this.aiProvider();
      const apiUrl = this.aiApiUrl().trim();
      const current = this.authService.user() || { email: '' };
      const hasExistingKey = !!(this.authService.user()?.hasAiApiKey);

      if (!hasExistingKey && !apiKey) {
        this.toastService.show('error', 'Ajoutez une cle API avant de sauvegarder.');
        return;
      }
      if (provider === 'other' && !apiUrl) {
        this.toastService.show('error', "Une URL d'API est requise pour le fournisseur Autre.");
        return;
      }

      await this.authService.updateSettings({
        ...current,
        aiApiKey: apiKey || undefined,
        aiProvider: provider,
        aiApiUrl: provider === 'other' ? apiUrl : '',
        hideAiHints: this.hideAiHintsPreference(),
        aiComposeEnabled: this.aiComposeEnabled(),
        aiSummaryEnabled: this.aiSummaryEnabled(),
        aiReplySuggestionsEnabled: this.aiReplySuggestionsEnabled(),
        aiActionExtractionEnabled: this.aiActionExtractionEnabled(),
        aiPhishingEnabled: this.aiPhishingEnabled(),
        aiCategorizationEnabled: this.aiCategorizationEnabled(),
        aiTranslationEnabled: this.aiTranslationEnabled(),
        aiTriageEnabled: this.aiTriageEnabled(),
        isAiEnabled: apiKey ? true : current.isAiEnabled
      });
      this.aiApiKey.set('');
      this.toastService.show('success', 'Parametres IA sauvegardes.');
    } catch (e) {
      console.error('Failed to save AI settings', e);
      this.toastService.show('error', 'Erreur lors de la sauvegarde.');
    } finally {
      this.savingAiSettings.set(false);
    }
  }

  async deleteOpenAiApiKey(): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Supprimer la cle API IA',
      message: 'Supprimer votre cle API IA ? Les fonctionnalites IA seront desactivees.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.savingAiSettings.set(true);
    try {
      const current = this.authService.user() || { email: '' };
      await this.authService.updateSettings({
        ...current,
        aiApiKey: '',
        isAiEnabled: false
      });
      this.aiApiKey.set('');
      this.toastService.show('success', 'Cle API supprimee.');
    } catch (e) {
      console.error('Failed to delete API key', e);
    } finally {
      this.savingAiSettings.set(false);
    }
  }

  async toggleAiEnabled(): Promise<void> {
    const current = this.authService.user();
    if (!current?.hasAiApiKey) return;
    this.savingAiSettings.set(true);
    try {
      await this.authService.updateSettings({
        ...current,
        isAiEnabled: !current.isAiEnabled
      });
    } catch (e) {
      console.error('Failed to toggle AI', e);
    } finally {
      this.savingAiSettings.set(false);
    }
  }

  async updateAiHintsVisibility(): Promise<void> {
    const current = this.authService.user();
    if (!current) return;
    this.savingAiSettings.set(true);
    try {
      await this.authService.updateSettings({
        ...current,
        hideAiHints: this.hideAiHintsPreference(),
      });
    } catch (e) {
      console.error('Failed to update AI hint visibility', e);
    } finally {
      this.savingAiSettings.set(false);
    }
  }

  aiFeatureEnabled(key: AiFeaturePreferenceKey): boolean {
    switch (key) {
      case 'aiComposeEnabled':
        return this.aiComposeEnabled();
      case 'aiSummaryEnabled':
        return this.aiSummaryEnabled();
      case 'aiReplySuggestionsEnabled':
        return this.aiReplySuggestionsEnabled();
      case 'aiActionExtractionEnabled':
        return this.aiActionExtractionEnabled();
      case 'aiPhishingEnabled':
        return this.aiPhishingEnabled();
      case 'aiCategorizationEnabled':
        return this.aiCategorizationEnabled();
      case 'aiTranslationEnabled':
        return this.aiTranslationEnabled();
      case 'aiTriageEnabled':
        return this.aiTriageEnabled();
    }
  }

  async toggleAiFeature(key: AiFeaturePreferenceKey): Promise<void> {
    const current = this.authService.user();
    const nextValue = !this.aiFeatureEnabled(key);
    this.setAiFeatureSignal(key, nextValue);
    if (!current?.hasAiApiKey) return;

    this.savingAiSettings.set(true);

    try {
      await this.authService.updateSettings({
        ...current,
        [key]: nextValue,
      });
    } catch (e) {
      this.setAiFeatureSignal(key, !nextValue);
      console.error(`Failed to toggle ${key}`, e);
      this.toastService.show('error', "Erreur lors de la mise a jour d'une fonctionnalite IA.");
    } finally {
      this.savingAiSettings.set(false);
    }
  }

  private setAiFeatureSignal(key: AiFeaturePreferenceKey, value: boolean): void {
    switch (key) {
      case 'aiComposeEnabled':
        this.aiComposeEnabled.set(value);
        break;
      case 'aiSummaryEnabled':
        this.aiSummaryEnabled.set(value);
        break;
      case 'aiReplySuggestionsEnabled':
        this.aiReplySuggestionsEnabled.set(value);
        break;
      case 'aiActionExtractionEnabled':
        this.aiActionExtractionEnabled.set(value);
        break;
      case 'aiPhishingEnabled':
        this.aiPhishingEnabled.set(value);
        break;
      case 'aiCategorizationEnabled':
        this.aiCategorizationEnabled.set(value);
        break;
      case 'aiTranslationEnabled':
        this.aiTranslationEnabled.set(value);
        break;
      case 'aiTriageEnabled':
        this.aiTriageEnabled.set(value);
        break;
    }
  }

  // ==== Accès Claude (jetons API MCP) ====

  readonly mcpAccessKeys = this.apiKeyService.keys;
  readonly mcpAccessLoading = this.apiKeyService.loading;
  readonly showMcpKeyForm = signal(false);
  readonly mcpKeyName = signal('');
  readonly mcpKeyAccountId = signal<string>('');
  readonly mcpKeyExpirationChoice = signal<'never' | '30d' | '90d' | '1y'>('never');
  readonly mcpKeyCreating = signal(false);
  readonly mcpKeyJustCreatedToken = signal<string | null>(null);
  readonly mcpKeyJustCreatedClientId = signal<string | null>(null);
  readonly mcpKeyRevokingId = signal<string | null>(null);
  readonly mcpServerUrl = computed(() => `${window.location.origin}/api/mcp`);

  readonly mcpKeyExpirationOptions: ReadonlyArray<{
    value: 'never' | '30d' | '90d' | '1y';
    label: string;
  }> = [
    { value: 'never', label: 'Sans expiration' },
    { value: '30d', label: '30 jours' },
    { value: '90d', label: '90 jours' },
    { value: '1y', label: '1 an' },
  ];

  readonly mcpAccessAccountsList = computed(() => this.settingsService.accounts);

  accountLabelFor(accountId: string): string {
    const acc = this.settingsService.accounts.find((a) => a.id === accountId);
    return acc?.email ?? '(compte supprimé)';
  }

  isMcpKeyExpired(expiresAt: string | null): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
  }

  isMcpKeyActive(key: ApiKeyMeta): boolean {
    if (key.revokedAt) return false;
    return !this.isMcpKeyExpired(key.expiresAt);
  }

  mcpKeyStatus(key: ApiKeyMeta): 'active' | 'revoked' | 'expired' {
    if (key.revokedAt) return 'revoked';
    if (this.isMcpKeyExpired(key.expiresAt)) return 'expired';
    return 'active';
  }

  async loadMcpAccessKeys(): Promise<void> {
    try {
      await this.apiKeyService.fetch();
    } catch (e) {
      console.error('Failed to load API keys', e);
      this.toastService.show('error', "Impossible de charger les accès.");
    }
  }

  openCreateMcpKey(): void {
    const accounts = this.settingsService.accounts;
    if (accounts.length === 0) {
      this.toastService.show('error', "Ajoutez d'abord un compte email.");
      return;
    }
    this.mcpKeyName.set('');
    this.mcpKeyAccountId.set(accounts[0].id);
    this.mcpKeyExpirationChoice.set('never');
    this.mcpKeyJustCreatedToken.set(null);
    this.mcpKeyJustCreatedClientId.set(null);
    this.showMcpKeyForm.set(true);
  }

  cancelCreateMcpKey(): void {
    this.showMcpKeyForm.set(false);
    this.mcpKeyJustCreatedToken.set(null);
    this.mcpKeyJustCreatedClientId.set(null);
  }

  private computeExpirationDate(choice: 'never' | '30d' | '90d' | '1y'): string | null {
    if (choice === 'never') return null;
    const now = new Date();
    if (choice === '30d') now.setDate(now.getDate() + 30);
    else if (choice === '90d') now.setDate(now.getDate() + 90);
    else if (choice === '1y') now.setFullYear(now.getFullYear() + 1);
    return now.toISOString();
  }

  async createMcpKey(): Promise<void> {
    const name = this.mcpKeyName().trim();
    const accountId = this.mcpKeyAccountId();
    if (!name) {
      this.toastService.show('error', 'Donnez un nom à cet accès.');
      return;
    }
    if (!accountId) {
      this.toastService.show('error', 'Sélectionnez un compte email.');
      return;
    }
    this.mcpKeyCreating.set(true);
    try {
      const created = await this.apiKeyService.create({
        name,
        accountId,
        expiresAt: this.computeExpirationDate(this.mcpKeyExpirationChoice()),
      });
      this.mcpKeyJustCreatedToken.set(created.token);
      this.mcpKeyJustCreatedClientId.set(created.id);
      this.mcpKeyName.set('');
    } catch (e) {
      console.error('Failed to create API key', e);
      this.toastService.show('error', "Création impossible.");
    } finally {
      this.mcpKeyCreating.set(false);
    }
  }

  async copyToClipboard(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.toastService.show('success', `${label} copié.`);
    } catch {
      this.toastService.show('error', 'Copie impossible.');
    }
  }

  async revokeMcpKey(key: ApiKeyMeta): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Supprimer cet accès ?',
      message: `L'accès « ${key.name} » sera immédiatement désactivé. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.mcpKeyRevokingId.set(key.id);
    try {
      await this.apiKeyService.revoke(key.id);
      this.toastService.show('success', 'Accès supprimé.');
    } catch (e) {
      console.error('Failed to revoke API key', e);
      this.toastService.show('error', 'Suppression impossible.');
    } finally {
      this.mcpKeyRevokingId.set(null);
    }
  }
}
