import { Entity, Column, PrimaryGeneratedColumn, Index, UpdateDateColumn } from 'typeorm';

/**
 * Per-(user, account) bookmark used by the push watcher to dedup notifications
 * across polling ticks. Stores the highest IMAP UID we have already pushed for
 * the inbox of that account; the next tick fetches strictly above it.
 *
 * We avoid storing this on the Account entity because the watcher should keep
 * working even if accounts get re-created (the row gets re-initialized on
 * first tick) and we don't want to pollute the user-facing account schema.
 */
@Entity()
@Index(['userId'])
@Index(['userId', 'accountId'], { unique: true })
export class InboxWatchState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  accountId: string;

  @Column({ type: 'integer', default: 0 })
  lastNotifiedUid: number;

  @Column({ type: 'text', nullable: true })
  inboxPath?: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
