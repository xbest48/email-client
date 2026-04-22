import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity()
export class EmailAiInsight {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'text', nullable: true })
  accountId: string | null;

  @Column({ type: 'text', nullable: true })
  messageId: string | null;

  @Column({ type: 'text', nullable: true })
  folder: string | null;

  @Column({ type: 'integer', nullable: true })
  uid: number | null;

  @Column()
  contentHash: string;

  @Column({ type: 'text', default: 'Autre' })
  category: string;

  @Column({ type: 'text', nullable: true })
  urgency: 'low' | 'medium' | 'high' | null;

  @Column({ type: 'text', nullable: true })
  confidence: 'low' | 'medium' | 'high' | null;

  @Column({ type: 'text', nullable: true })
  phishingLevel: 'low' | 'medium' | 'high' | null;

  @Column({ type: 'text', default: '' })
  reason: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}
