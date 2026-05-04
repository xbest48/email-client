import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import { ApiKey } from './api-key.entity';
import { AccountsService } from '../accounts/accounts.service';

const TOKEN_PREFIX = 'mcp_';
const PREFIX_LEN = 8;
const SECRET_LEN = 32;

export interface ApiKeyMeta {
  id: string;
  name: string;
  accountId: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface CreatedApiKey extends ApiKeyMeta {
  /** Token en clair, retourné UNE SEULE FOIS à la création. */
  token: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly repo: Repository<ApiKey>,
    private readonly accounts: AccountsService,
  ) {}

  private toMeta(k: ApiKey): ApiKeyMeta {
    return {
      id: k.id,
      name: k.name,
      accountId: k.accountId,
      keyPrefix: k.keyPrefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
    };
  }

  async listForUser(userId: string): Promise<ApiKeyMeta[]> {
    const rows = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => this.toMeta(r));
  }

  async create(
    userId: string,
    data: { name: string; accountId: string; expiresAt?: Date | null },
  ): Promise<CreatedApiKey> {
    const trimmed = (data.name || '').trim();
    if (!trimmed) throw new BadRequestException('Le nom est requis.');
    if (trimmed.length > 80) throw new BadRequestException('Nom trop long (max 80).');

    // Verify the account belongs to the user.
    const account = await this.accounts.findOne(data.accountId, userId);
    if (!account) throw new NotFoundException('Compte email introuvable.');

    const prefix = randomBytes(PREFIX_LEN / 2).toString('hex'); // 8 hex chars
    const secret = randomBytes(SECRET_LEN).toString('hex');
    const token = `${TOKEN_PREFIX}${prefix}_${secret}`;

    const entity = this.repo.create({
      userId,
      accountId: data.accountId,
      name: trimmed,
      keyHash: hashToken(token),
      keyPrefix: prefix,
      expiresAt: data.expiresAt ?? null,
      lastUsedAt: null,
      revokedAt: null,
    });
    const saved = await this.repo.save(entity);

    return { ...this.toMeta(saved), token };
  }

  async revoke(id: string, userId: string): Promise<void> {
    const row = await this.repo.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('Clé introuvable.');
    if (!row.revokedAt) {
      row.revokedAt = new Date();
      await this.repo.save(row);
    }
  }

  /**
   * Validate an incoming token. Returns the entity if valid, null otherwise.
   * Updates `lastUsedAt` on success (best-effort, non-blocking).
   */
  async validateToken(
    token: string,
  ): Promise<{ userId: string; accountId: string; id: string } | null> {
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
    const row = await this.repo.findOne({ where: { keyHash: hashToken(token) } });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    // Best-effort lastUsedAt update (don't await to keep the request fast).
    void this.repo.update({ id: row.id }, { lastUsedAt: new Date() }).catch(() => {});

    return { userId: row.userId, accountId: row.accountId, id: row.id };
  }
}
