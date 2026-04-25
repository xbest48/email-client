import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../users/user.entity';
import { encryptedTextTransformer } from '../users/encrypted-column.transformer';

@Entity()
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.accounts, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  email: string;

  @Column({ type: 'text', default: '', transformer: encryptedTextTransformer })
  displayName: string;

  @Column({ nullable: true })
  password?: string;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  imapHost: string;

  @Column()
  imapPort: number;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  smtpHost: string;

  @Column()
  smtpPort: number;
}
