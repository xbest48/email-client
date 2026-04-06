import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Contact } from './contact.entity';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
  ) {}

  async search(userId: string, query: string): Promise<Contact[]> {
    if (!query) return this.findRecent(userId);
    return this.contactRepository.find({
      where: [
        { userId, name: Like(`%${query}%`) },
        { userId, email: Like(`%${query}%`) },
      ],
      order: { frequency: 'DESC' },
      take: 10,
    });
  }

  async findRecent(userId: string): Promise<Contact[]> {
    return this.contactRepository.find({
      where: { userId },
      order: { frequency: 'DESC' },
      take: 10,
    });
  }

  async upsertFromSend(userId: string, addresses: { name: string; email: string }[]): Promise<void> {
    for (const addr of addresses) {
      if (!addr.email) continue;
      const existing = await this.contactRepository.findOne({
        where: { userId, email: addr.email },
      });
      if (existing) {
        existing.frequency += 1;
        if (addr.name && addr.name !== addr.email) existing.name = addr.name;
        await this.contactRepository.save(existing);
      } else {
        await this.contactRepository.save(
          this.contactRepository.create({
            userId,
            email: addr.email,
            name: addr.name || addr.email,
            frequency: 1,
          }),
        );
      }
    }
  }
}
