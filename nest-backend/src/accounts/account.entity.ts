import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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
