import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from '../users/user.entity';
import { encryptedTextTransformer } from '../users/encrypted-column.transformer';

@Entity()
export class PgpKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column('text', { transformer: encryptedTextTransformer })
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

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  email: string;

  @Column('text', { transformer: encryptedTextTransformer })
  publicKey: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}
