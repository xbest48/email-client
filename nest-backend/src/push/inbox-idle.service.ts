import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImapFlow } from 'imapflow';
import { PushService } from './push.service';
import { InboxWatchState } from './inbox-watch-state.entity';
import { AccountsService } from '../accounts/accounts.service';
import { UsersService } from '../users/users.service';
import { EmailCredentials } from '../email/imap/imap.service';
import { User } from '../users/user.entity';
import { buildNewMailPayload } from './payload.util';

interface IdleConnection {
  userId: string;
  accountId: string;
  email: string;
  client: ImapFlow | null;
  healthy: boolean;
  closing: boolean;
  inboxPath: string;
  reconnectAttempts: number;
  inFlight: boolean;
  loopPromise: Promise<void> | null;
}

/**
 * Maintains long-lived IMAP IDLE connections per (user, account) so the
 * server pushes new-mail events to us in (near) real time instead of us
 * polling every N minutes.
 *
 * Design:
 *   - A supervisor tick (every 60s) reconciles the live connection map with
 *     the desired set (users with push enabled + a stored subscription, *
 *     each user's IMAP accounts). It opens new connections and stops stale
 *     ones.
 *   - Each connection runs a self-healing loop: connect -> SELECT INBOX ->
 *     bootstrap state -> register `exists` listener -> idle(). On drop,
 *     reconnect with exponential backoff.
 *   - The fallback poller (`InboxPushWatcherService`) skips any account
 *     where this service has a healthy connection, so we never double-push.
 *     If IDLE drops, the next poll picks up the gap.
 *   - imapflow's `maxIdleTime` (set to 25 min) sends DONE/IDLE before NAT
 *     and Gmail's 29-minute idle cutoffs disconnect us.
 */
@Injectable()
export class InboxIdleService implements OnModuleInit, OnModuleDestroy {
  private static readonly SUPERVISOR_INTERVAL_MS = 60_000;
  private static readonly MAX_PUSHES_PER_EVENT = 10;
  private static readonly MAX_RECONNECT_BACKOFF_MS = 5 * 60_000;
  private static readonly INITIAL_RECONNECT_BACKOFF_MS = 5_000;
  private static readonly MAX_IDLE_MS = 25 * 60_000;

  private readonly logger = new Logger(InboxIdleService.name);
  private readonly connections = new Map<string, IdleConnection>();
  private supervisorRef: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(
    @InjectRepository(InboxWatchState)
    private readonly states: Repository<InboxWatchState>,
    private readonly push: PushService,
    @Inject(forwardRef(() => AccountsService))
    private readonly accounts: AccountsService,
    @Inject(forwardRef(() => UsersService))
    private readonly users: UsersService,
  ) {}

  onModuleInit(): void {
    if (!this.push.isConfigured()) {
      this.logger.log('VAPID not configured; IDLE watcher disabled.');
      return;
    }
    if (process.env.PUSH_DISABLE_IDLE === 'true') {
      this.logger.log('PUSH_DISABLE_IDLE=true; IDLE watcher disabled (poller-only mode).');
      return;
    }
    this.logger.log('Inbox IDLE watcher starting');
    setTimeout(() => { void this.syncConnections(); }, 15_000);
    this.supervisorRef = setInterval(
      () => { void this.syncConnections(); },
      InboxIdleService.SUPERVISOR_INTERVAL_MS,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.supervisorRef) {
      clearInterval(this.supervisorRef);
      this.supervisorRef = null;
    }
    await Promise.allSettled(
      Array.from(this.connections.values()).map((c) => this.stopConnection(c)),
    );
    this.connections.clear();
  }

  /** Used by the fallback poller to skip accounts already covered by IDLE. */
  isWatching(userId: string, accountId: string): boolean {
    return !!this.connections.get(this.key(userId, accountId))?.healthy;
  }

  private key(userId: string, accountId: string): string {
    return `${userId}:${accountId}`;
  }

