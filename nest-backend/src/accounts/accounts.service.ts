import { Injectable, Logger, UnauthorizedException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, OAuthMailProvider } from './account.entity';
import { encrypt, decrypt, upgradeCiphertext } from '../users/crypto.util';
import { OauthMailHttpService } from '../oauth-mail/oauth-mail-http.service';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
    @Inject(forwardRef(() => OauthMailHttpService))
    private readonly oauthHttp: OauthMailHttpService,
  ) {}

  private stripSecrets(acc: Account): Account {
    const { password, oauthAccessToken, oauthRefreshToken, ...rest } = acc;
    return rest as Account;
  }

  async findAll(userId: string): Promise<Account[]> {
    const accounts = await this.accountsRepository.find({ where: { user: { id: userId } } });
    return accounts.map((acc) => this.stripSecrets(acc));
  }

  async findOne(id: string, userId: string): Promise<Account | null> {
    const acc = await this.accountsRepository.findOne({ where: { id, user: { id: userId } } });
    if (!acc) return null;
    return this.stripSecrets(acc);
  }

  /**
   * Returns the account with credentials decrypted and ready for IMAP/SMTP.
   *
   * For password accounts: `password` is decrypted in place.
   * For OAuth accounts: the access token is decrypted and refreshed if it has
   * expired (or is within 60 s of expiring), then exposed via the transient
   * `accessToken` field. Refreshed tokens are persisted so subsequent callers
   * skip the round-trip.
   *
   * Method name kept as `findOneWithPassword` for compatibility with the many
   * existing call sites; OAuth accounts simply leave `password` undefined.
   */
  async findOneWithPassword(id: string, userId: string): Promise<Account | null> {
    const acc = await this.accountsRepository.findOne({ where: { id, user: { id: userId } } });
    if (!acc) return null;

    if (acc.oauthProvider) {
      try {
        await this.attachFreshAccessToken(acc);
        return acc;
      } catch (err) {
        this.logger.error(
          `Account ${acc.id}: OAuth token refresh failed. The user must reconnect the account.`,
          err as Error,
        );
        throw new UnauthorizedException(
          "Les identifiants OAuth de ce compte sont expires. Veuillez reconnecter le compte dans les parametres.",
        );
      }
    }

    if (!acc.password) return acc;

    try {
      const plaintext = decrypt(acc.password);

      if (!acc.password.startsWith('v2:')) {
        try {
          await this.accountsRepository.update(
            { id: acc.id },
            { password: upgradeCiphertext(acc.password) },
          );
        } catch (err) {
          this.logger.warn(
            `Account ${acc.id}: re-encryption to GCM failed, keeping legacy ciphertext`,
            err as Error,
          );
        }
      }

      acc.password = plaintext;
      return acc;
    } catch (err) {
      this.logger.error(
        `Account ${acc.id}: stored password cannot be decrypted. ` +
          `This usually means ENCRYPTION_KEY changed since the account was created. ` +
          `Set LEGACY_ENCRYPTION_KEY to the previous value or ask the user to re-save the password.`,
        err as Error,
      );
      throw new UnauthorizedException(
        'Le mot de passe du compte email est illisible. Veuillez le saisir à nouveau dans les paramètres du compte.',
      );
    }
  }

  /**
   * Decrypt the stored access token, refresh it if necessary, persist the new
   * tokens, and attach the live access token to `acc.accessToken`.
   */
  private async attachFreshAccessToken(acc: Account): Promise<void> {
    const provider = acc.oauthProvider as OAuthMailProvider;
    const refreshToken = acc.oauthRefreshToken ? decrypt(acc.oauthRefreshToken) : null;
    if (!refreshToken) {
      throw new Error('Missing OAuth refresh token');
    }

    let accessToken = acc.oauthAccessToken ? decrypt(acc.oauthAccessToken) : null;
    const expiresAt = acc.oauthTokenExpiresAt ? new Date(acc.oauthTokenExpiresAt).getTime() : 0;
    const expiringSoon = !accessToken || Date.now() > expiresAt - 60_000;

    if (expiringSoon) {
      const refreshed = await this.oauthHttp.refreshAccessToken(provider, refreshToken);
      accessToken = refreshed.accessToken;
      const newRefresh = refreshed.refreshToken ?? refreshToken;
      await this.accountsRepository.update(
        { id: acc.id },
        {
          oauthAccessToken: encrypt(accessToken),
          oauthRefreshToken: encrypt(newRefresh),
          oauthTokenExpiresAt: new Date(refreshed.expiresAt),
        },
      );
      acc.oauthAccessToken = encrypt(accessToken);
      acc.oauthRefreshToken = encrypt(newRefresh);
      acc.oauthTokenExpiresAt = new Date(refreshed.expiresAt);
    }

    acc.accessToken = accessToken!;
  }

  async create(account: Partial<Account>): Promise<Account> {
    if (account.password) {
      account.password = encrypt(account.password);
    }
    if (account.oauthAccessToken) {
      account.oauthAccessToken = encrypt(account.oauthAccessToken);
    }
    if (account.oauthRefreshToken) {
      account.oauthRefreshToken = encrypt(account.oauthRefreshToken);
    }
    const newAccount = this.accountsRepository.create(account);
    const savedAccount = await this.accountsRepository.save(newAccount);
    return this.stripSecrets(savedAccount);
  }

  /**
   * Save (or replace) an OAuth-authenticated account. If an account with the
   * same email already exists for this user, its tokens are rotated; otherwise
   * a new row is created. Returns the saved account without secrets.
   */
  async upsertOAuthAccount(
    userId: string,
    input: {
      email: string;
      displayName?: string;
      provider: OAuthMailProvider;
      accessToken: string;
      refreshToken: string;
      expiresAt: Date;
      imapHost: string;
      imapPort: number;
      smtpHost: string;
      smtpPort: number;
    },
  ): Promise<Account> {
    const existing = (await this.accountsRepository.find({ where: { user: { id: userId } } }))
      .find((acc) => acc.email === input.email);

    if (existing) {
      existing.displayName = input.displayName ?? existing.displayName;
      existing.imapHost = input.imapHost;
      existing.imapPort = input.imapPort;
      existing.smtpHost = input.smtpHost;
      existing.smtpPort = input.smtpPort;
      existing.password = undefined;
      existing.oauthProvider = input.provider;
      existing.oauthAccessToken = encrypt(input.accessToken);
      existing.oauthRefreshToken = encrypt(input.refreshToken);
      existing.oauthTokenExpiresAt = input.expiresAt;
      const saved = await this.accountsRepository.save(existing);
      return this.stripSecrets(saved);
    }

    const created = this.accountsRepository.create({
      user: { id: userId } as any,
      email: input.email,
      displayName: input.displayName ?? '',
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      oauthProvider: input.provider,
      oauthAccessToken: encrypt(input.accessToken),
      oauthRefreshToken: encrypt(input.refreshToken),
      oauthTokenExpiresAt: input.expiresAt,
    });
    const saved = await this.accountsRepository.save(created);
    return this.stripSecrets(saved);
  }

  async update(id: string, userId: string, data: Partial<Account>): Promise<Account | null> {
    const acc = await this.accountsRepository.findOne({ where: { id, user: { id: userId } } });
    if (!acc) return null;

    if (data.email !== undefined) acc.email = data.email;
    if (data.displayName !== undefined) acc.displayName = data.displayName;
    if (data.imapHost !== undefined) acc.imapHost = data.imapHost;
    if (data.imapPort !== undefined) acc.imapPort = data.imapPort;
    if (data.smtpHost !== undefined) acc.smtpHost = data.smtpHost;
    if (data.smtpPort !== undefined) acc.smtpPort = data.smtpPort;
    if (data.password !== undefined && data.password !== '') {
      acc.password = encrypt(data.password);
      // Switching back to password auth invalidates any stored OAuth tokens.
      acc.oauthProvider = null;
      acc.oauthAccessToken = null;
      acc.oauthRefreshToken = null;
      acc.oauthTokenExpiresAt = null;
    }

    const saved = await this.accountsRepository.save(acc);
    return this.stripSecrets(saved);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.accountsRepository.delete({ id, user: { id: userId } });
  }
}
