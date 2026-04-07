import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from './account.entity';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012'; // Must be 32 bytes
const IV_LENGTH = 16;

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
  ) {}

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  private decrypt(text: string): string {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift() as string, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }

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
    if (acc && acc.password) {
      try {
        acc.password = this.decrypt(acc.password);
      } catch (e) {
        console.error('Failed to decrypt password for account', acc.id);
      }
    }
    return acc;
  }

  async create(account: Partial<Account>): Promise<Account> {
    if (account.password) {
      account.password = this.encrypt(account.password);
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