  private async syncConnections(): Promise<void> {
    if (this.destroyed) return;

    type Desired = { user: User; accountId: string; creds: EmailCredentials };
    const desired = new Map<string, Desired>();

    try {
      const userIds = await this.push.listUserIdsWithSubscriptions();
      for (const userId of userIds) {
        const user = await this.users.findById(userId);
        if (!user || !user.pushNotificationsEnabled) continue;
        const list = await this.accounts.findAll(userId);
        for (const summary of list) {
          try {
            const account = await this.accounts.findOneWithPassword(summary.id, userId);
            if (!account?.password) continue;
            desired.set(this.key(userId, summary.id), {
              user,
              accountId: summary.id,
              creds: {
                email: account.email,
                password: account.password,
                imapHost: account.imapHost,
                imapPort: account.imapPort,
                smtpHost: account.smtpHost,
                smtpPort: account.smtpPort,
              },
            });
          } catch (err) {
            this.logger.warn(
              `account fetch failed (user=${userId}, account=${summary.id}): ${(err as Error).message}`,
            );
          }
        }
      }
    } catch (err) {
      this.logger.warn(`syncConnections enumeration failed: ${(err as Error).message}`);
      return;
    }

    // Stop stale connections (user disabled push, account deleted, etc.)
    for (const [k, conn] of Array.from(this.connections.entries())) {
      if (!desired.has(k)) {
        this.logger.log(`stopping IDLE connection (no longer desired): ${conn.email}`);
        await this.stopConnection(conn);
        this.connections.delete(k);
      }
    }

    // Start missing connections.
    for (const [k, info] of desired.entries()) {
      if (this.connections.has(k)) continue;
      const conn: IdleConnection = {
        userId: info.user.id,
        accountId: info.accountId,
        email: info.creds.email,
        client: null,
        healthy: false,
        closing: false,
        inboxPath: 'INBOX',
        reconnectAttempts: 0,
        inFlight: false,
        loopPromise: null,
      };
      this.connections.set(k, conn);
      conn.loopPromise = this.runConnectionLoop(conn, info.creds, info.user);
    }
  }

  private async stopConnection(conn: IdleConnection): Promise<void> {
    conn.closing = true;
    conn.healthy = false;
    if (conn.client) {
      try {
        if (conn.client.usable) await conn.client.logout();
      } catch { /* ignore */ }
      try { conn.client.close(); } catch { /* ignore */ }
    }
    if (conn.loopPromise) await conn.loopPromise.catch(() => {});
  }

