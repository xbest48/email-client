import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../users/user.entity';

@Entity()
export class FilterRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  name: string;

  @Column()
  conditionField: 'from' | 'to' | 'subject' | 'hasAttachment' | 'category';

  @Column()
  conditionOperator: 'contains' | 'equals' | 'startsWith';

  @Column()
  conditionValue: string;

  @Column()
  actionType: 'move' | 'label' | 'star' | 'markRead';

  @Column()
  actionValue: string;

  @Column({ default: true })
  isEnabled: boolean;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}
