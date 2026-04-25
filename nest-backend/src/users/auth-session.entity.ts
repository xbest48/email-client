import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { encryptedTextTransformer } from './encrypted-column.transformer';

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

  @Column({ type: 'text', nullable: true, transformer: encryptedTextTransformer })
  userAgent?: string;

  @Column({ type: 'text', nullable: true, transformer: encryptedTextTransformer })
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
