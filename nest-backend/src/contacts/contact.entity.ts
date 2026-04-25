import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../users/user.entity';
import { encryptedTextTransformer } from '../users/encrypted-column.transformer';

@Entity()
export class Contact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  name: string;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  email: string;

  @Column({ default: 1 })
  frequency: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}
