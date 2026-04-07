import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PgpKey, PgpContactKey } from './pgp-key.entity';

@Injectable()
export class PgpService {
  constructor(
    @InjectRepository(PgpKey)
    private readonly pgpKeyRepo: Repository<PgpKey>,
    @InjectRepository(PgpContactKey)
    private readonly contactKeyRepo: Repository<PgpContactKey>,
  ) {}

  async getKeyPair(userId: string): Promise<PgpKey | null> {
    return this.pgpKeyRepo.findOne({ where: { userId } });
  }

  async saveKeyPair(userId: string, publicKey: string, privateKey: string, fingerprint: string): Promise<PgpKey> {
    // Replace existing key pair
    await this.pgpKeyRepo.delete({ userId });
    return this.pgpKeyRepo.save(
      this.pgpKeyRepo.create({ userId, publicKey, privateKey, fingerprint }),
    );
  }

  async deleteKeyPair(userId: string): Promise<void> {
    await this.pgpKeyRepo.delete({ userId });
  }

  async getContactKeys(userId: string): Promise<PgpContactKey[]> {
    return this.contactKeyRepo.find({ where: { userId } });
  }

  async saveContactKey(userId: string, email: string, publicKey: string): Promise<PgpContactKey> {
    const existing = await this.contactKeyRepo.findOne({ where: { userId, email } });
    if (existing) {
      existing.publicKey = publicKey;
      return this.contactKeyRepo.save(existing);
    }
    return this.contactKeyRepo.save(
      this.contactKeyRepo.create({ userId, email, publicKey }),
    );
  }

  async removeContactKey(userId: string, email: string): Promise<void> {
    await this.contactKeyRepo.delete({ userId, email });
  }
}
