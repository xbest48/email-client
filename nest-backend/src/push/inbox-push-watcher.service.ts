import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushService } from './push.service';
import { InboxWatchState } from './inbox-watch-state.entity';
import { AccountsService } from '../accounts/accounts.service';
import { UsersService } from '../users/users.service';
import { ImapService, EmailCredentials } from '../email/imap/imap.service';
import { User } from '../users/user.entity';
import { buildNewMailPayload } from './payload.util';
import { InboxIdleService } from './inbox-idle.service';

/**
 * Background poller. Every PUSH_POLL_INTERVAL_SECONDS the service:
 *   1. asks PushService for users that have at least one active subscription
 *   2. for each such user with `pushNotificationsEnabled = true`, polls every
 *      one of their IMAP accounts for inbox UIDs strictly greater than the
 *      stored `lastNotifiedUid`
 *   3. fans out a push per new message (capped to 5/account/tick) and bumps
 *      the bookmark
 *
 * On first sight of a (user, account) pair, the bookmark is initialised to
 * the current MAX(uid) without sending notifications, so users don't get
 * spammed when they enable the feature on a busy mailbox.
 */
@Injectable()
export class InboxPushWatcherService implements OnModuleInit, OnModuleDestroy {
  private static readonly DEFAULT_INTERVAL_SECONDS = 300;
  private static readonly MAX_PUSHES_PER_TICK = 5;

  private readonly logger = new Logger(InboxPushWatcherService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectRepository(InboxWatchState)
    private readonly states: Repository<InboxWatchState>,
    private readonly push: PushService,
    @Inject(forwardRef(() => AccountsService))
    private readonly accounts: AccountsService,
    @Inject(forwardRef(() => UsersService))
    private readonly users: UsersService,
    @Inject(forwardRef(() => ImapService))
    private readonly imap: ImapService,
    @Inject(forwardRef(() => InboxIdleService))
    private readonly idle: InboxIdleService,
  ) {}

  onModuleInit(): void {
    if (!this.push.isConfigured()) {
      this.logger.log('VAPID not configured; inbox push watcher will not start.');
      return;
    }
    const seconds = this.parseInterval();
    this.logger.log(`Inbox push watcher starting (interval=${seconds}s)`);
    this.intervalRef = setInterval(() => { void this.tick().catch((err) => this.logger.error('tick failed', err)); }, seconds * 1000);
    // First tick after a short delay so module init isn't blocked by IMAP I/O
    setTimeout(() => { void this.tick().catch((err) => this.logger.error('tick failed', err)); }, 10_000);
  }

  onModuleDestroy(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private parseInterval(): number {
    const raw = process.env.PUSH_POLL_INTERVAL_SECONDS;
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed < 30) {
      return InboxPushWatcherService.DEFAULT_INTERVAL_SECONDS;
    }
    return Math.floor(parsed);
  }

  async tick(): Promise<void> {
    if (!this.push.isConfigured()) return;

    const userIds = await this.push.listUserIdsWithSubscriptions();
    if (!userIds.length) return;

    for (const userId of userIds) {
      if (this.inFlight.has(userId)) continue;
      this.inFlight.add(userId);
      try {
        await this.tickUser(userId);
      } catch (err) {
        this.logger.warn(`tickUser failed for ${userId}: ${(err as Error).message}`);
      } finally {
        this.inFlight.delete(userId);
      }
    }
  }

  private async tickUser(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || !user.pushNotificationsEnabled) return;

    const accounts = await this.accounts.findAll(userId);
    if (!accounts.length) return;

    for (const accountSummary of accounts) {
      // If the IDLE watcher has a live connection for this account, skip —
      // it'll send pushes in (near) real time. The poller exists as the
      // fallback for IDLE-less servers, dropped connections, and bootstrap.
      if (this.idle.isWatching(userId, accountSummary.id)) continue;
      try {
        const account = await this.accounts.findOneWithPassword(accountSummary.id, userId);
        if (!account || (!account.password && !account.accessToken)) continue;

        const creds: EmailCredentials = {
          email: account.email,
          password: account.password,
          accessToken: account.accessToken,
          imapHost: account.imapHost,
          imapPort: account.imapPort,
          smtpHost: account.smtpHost,
          smtpPort: account.smtpPort,
        };

        await this.tickAccount(user, account.id, creds);
      } catch (err) {
        this.logger.warn(`tickAccount failed (user=${userId}, account=${accountSummary.id}): ${(err as Error).message}`);
      }
    }
  }

  private async tickAccount(user: User, accountId: string, creds: EmailCredentials): Promise<void> {
    let state = await this.states.findOne({ where: { userId: user.id, accountId } });

    const inboxPath = state?.inboxPath || (await this.imap.findInboxPath(creds));

    // Bootstrap: first time we see this (user, account), record the current
    // top UID without notifying. Otherwise the user gets a flood the first
    // time they enable the feature on a non-empty mailbox.
    if (!state) {
      const status = await this.imap.getFolderStatus(creds, inboxPath);
      const initial = await this.imap.fetchInboxEnvelopesSinceUid(creds, inboxPath, 0, 1);
      const initialUid = initial.length ? initial[initial.length - 1].uid : (status?.messages ?? 0);
      state = this.states.create({
        userId: user.id,
        accountId,
        lastNotifiedUid: initialUid,
        inboxPath,
      });
      await this.states.save(state);
      return;
    }

    const newMessages = await this.imap.fetchInboxEnvelopesSinceUid(
      creds,
      inboxPath,
      state.lastNotifiedUid,
      InboxPushWatcherService.MAX_PUSHES_PER_TICK,
    );
    if (!newMessages.length) {
      if (state.inboxPath !== inboxPath) {
        state.inboxPath = inboxPath;
        await this.states.save(state);
      }
      return;
    }

    for (const msg of newMessages) {
      const payload = buildNewMailPayload(user, accountId, msg, inboxPath);
      await this.push.sendToUser(user.id, payload);
    }

    state.lastNotifiedUid = Math.max(state.lastNotifiedUid, ...newMessages.map((m) => m.uid));
    state.inboxPath = inboxPath;
    await this.states.save(state);
  }
}
