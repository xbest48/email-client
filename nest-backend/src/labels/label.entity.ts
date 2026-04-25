import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany } from 'typeorm';
import { User } from '../users/user.entity';
import { EmailLabel } from './email-label.entity';
import { encryptedTextTransformer } from '../users/encrypted-column.transformer';

@Entity()
export class Label {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  name: string;

  @Column()
  color: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @OneToMany(() => EmailLabel, (emailLabel) => emailLabel.label)
  emailLabels: EmailLabel[];
}
