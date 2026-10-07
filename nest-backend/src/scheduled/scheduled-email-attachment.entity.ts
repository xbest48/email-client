import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, Index } from 'typeorm';
import { ScheduledEmail } from './scheduled-email.entity';
import { encryptedTextTransformer } from '../users/encrypted-column.transformer';
import { decryptBuffer, encryptBuffer } from '../users/crypto.util';

/**
 * Files attached to a scheduled email. Kept in their own table so listing
 * scheduled emails never loads multi-MB blobs; read only at send time.
 */
@Entity()
export class ScheduledEmailAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  scheduledEmailId: string;

  @ManyToOne(() => ScheduledEmail, { onDelete: 'CASCADE' })
  scheduledEmail: ScheduledEmail;

  @Column({ type: 'text', transformer: encryptedTextTransformer })
  filename: string;

  @Column()
  contentType: string;

  @Column({
    type: 'blob',
    transformer: {
      to: (value?: Buffer | null) => (value ? encryptBuffer(value) : value),
      from: (value?: Buffer | null) => (value ? decryptBuffer(value) : value),
    },
  })
  content: Buffer;
}
