import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Account } from '../accounts/account.entity';

@Entity()
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  @Index()
  userId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  account: Account;

  @Column()
  accountId: string;

  @Column()
  name: string;

  @Column({ unique: true })
  @Index()
  keyHash: string;

  @Column()
  keyPrefix: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  revokedAt: Date | null;
}
