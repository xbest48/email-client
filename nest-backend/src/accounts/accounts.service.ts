import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from './account.entity';
import { encrypt, decrypt, upgradeCiphertext } from '../users/crypto.util';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
  ) {}

  async findAll(userId: string): Promise<Account[]> {
    const accounts = await this.accountsRepository.find({ where: { user: { id: userId } } });
    return accounts.map(acc => {
      const { password, ...accountWithoutPassword } = acc;
      return accountWithoutPassword as Account;
    });
  }

  async findOne(id: string, userId: string): Promise<Account | null> {
    const acc = await this.accountsRepository.findOne({ where: { id, user: { id: userId } } });
    if (!acc) return null;
    const { password, ...accountWithoutPassword } = acc;
    return accountWithoutPassword as Account;
  }

  async findOneWithPassword(id: string, userId: string): Promise<Account | null> {
    const acc = await this.accountsRepository.findOne({ where: { id, user: { id: userId } } });
    if (!acc) return null;
    if (!acc.password) return acc;

    try {
      const plaintext = decrypt(acc.password);

      // If the ciphertext is still in the legacy AES-256-CBC format but we
      // could decrypt it (either because the current ENCRYPTION_KEY happens
      // to match the old value, or because LEGACY_ENCRYPTION_KEY is set),
      // transparently re-encrypt it in the authenticated GCM format so the
      // next read no longer depends on the legacy path.
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
      // Do NOT pass the still-encrypted blob through to IMAP — that would
      // produce an opaque 503 "Connexion impossible". Raise a clear 401 so
      // the UI can prompt the user to re-enter the mailbox password.
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

  async create(account: Partial<Account>): Promise<Account> {
    if (account.password) {
      account.password = encrypt(account.password);
    }
    const newAccount = this.accountsRepository.create(account);
    const savedAccount = await this.accountsRepository.save(newAccount);

    const { password, ...accountWithoutPassword } = savedAccount;
    return accountWithoutPassword as Account;
  }

  async update(id: string, userId: string, data: Partial<Account>): Promise<Account | null> {
    const acc = await this.accountsRepository.findOne({ where: { id, user: { id: userId } } });
    if (!acc) return null;
    if (data.displayName !== undefined) acc.displayName = data.displayName;
    const saved = await this.accountsRepository.save(acc);
    const { password, ...withoutPassword } = saved;
    return withoutPassword as Account;
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.accountsRepository.delete({ id, user: { id: userId } });
  }
}
