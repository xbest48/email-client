import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Label } from './label.entity';
import { EmailLabel } from './email-label.entity';

@Injectable()
export class LabelsService {
  private readonly defaultLabels = [
    { name: 'Important', color: '#ef4444' },
    { name: 'A traiter', color: '#f59e0b' },
    { name: 'En attente', color: '#3b82f6' },
    { name: 'Clients', color: '#10b981' },
    { name: 'Factures', color: '#8b5cf6' },
    { name: 'Personnel', color: '#14b8a6' },
  ] as const;

  constructor(
    @InjectRepository(Label)
    private readonly labelRepository: Repository<Label>,
    @InjectRepository(EmailLabel)
    private readonly emailLabelRepository: Repository<EmailLabel>,
  ) {}

  async findAllByUser(userId: string): Promise<Label[]> {
    await this.ensureDefaultLabelsForUser(userId);
    return this.labelRepository.find({ where: { userId } });
  }

  private async ensureDefaultLabelsForUser(userId: string): Promise<void> {
    const existing = await this.labelRepository.find({ where: { userId } });

    if (existing.length === 0) {
      const labels = this.defaultLabels.map((label) =>
        this.labelRepository.create({
          userId,
          name: label.name,
          color: label.color,
        }),
      );

      await this.labelRepository.save(labels);
      return;
    }

    const personnel = existing.find(
      (label) => label.name.toLowerCase() === 'personnel' && label.color.toLowerCase() === '#ef4444',
    );

    if (personnel) {
      personnel.color = '#14b8a6';
      await this.labelRepository.save(personnel);
    }
  }

  async create(userId: string, data: { name: string; color: string }): Promise<Label> {
    const label = this.labelRepository.create({
      name: data.name,
      color: data.color,
      userId,
    });
    return this.labelRepository.save(label);
  }

  async update(id: string, userId: string, data: Partial<{ name: string; color: string }>): Promise<Label | null> {
    const label = await this.labelRepository.findOne({ where: { id, userId } });
    if (!label) return null;

    if (data.name !== undefined) label.name = data.name;
    if (data.color !== undefined) label.color = data.color;

    return this.labelRepository.save(label);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.labelRepository.delete({ id, userId });
  }

  async addEmailToLabel(labelId: string, userId: string, folder: string, uid: number): Promise<EmailLabel> {
    const existing = await this.emailLabelRepository.findOne({
      where: { labelId, userId, folder, uid },
    });
    if (existing) return existing;

    const emailLabel = this.emailLabelRepository.create({
      labelId,
      userId,
      folder,
      uid,
    });
    return this.emailLabelRepository.save(emailLabel);
  }

  async removeEmailFromLabel(labelId: string, userId: string, folder: string, uid: number): Promise<void> {
    await this.emailLabelRepository.delete({ labelId, userId, folder, uid });
  }

  async getEmailsByLabel(labelId: string, userId: string): Promise<EmailLabel[]> {
    return this.emailLabelRepository.find({
      where: { labelId, userId },
    });
  }

  async getLabelsForEmail(userId: string, folder: string, uid: number): Promise<Label[]> {
    const emailLabels = await this.emailLabelRepository.find({
      where: { userId, folder, uid },
      relations: ['label'],
    });
    return emailLabels.map((el) => el.label);
  }

  async getLabelsForEmails(userId: string, folder: string, uids: number[]): Promise<Map<number, Label[]>> {
    if (uids.length === 0) return new Map();

    const emailLabels = await this.emailLabelRepository
      .createQueryBuilder('el')
      .leftJoinAndSelect('el.label', 'label')
      .where('el.userId = :userId', { userId })
      .andWhere('el.folder = :folder', { folder })
      .andWhere('el.uid IN (:...uids)', { uids })
      .getMany();

    const map = new Map<number, Label[]>();
    for (const el of emailLabels) {
      const existing = map.get(el.uid) || [];
      existing.push(el.label);
      map.set(el.uid, existing);
    }
    return map;
  }

  async getAllEmailLabelsForUser(
    userId: string,
  ): Promise<{ folder: string; uid: number; labelId: string }[]> {
    const rows = await this.emailLabelRepository.find({
      where: { userId },
      select: ['folder', 'uid', 'labelId'],
    });
    return rows.map((r) => ({ folder: r.folder, uid: r.uid, labelId: r.labelId }));
  }

  async getLabelCountsForUser(userId: string): Promise<{ labelId: string; count: number }[]> {
    const results = await this.emailLabelRepository
      .createQueryBuilder('el')
      .select('el.labelId', 'labelId')
      .addSelect('COUNT(*)', 'count')
      .where('el.userId = :userId', { userId })
      .groupBy('el.labelId')
      .getRawMany();

    return results.map((r) => ({ labelId: r.labelId, count: parseInt(r.count, 10) }));
  }
}
