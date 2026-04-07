import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { SnoozedEmail } from './snoozed-email.entity';

@Injectable()
export class SnoozeService {
  constructor(
    @InjectRepository(SnoozedEmail)
    private readonly snoozedEmailRepository: Repository<SnoozedEmail>,
  ) {}

  async findAll(userId: string): Promise<SnoozedEmail[]> {
    return this.snoozedEmailRepository.find({
      where: { userId },
      order: { snoozeUntil: 'ASC' },
    });
  }

  async create(userId: string, data: { folder: string; uid: number; snoozeUntil: Date }): Promise<SnoozedEmail> {
    const snoozed = this.snoozedEmailRepository.create({
      userId,
      folder: data.folder,
      uid: data.uid,
      snoozeUntil: data.snoozeUntil,
      user: { id: userId } as any,
    });
    return this.snoozedEmailRepository.save(snoozed);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.snoozedEmailRepository.delete({ id, userId });
  }

  async findDue(userId: string): Promise<SnoozedEmail[]> {
    return this.snoozedEmailRepository.find({
      where: {
        userId,
        snoozeUntil: LessThanOrEqual(new Date()),
      },
      order: { snoozeUntil: 'ASC' },
    });
  }

  async count(userId: string): Promise<number> {
    return this.snoozedEmailRepository.count({ where: { userId } });
  }
}
