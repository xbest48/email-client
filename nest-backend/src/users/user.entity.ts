import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Account } from '../accounts/account.entity';
import { AuthSession } from './auth-session.entity';
import { encryptedTextTransformer } from './encrypted-column.transformer';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'text', nullable: true, transformer: encryptedTextTransformer })
  twoFactorSecret?: string;

  @Column({ default: false })
  isTwoFactorEnabled: boolean;

  @Column({ type: 'text', nullable: true, transformer: encryptedTextTransformer })
  currentChallenge?: string | null; // Used for WebAuthn

  @Column({ nullable: true })
  refreshTokenHash?: string;

  @Column({ type: 'datetime', nullable: true })
  refreshTokenExpiresAt?: Date;

  @Column({ default: false })
  darkMode: boolean;

  @Column({ default: 0 })
  undoSendDelay: number;

  @Column({ default: false })
  blockTrackingPixels: boolean;

  @Column({ default: 'ask' })
  imagePolicy: 'ask' | 'always' | 'never';

  @Column({ type: 'text', default: '[]', transformer: encryptedTextTransformer })
  imageAllowedDomains: string;

  @Column({ type: 'text', default: '[]', transformer: encryptedTextTransformer })
  imageBlockedDomains: string;

  @Column({ nullable: true })
  openAiApiKey?: string;

  @Column({ nullable: true })
  aiApiKey?: string;

  @Column({ default: 'openai' })
  aiProvider: 'openai' | 'anthropic' | 'google' | 'mistral' | 'other';

  @Column({ type: 'text', nullable: true, transformer: encryptedTextTransformer })
  aiApiUrl?: string;

  @Column({ default: false })
  isAiEnabled: boolean;

  @Column({ default: true })
  aiComposeEnabled: boolean;

  @Column({ default: true })
  aiSummaryEnabled: boolean;

  @Column({ default: true })
  aiReplySuggestionsEnabled: boolean;

  @Column({ default: true })
  aiActionExtractionEnabled: boolean;

  @Column({ default: true })
  aiPhishingEnabled: boolean;

  @Column({ default: true })
  aiCategorizationEnabled: boolean;

  @Column({ default: true })
  aiTranslationEnabled: boolean;

  @Column({ default: true })
  aiTriageEnabled: boolean;

  @Column({ default: false })
  hideAiHints: boolean;

  @Column({ default: true })
  desktopNotificationsEnabled: boolean;

  /**
   * How to render email HTML bodies when the app is in dark mode.
   * - 'preserve': show emails on a white card with their original colors.
   * - 'force-dark': override inline colors to force a dark background and
   *   light text (best for plain-text-ish emails).
   */
  @Column({ default: 'force-dark' })
  darkEmailRendering: 'preserve' | 'force-dark';

  /**
   * JSON-encoded AppSettings subset (signatures, templates, accentColor,
   * pageSize, showFolders, showLabelsSection). Stored as a TEXT blob so the
   * frontend can sync arbitrary UI preferences without requiring DB migrations
   * for each new field.  Accounts are excluded — they have their own table.
   */
  @Column({ type: 'text', nullable: true, transformer: encryptedTextTransformer })
  appSettings?: string;

  @OneToMany(() => Account, account => account.user)
  accounts: Account[];

  @OneToMany(() => AuthSession, (authSession) => authSession.user)
  authSessions: AuthSession[];
}
