import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../users/user.entity';

@Entity()
export class PgpKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column('text')
  publicKey: string;

  @Column('text')
  privateKey: string;

  @Column()
  fingerprint: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}

@Entity()
export class PgpContactKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  email: string;

  @Column('text')
  publicKey: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}
