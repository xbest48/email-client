import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../users/user.entity';

@Entity()
export class Contact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column({ default: 1 })
  frequency: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}
