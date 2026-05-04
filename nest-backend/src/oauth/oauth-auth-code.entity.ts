import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Short-lived authorization code issued at /oauth/authorize, redeemed at
 * /oauth/token for an MCP API key. Stored hashed (SHA-256) so a DB read-only
 * leak doesn't yield usable codes.
 */
@Entity()
export class OAuthAuthCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  codeHash: string;

  /** ApiKey.id this code is bound to (acts as OAuth client_id). */
  @Column()
  apiKeyId: string;

  @Column()
  redirectUri: string;

  /** PKCE code_challenge (RFC 7636). */
  @Column()
  codeChallenge: string;

  /** 'S256' or 'plain'. */
  @Column()
  codeChallengeMethod: string;

  @Column({ type: 'text', nullable: true })
  scope: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'datetime', nullable: true })
  usedAt: Date | null;
}
