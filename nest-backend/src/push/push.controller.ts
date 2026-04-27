import { Body, Controller, Delete, Get, Post, Request, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PushService } from './push.service';

interface SubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

interface UnsubscribeBody {
  endpoint: string;
}

@UseGuards(JwtAuthGuard)
@Controller('api/push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('vapid-public-key')
  getVapidPublicKey(): { publicKey: string } {
    const publicKey = this.push.getPublicKey();
    if (!publicKey) {
      throw new ServiceUnavailableException('Push notifications are not configured on the server.');
    }
    return { publicKey };
  }

  @Post('subscribe')
  async subscribe(@Request() req: any, @Body() body: SubscribeBody): Promise<{ ok: true }> {
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      throw new ServiceUnavailableException('Invalid subscription payload.');
    }
    await this.push.upsert(req.user.id, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: body.userAgent,
    });
    return { ok: true };
  }

  @Delete('subscribe')
  async unsubscribe(@Request() req: any, @Body() body: UnsubscribeBody): Promise<{ ok: true }> {
    if (body?.endpoint) {
      await this.push.removeByEndpoint(req.user.id, body.endpoint);
    }
    return { ok: true };
  }

  @Post('test')
  async test(@Request() req: any): Promise<{ sent: number; removed: number }> {
    return this.push.sendToUser(req.user.id, {
      title: 'KYMA Mail — Notification de test',
      body: 'Les notifications push fonctionnent correctement.',
      tag: 'kyma-push-test',
      data: { url: '/inbox' },
    });
  }
}
