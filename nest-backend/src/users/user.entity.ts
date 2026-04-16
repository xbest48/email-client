import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Account } from '../accounts/account.entity';
import { AuthSession } from './auth-session.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ nullable: true })
  twoFactorSecret?: string;

  @Column({ default: false })
  isTwoFactorEnabled: boolean;

  @Column({ nullable: true })
  currentChallenge?: string; // Used for WebAuthn

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

  @Column({ type: 'text', default: '[]' })
  imageAllowedDomains: string;

  @Column({ type: 'text', default: '[]' })
  imageBlockedDomains: string;

  @Column({ nullable: true })
  openAiApiKey?: string;

  @Column({ nullable: true })
  aiApiKey?: string;

  @Column({ default: 'openai' })
  aiProvider: 'openai' | 'anthropic' | 'google' | 'mistral' | 'other';

  @Column({ nullable: true })
  aiApiUrl?: string;

  @Column({ default: false })
  isAiEnabled: boolean;

  @Column({ default: false })
  hideAiHints: boolean;

  @OneToMany(() => Account, account => account.user)
  accounts: Account[];

  @OneToMany(() => AuthSession, (authSession) => authSession.user)
  authSessions: AuthSession[];
}
