import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../users/user.entity';
import { encryptedTextTransformer } from '../users/encrypted-column.transformer';

@Entity()
export class FilterRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  name: string;

  @Column()
  conditionField: 'from' | 'to' | 'subject' | 'hasAttachment' | 'category';

  @Column()
  conditionOperator: 'contains' | 'equals' | 'startsWith';

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  conditionValue: string;

  @Column()
  actionType: 'move' | 'label' | 'star' | 'markRead';

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  actionValue: string;

  @Column({ default: true })
  isEnabled: boolean;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}
