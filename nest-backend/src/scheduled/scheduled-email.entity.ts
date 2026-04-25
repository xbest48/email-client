import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { encryptedTextTransformer } from '../users/encrypted-column.transformer';

@Entity()
export class ScheduledEmail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  accountId: string;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  to: string;

  @Column({ type: 'text', nullable: true, transformer: encryptedTextTransformer })
  cc: string;

  @Column({ type: 'text', nullable: true, transformer: encryptedTextTransformer })
  bcc: string;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  subject: string;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  body: string;

  @Column()
  scheduledAt: Date;

  @Column({ default: 'pending' })
  status: 'pending' | 'sent' | 'failed';

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}