  private async runConnectionLoop(
    conn: IdleConnection,
    creds: EmailCredentials,
    user: User,
  ): Promise<void> {
    while (!conn.closing && !this.destroyed) {
      try {
        await this.runOnce(conn, creds, user);
      } catch (err) {
        this.logger.warn(`IDLE loop error (${conn.email}): ${(err as Error).message}`);
      }
      conn.healthy = false;
      conn.client = null;
      if (conn.closing || this.destroyed) break;

      const backoff = Math.min(
        InboxIdleService.MAX_RECONNECT_BACKOFF_MS,
        InboxIdleService.INITIAL_RECONNECT_BACKOFF_MS * Math.pow(2, conn.reconnectAttempts),
      );
      conn.reconnectAttempts++;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  private async runOnce(
    conn: IdleConnection,
    creds: EmailCredentials,
    user: User,
  ): Promise<void> {
    const client = new ImapFlow({
      host: creds.imapHost,
      port: creds.imapPort,
      secure: creds.imapPort === 993,
      auth: { user: creds.email, pass: creds.password ?? '' },
      logger: false,
      maxIdleTime: InboxIdleService.MAX_IDLE_MS,
    });
    conn.client = client;

    client.on('error', (err: any) => {
      this.logger.warn(`client error (${conn.email}): ${err?.message ?? err}`);
    });

    await client.connect();

    const caps = (client as any).serverInfo?.capability ?? (client as any).capabilities;
    const capList: string[] = Array.isArray(caps)
      ? caps
      : caps && typeof caps === 'object'
        ? Object.keys(caps)
        : [];
    const hasIdle = capList.length === 0 || capList.some((c) => String(c).toUpperCase() === 'IDLE');
    if (!hasIdle) {
      this.logger.warn(`Server lacks IDLE capability (${conn.email}); leaving to poller.`);
      try { await client.logout(); } catch { /* ignore */ }
      conn.closing = true;
      return;
    }

    conn.inboxPath = await this.resolveInboxPath(client);
    await client.mailboxOpen(conn.inboxPath);

    await this.ensureState(conn, client);

    conn.healthy = true;
    conn.reconnectAttempts = 0;
    this.logger.log(
      `IDLE connected: user=${conn.userId} account=${conn.accountId} email=${conn.email} folder=${conn.inboxPath}`,
    );

    const onExists = () => {
      if (conn.inFlight) return;
      conn.inFlight = true;
      void (async () => {
        try {
          await this.processNewMail(conn, client, user);
        } catch (err) {
          this.logger.warn(`processNewMail failed (${conn.email}): ${(err as Error).message}`);
        } finally {
          conn.inFlight = false;
        }
      })();
    };
    client.on('exists', onExists);

    // imapflow's idle() resolves when the connection drops, errors, or is
    // closed. maxIdleTime triggers an internal DONE/IDLE renewal so a single
    // call holds for the whole session.
    try {
      await client.idle();
    } catch (err) {
      this.logger.warn(`idle() rejected (${conn.email}): ${(err as Error).message}`);
    }

    try { client.removeListener('exists', onExists as any); } catch { /* ignore */ }
    try { if (client.usable) await client.logout(); } catch { /* ignore */ }
  }

  private async resolveInboxPath(client: ImapFlow): Promise<string> {
    try {
      const folders = await client.list();
      const bySpecial = folders.find((f: any) => f.specialUse === '\\Inbox');
      if (bySpecial?.path) return bySpecial.path;
      const byName = folders.find(
        (f: any) => typeof f.path === 'string' && f.path.toLowerCase() === 'inbox',
      );
      if (byName?.path) return byName.path;
    } catch { /* ignore */ }
    return 'INBOX';
  }

  private async ensureState(conn: IdleConnection, client: ImapFlow): Promise<void> {
    let state = await this.states.findOne({
      where: { userId: conn.userId, accountId: conn.accountId },
    });
    if (state) {
      if (state.inboxPath !== conn.inboxPath) {
        state.inboxPath = conn.inboxPath;
        await this.states.save(state);
      }
      return;
    }
    // Bootstrap: record the current MAX(uid) without notifying so the user
    // doesn't get flooded the first time we attach to a busy mailbox.
    let maxUid = 0;
    try {
      const status = await client.status(conn.inboxPath, { uidNext: true });
      const uidNext = (status as any)?.uidNext as number | undefined;
      if (typeof uidNext === 'number' && uidNext > 1) {
        maxUid = uidNext - 1;
      }
    } catch { /* ignore — fall through with maxUid=0 */ }
    state = this.states.create({
      userId: conn.userId,
      accountId: conn.accountId,
      lastNotifiedUid: maxUid,
      inboxPath: conn.inboxPath,
    });
    await this.states.save(state);
  }

  private async processNewMail(
    conn: IdleConnection,
    client: ImapFlow,
    user: User,
  ): Promise<void> {
    const state = await this.states.findOne({
      where: { userId: conn.userId, accountId: conn.accountId },
    });
    if (!state) return;

    const since = state.lastNotifiedUid;
    const next = Math.max(since + 1, 1);
    const range = `${next}:*`;

    const newMsgs: Array<{ uid: number; from: string; fromName: string; subject: string }> = [];
    try {
      for await (const msg of client.fetch(range, { envelope: true, uid: true }, { uid: true })) {
        const uid = (msg as any).uid as number;
        if (typeof uid !== 'number' || uid <= since) continue;
        const env = (msg as any).envelope || {};
        const from = env.from?.[0] || {};
        newMsgs.push({
          uid,
          from: typeof from.address === 'string' ? from.address : '',
          fromName: typeof from.name === 'string' ? from.name : '',
          subject: typeof env.subject === 'string' ? env.subject : '',
        });
      }
    } catch (err) {
      this.logger.warn(`fetch failed (${conn.email}): ${(err as Error).message}`);
      return;
    }

    if (!newMsgs.length) return;

    newMsgs.sort((a, b) => a.uid - b.uid);
    const capped = newMsgs.slice(0, InboxIdleService.MAX_PUSHES_PER_EVENT);

    for (const msg of capped) {
      const payload = buildNewMailPayload(user, conn.accountId, msg, conn.inboxPath);
      await this.push.sendToUser(user.id, payload);
    }

    state.lastNotifiedUid = Math.max(state.lastNotifiedUid, ...newMsgs.map((m) => m.uid));
    state.inboxPath = conn.inboxPath;
    await this.states.save(state);
  }
}
