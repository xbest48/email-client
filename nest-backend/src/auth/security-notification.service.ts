import { Injectable, Logger } from '@nestjs/common';
import { AccountsService } from '../accounts/accounts.service';
import { SmtpService } from '../email/smtp/smtp.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';

export interface DeviceContext {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Sends security notifications (currently: "new login from unknown device").
 * Uses the user's own SMTP account because MailFlow has no server-side
 * transactional mailer. If the user has no account yet we silently skip.
 */
@Injectable()
export class SecurityNotificationService {
  private readonly logger = new Logger(SecurityNotificationService.name);

  constructor(
    private usersService: UsersService,
    private accountsService: AccountsService,
    private smtpService: SmtpService,
  ) {}

  /**
   * Returns true if the device signature (normalized UA + coarse IP prefix)
   * has been seen on any prior session for this user. Brand-new users with
   * exactly one session (the one we're about to create) count as "new device"
   * only if we have an SMTP account to notify — see notifyIfNewDevice.
   */
  async isKnownDevice(
    userId: string,
    context: DeviceContext,
    excludeSessionId?: string,
  ): Promise<boolean> {
    if (!context.userAgent && !context.ipAddress) {
      // Nothing to fingerprint against → don't spam the user.
      return true;
    }
    const signature = this.signatureFor(context);
    const sessions = await this.usersService.findAllAuthSessionsByUser(userId);
    return sessions.some(
      (s) => s.id !== excludeSessionId && this.signatureFor(s) === signature,
    );
  }

  /**
   * Fire-and-forget notification. Deliberately never throws and never blocks
   * login: a failing SMTP must not prevent the user from signing in.
   */
  notifyIfNewDevice(
    user: User,
    context: DeviceContext,
    excludeSessionId?: string,
  ): void {
    setImmediate(() => {
      this.runNotification(user, context, excludeSessionId).catch((err) => {
        this.logger.warn(
          `New-device notification for user ${user.id} failed: ${(err as Error)?.message ?? err}`,
        );
      });
    });
  }

  private async runNotification(
    user: User,
    context: DeviceContext,
    excludeSessionId?: string,
  ): Promise<void> {
    const alreadyKnown = await this.isKnownDevice(user.id, context, excludeSessionId);
    if (alreadyKnown) return;

    const accounts = await this.accountsService.findAll(user.id);
    if (!accounts.length) {
      this.logger.log(
        `User ${user.id} logged in from a new device but has no email account configured — skipping notification.`,
      );
      return;
    }

    const account = await this.accountsService.findOneWithPassword(accounts[0].id, user.id);
    if (!account || !account.password) {
      this.logger.warn(
        `User ${user.id} has accounts but no readable SMTP password — cannot send new-device notification.`,
      );
      return;
    }

    const { html, text } = this.buildMessage(context);

    await this.smtpService.sendEmail(
      {
        email: account.email,
        password: account.password,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        imapHost: account.imapHost,
        imapPort: account.imapPort,
      },
      {
        to: user.email,
        subject: 'Nouvelle connexion à votre compte MailFlow',
        text,
        html,
        senderName: 'MailFlow Security',
      },
    );

    this.logger.log(`New-device login notification sent to user ${user.id} (${user.email}).`);
  }

  private signatureFor(input: DeviceContext): string {
    const ua = this.normalizeUserAgent(input.userAgent);
    const ipPrefix = this.normalizeIpPrefix(input.ipAddress);
    return `${ua}|${ipPrefix}`;
  }

  private normalizeUserAgent(ua?: string | null): string {
    return (ua ?? '').trim().toLowerCase().slice(0, 256);
  }

  /**
   * Reduces IPv4 to /24 and IPv6 to /64. Carrier-grade NAT and DHCP rotations
   * typically stay inside those ranges, so we avoid alerting every time a
   * mobile ISP bumps the last octet.
   */
  private normalizeIpPrefix(ip?: string | null): string {
    if (!ip) return '';
    const clean = ip.trim();
    if (!clean) return '';

    if (clean.includes(':')) {
      const parts = clean.split(':').filter(Boolean);
      return parts.slice(0, 4).join(':');
    }

    const octets = clean.split('.');
    if (octets.length === 4) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
    }
    return clean;
  }

  private maskIp(ip?: string): string {
    if (!ip) return 'inconnue';
    const clean = ip.trim();
    if (!clean) return 'inconnue';

    if (clean.includes(':')) {
      const parts = clean.split(':').filter(Boolean);
      return parts.slice(0, 4).join(':') + '::xxxx';
    }

    const octets = clean.split('.');
    if (octets.length === 4) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.xxx`;
    }
    return clean;
  }

  private buildMessage(context: DeviceContext): { html: string; text: string } {
    const date = new Date().toLocaleString('fr-FR', {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const userAgent = context.userAgent?.trim() || 'inconnu';
    const ip = this.maskIp(context.ipAddress);

    const text =
      'Bonjour,\n\n' +
      "Une connexion à votre compte MailFlow vient d'être effectuée depuis un appareil que nous ne reconnaissons pas.\n\n" +
      `Date : ${date}\n` +
      `Navigateur / appareil : ${userAgent}\n` +
      `Adresse IP : ${ip}\n\n` +
      "Si c'était vous, aucune action n'est nécessaire.\n" +
      "Si ce n'était PAS vous, changez immédiatement votre mot de passe et révoquez cette session depuis :\n" +
      '  Paramètres → Sécurité → Appareils connectés.\n\n' +
      "— L'équipe MailFlow";

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: auto; color: #222;">
        <h2 style="margin: 0 0 16px;">Nouvelle connexion détectée</h2>
        <p>Bonjour,</p>
        <p>Une connexion à votre compte MailFlow vient d'être effectuée depuis un appareil que nous ne reconnaissons pas.</p>
        <table style="border-collapse: collapse; margin: 12px 0;">
          <tr><td style="padding: 4px 8px; color:#666;">Date</td><td style="padding: 4px 8px;"><strong>${this.escape(date)}</strong></td></tr>
          <tr><td style="padding: 4px 8px; color:#666;">Navigateur / appareil</td><td style="padding: 4px 8px;"><strong>${this.escape(userAgent)}</strong></td></tr>
          <tr><td style="padding: 4px 8px; color:#666;">Adresse IP</td><td style="padding: 4px 8px;"><strong>${this.escape(ip)}</strong></td></tr>
        </table>
        <p>Si c'était vous, aucune action n'est nécessaire.</p>
        <p style="background:#fff4f4; border-left:4px solid #d33; padding:12px 14px;">
          Si ce n'était <strong>pas</strong> vous, changez immédiatement votre mot de passe et révoquez cette session depuis
          <em>Paramètres → Sécurité → Appareils connectés</em>.
        </p>
        <p style="color:#888; font-size: 0.85em; margin-top: 24px;">— L'équipe MailFlow</p>
      </div>
    `;

    return { html, text };
  }

  private escape(s: string): string {
    return s.replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return ch;
      }
    });
  }
}
