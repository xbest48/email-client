import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as webPush from 'web-push';
import { PushSubscription } from './push-subscription.entity';

export interface PushNotificationPayload {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
}

/**
 * Wraps `web-push` and a per-user subscription store. Frontend uses Angular's
 * SwPush which expects payloads in the shape `{ notification: {...} }` so the
 * built-in ngsw service worker can render the system notification without a
 * custom SW.
 *
 * Stale subscriptions (404/410) are removed on first failure — browsers do not
 * recycle endpoints, so a gone endpoint is gone forever.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private vapidConfigured = false;

  constructor(
    @InjectRepository(PushSubscription)
    private readonly subscriptions: Repository<PushSubscription>,
  ) {}

  onModuleInit(): void {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;

    if (!publicKey || !privateKey || !subject) {
      this.logger.warn(
        'VAPID keys missing (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT). ' +
          'Web Push is disabled. Generate with: npx web-push generate-vapid-keys',
      );
      return;
    }

    try {
      webPush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidConfigured = true;
    } catch (err) {
      this.logger.error('Invalid VAPID configuration', err as Error);
    }
  }

  isConfigured(): boolean {
    return this.vapidConfigured;
  }

  getPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  async upsert(
    userId: string,
    data: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
  ): Promise<PushSubscription> {
    const existing = await this.subscriptions.findOne({ where: { endpoint: data.endpoint } });
    if (existing) {
      existing.userId = userId;
      existing.p256dh = data.p256dh;
      existing.auth = data.auth;
      existing.userAgent = data.userAgent;
      existing.lastSeenAt = new Date();
      return this.subscriptions.save(existing);
    }
    const created = this.subscriptions.create({
      userId,
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
      userAgent: data.userAgent,
      lastSeenAt: new Date(),
    });
    return this.subscriptions.save(created);
  }

  async removeByEndpoint(userId: string, endpoint: string): Promise<void> {
    await this.subscriptions.delete({ userId, endpoint });
  }

  async listForUser(userId: string): Promise<PushSubscription[]> {
    return this.subscriptions.find({ where: { userId } });
  }

  async listUserIdsWithSubscriptions(): Promise<string[]> {
    const rows = await this.subscriptions
      .createQueryBuilder('sub')
      .select('DISTINCT sub.userId', 'userId')
      .getRawMany<{ userId: string }>();
    return rows.map((r) => r.userId);
  }

  async sendToUser(userId: string, payload: PushNotificationPayload): Promise<{ sent: number; removed: number }> {
    if (!this.vapidConfigured) {
      this.logger.debug(`sendToUser skipped: VAPID not configured (user=${userId})`);
      return { sent: 0, removed: 0 };
    }

    const subs = await this.subscriptions.find({ where: { userId } });
    if (!subs.length) return { sent: 0, removed: 0 };

    const body = JSON.stringify({ notification: this.normalizePayload(payload) });
    const goneIds: string[] = [];
    let sent = 0;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webPush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            { TTL: 60 },
          );
          sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            goneIds.push(sub.id);
          } else {
            this.logger.warn(`Push failed (user=${userId}, status=${status}): ${(err as Error).message}`);
          }
        }
      }),
    );

    if (goneIds.length) {
      await this.subscriptions.delete({ id: In(goneIds) });
    }

    return { sent, removed: goneIds.length };
  }

  private normalizePayload(payload: PushNotificationPayload) {
    return {
      title: payload.title,
      body: payload.body ?? '',
      icon: payload.icon ?? '/favicon.png',
      badge: payload.badge ?? '/favicon.png',
      tag: payload.tag,
      data: payload.data ?? {},
      requireInteraction: !!payload.requireInteraction,
    };
  }
}
