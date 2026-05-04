import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../users/user.entity';
import { encryptedTextTransformer } from '../users/encrypted-column.transformer';

export type OAuthMailProvider = 'microsoft' | 'google';

@Entity()
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.accounts, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  email: string;

  @Column({ type: 'text', default: '', transformer: encryptedTextTransformer })
  displayName: string;

  @Column({ nullable: true })
  password?: string;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  imapHost: string;

  @Column()
  imapPort: number;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  smtpHost: string;

  @Column()
  smtpPort: number;

  // --- OAuth (XOAUTH2) credentials ---
  // For accounts that authenticate via OAuth2 (e.g. personal Outlook.com
  // accounts since Microsoft killed Basic Auth in Sep 2024). When set,
  // `oauthProvider` selects the provider and the encrypted token columns
  // hold the credentials passed to imapflow / nodemailer via XOAUTH2.

  @Column({ type: 'text', nullable: true })
  oauthProvider?: OAuthMailProvider | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedTextTransformer })
  oauthAccessToken?: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedTextTransformer })
  oauthRefreshToken?: string | null;

  @Column({ type: 'datetime', nullable: true })
  oauthTokenExpiresAt?: Date | null;

  // Transient field populated by AccountsService.findOneWithPassword for OAuth
  // accounts (after refreshing if needed). Not persisted by TypeORM because it
  // has no @Column decorator.
  accessToken?: string;
}
