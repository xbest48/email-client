import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../users/user.entity';

@Entity()
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.accounts, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  email: string;

  @Column({ nullable: true })
  password?: string;

  @Column()
  imapHost: string;

  @Column()
  imapPort: number;

  @Column()
  smtpHost: string;

  @Column()
  smtpPort: number;
}
