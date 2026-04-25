import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PgpKey, PgpContactKey } from './pgp-key.entity';
import { encrypt, decrypt } from '../users/crypto.util';

@Injectable()
export class PgpService {
  constructor(
    @InjectRepository(PgpKey)
    private readonly pgpKeyRepo: Repository<PgpKey>,
    @InjectRepository(PgpContactKey)
    private readonly contactKeyRepo: Repository<PgpContactKey>,
  ) {}

  async getKeyPair(userId: string): Promise<{ userId: string; publicKey: string; privateKey: string; fingerprint: string } | null> {
    const key = await this.pgpKeyRepo.findOne({ where: { userId } });
    if (!key) return null;
    // Decrypt the private key at read time. The public key stays clear-text.
    let privateKey = key.privateKey;
    try {
      privateKey = decrypt(key.privateKey);
    } catch {
      // Backward compatibility: keys saved before encryption was enabled.
      privateKey = key.privateKey;
    }
    return {
      userId: key.userId,
      publicKey: key.publicKey,
      privateKey,
      fingerprint: key.fingerprint,
    };
  }

  async saveKeyPair(userId: string, publicKey: string, privateKey: string, fingerprint: string): Promise<PgpKey> {
    this.validatePgpKey(publicKey, 'public');
    this.validatePgpKey(privateKey, 'private');
    this.validateFingerprint(fingerprint);

    // Replace existing key pair (by design: one key pair per user).
    await this.pgpKeyRepo.delete({ userId });
    return this.pgpKeyRepo.save(
      this.pgpKeyRepo.create({
        userId,
        publicKey,
        privateKey: encrypt(privateKey),
        fingerprint,
      }),
    );
  }

  async deleteKeyPair(userId: string): Promise<void> {
    await this.pgpKeyRepo.delete({ userId });
  }

  async getContactKeys(userId: string): Promise<PgpContactKey[]> {
    return this.contactKeyRepo.find({ where: { userId } });
  }

  async saveContactKey(userId: string, email: string, publicKey: string): Promise<PgpContactKey> {
    this.validatePgpKey(publicKey, 'public');
    const normalizedEmail = email.trim().toLowerCase();
    const existing = (await this.contactKeyRepo.find({ where: { userId } }))
      .find((contactKey) => contactKey.email.trim().toLowerCase() === normalizedEmail);
    if (existing) {
      existing.publicKey = publicKey;
      return this.contactKeyRepo.save(existing);
    }
    return this.contactKeyRepo.save(
      this.contactKeyRepo.create({ userId, email, publicKey }),
    );
  }

  async removeContactKey(userId: string, email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = (await this.contactKeyRepo.find({ where: { userId } }))
      .find((contactKey) => contactKey.email.trim().toLowerCase() === normalizedEmail);
    if (existing) {
      await this.contactKeyRepo.delete({ id: existing.id, userId });
    }
  }

  private validatePgpKey(key: string, kind: 'public' | 'private'): void {
    if (typeof key !== 'string' || key.length < 100 || key.length > 200_000) {
      throw new BadRequestException(`Invalid PGP ${kind} key: unexpected length`);
    }
    const expectedBegin = kind === 'public'
      ? '-----BEGIN PGP PUBLIC KEY BLOCK-----'
      : '-----BEGIN PGP PRIVATE KEY BLOCK-----';
    const expectedEnd = kind === 'public'
      ? '-----END PGP PUBLIC KEY BLOCK-----'
      : '-----END PGP PRIVATE KEY BLOCK-----';
    if (!key.includes(expectedBegin) || !key.includes(expectedEnd)) {
      throw new BadRequestException(`Invalid PGP ${kind} key: missing armor header/footer`);
    }
  }

  private validateFingerprint(fp: string): void {
    if (typeof fp !== 'string' || fp.length < 16 || fp.length > 128) {
      throw new BadRequestException('Invalid fingerprint');
    }
    if (!/^[0-9A-Fa-f\s]+$/.test(fp)) {
      throw new BadRequestException('Fingerprint must be hexadecimal');
    }
  }
}
