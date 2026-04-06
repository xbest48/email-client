import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FilterRule } from './filter-rule.entity';

@Injectable()
export class FiltersService {
  constructor(
    @InjectRepository(FilterRule)
    private readonly filterRuleRepository: Repository<FilterRule>,
  ) {}

  async findAll(userId: string): Promise<FilterRule[]> {
    return this.filterRuleRepository.find({ where: { userId } });
  }

  async findOne(id: string, userId: string): Promise<FilterRule | null> {
    return this.filterRuleRepository.findOne({ where: { id, userId } });
  }

  async create(userId: string, data: Partial<FilterRule>): Promise<FilterRule> {
    const rule = this.filterRuleRepository.create({
      ...data,
      userId,
      user: { id: userId } as any,
    });
    return this.filterRuleRepository.save(rule);
  }

  async update(id: string, userId: string, data: Partial<FilterRule>): Promise<FilterRule | null> {
    const rule = await this.filterRuleRepository.findOne({ where: { id, userId } });
    if (!rule) return null;

    Object.assign(rule, data);
    return this.filterRuleRepository.save(rule);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.filterRuleRepository.delete({ id, userId });
  }
}
