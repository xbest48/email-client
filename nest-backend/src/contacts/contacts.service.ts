import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from './contact.entity';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
  ) {}

  async search(userId: string, query: string): Promise<Contact[]> {
    if (!query) return this.findRecent(userId);
    const normalizedQuery = query.trim().toLowerCase();
    const contacts = await this.contactRepository.find({
      where: { userId },
      order: { frequency: 'DESC' },
    });
    return contacts
      .filter((contact) =>
        contact.name.toLowerCase().includes(normalizedQuery)
        || contact.email.toLowerCase().includes(normalizedQuery),
      )
      .slice(0, 10);
  }

  async findRecent(userId: string): Promise<Contact[]> {
    return this.contactRepository.find({
      where: { userId },
      order: { frequency: 'DESC' },
      take: 10,
    });
  }

  async upsertFromSend(userId: string, addresses: { name: string; email: string }[]): Promise<void> {
    const contacts = await this.contactRepository.find({ where: { userId } });
    for (const addr of addresses) {
      if (!addr.email) continue;
      const normalizedEmail = addr.email.trim().toLowerCase();
      const existing = contacts.find((contact) => contact.email.trim().toLowerCase() === normalizedEmail);
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
