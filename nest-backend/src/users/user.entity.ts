import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Account } from '../accounts/account.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ default: '' })
  displayName: string;

  @Column()
  passwordHash: string;

  @Column({ nullable: true })
  twoFactorSecret?: string;

  @Column({ default: false })
  isTwoFactorEnabled: boolean;

  @Column({ nullable: true })
  currentChallenge?: string; // Used for WebAuthn

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

  @OneToMany(() => Account, account => account.user)
  accounts: Account[];
}
