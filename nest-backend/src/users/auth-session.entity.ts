import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity()
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.authSessions, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  refreshTokenHash: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ default: false })
  rememberMe: boolean;

  @Column({ nullable: true })
  userAgent?: string;

  @Column({ nullable: true })
  ipAddress?: string;

  @Column({ type: 'datetime', nullable: true })
  lastSeenAt?: Date;

  @Column({ type: 'datetime', nullable: true })
  revokedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
