import { Injectable, Inject, OnModuleInit, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { ScheduledEmail } from './scheduled-email.entity';
import { ScheduledEmailAttachment } from './scheduled-email-attachment.entity';
import { SmtpService } from '../email/smtp/smtp.service';
import { ImapService } from '../email/imap/imap.service';
import { AccountsService } from '../accounts/accounts.service';

@Injectable()
export class ScheduledService implements OnModuleInit {
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    @InjectRepository(ScheduledEmail)
    private readonly scheduledEmailRepository: Repository<ScheduledEmail>,
    @InjectRepository(ScheduledEmailAttachment)
    private readonly attachmentRepository: Repository<ScheduledEmailAttachment>,
    @Inject(forwardRef(() => SmtpService))
    private readonly smtpService: SmtpService,
    @Inject(forwardRef(() => ImapService))
    private readonly imapService: ImapService,
    @Inject(forwardRef(() => AccountsService))
    private readonly accountsService: AccountsService,
  ) {
    // Check for due emails every 30 seconds
    this.intervalRef = setInterval(() => void this.runTick(), 30_000);
  }

  /**
   * A row still 'sending' at boot means the process died mid-send: we can't
   * know whether the SMTP server accepted it. Retrying risks a duplicate, so
   * flag it as failed for the user to check instead of leaving it stuck.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.scheduledEmailRepository.update({ status: 'sending' }, { status: 'failed' });
    } catch (err) {
      console.error('Failed to recover interrupted scheduled emails', err);
    }
  }

  async findAll(userId: string): Promise<(ScheduledEmail & { attachmentCount: number })[]> {
    const emails = await this.scheduledEmailRepository.find({
      where: { userId },
      order: { scheduledAt: 'ASC' },
    });
    if (!emails.length) return [];
    // Count only: never load the blobs just to list scheduled emails.
    const counts: { id: string; count: string }[] = await this.attachmentRepository
      .createQueryBuilder('a')
      .select('a.scheduledEmailId', 'id')
      .addSelect('COUNT(*)', 'count')
      .where('a.scheduledEmailId IN (:...ids)', { ids: emails.map((e) => e.id) })
      .groupBy('a.scheduledEmailId')
      .getRawMany();
    const byId = new Map(counts.map((c) => [c.id, Number(c.count)]));
    return emails.map((e) => Object.assign(e, { attachmentCount: byId.get(e.id) ?? 0 }));
  }

  async create(
    userId: string,
    accountId: string,
    data: Partial<ScheduledEmail>,
    attachments: { filename: string; contentType: string; content: Buffer }[] = [],
  ): Promise<ScheduledEmail> {
    const scheduled = this.scheduledEmailRepository.create({
      ...data,
      userId,
      accountId,
      status: 'pending',
      user: { id: userId } as any,
    });
    const saved = await this.scheduledEmailRepository.save(scheduled);
    if (attachments.length) {
      try {
        await this.attachmentRepository.save(
          attachments.map((a) => this.attachmentRepository.create({ ...a, scheduledEmailId: saved.id })),
        );
      } catch (err) {
        // Never leave a scheduled email that would go out without its files.
        await this.scheduledEmailRepository.delete({ id: saved.id });
        throw err;
      }
    }
    return saved;
  }

  async remove(id: string, userId: string): Promise<void> {
    const result = await this.scheduledEmailRepository.delete({ id, userId, status: 'pending' });
    // SQLite only enforces ON DELETE CASCADE when foreign keys are enabled;
    // clean up explicitly so cancelled emails don't leave blobs behind.
    if (result.affected) await this.attachmentRepository.delete({ scheduledEmailId: id });
  }

  /**
   * A tick can outlast the 30 s interval (slow SMTP server, many due mails).
   * Without this guard the next tick re-read the same 'pending' rows and sent
   * them a second time.
   */
  private async runTick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.processDueEmails();
    } catch (err) {
      console.error('Scheduled email tick failed', err);
    } finally {
      this.processing = false;
    }
  }

  async processDueEmails(): Promise<void> {
    const dueEmails = await this.scheduledEmailRepository.find({
      where: {
        status: 'pending',
        scheduledAt: LessThanOrEqual(new Date()),
      },
    });

    for (const email of dueEmails) {
      // Claim the row atomically so it can never be picked up twice, even if
      // a second process runs against the same database.
      const claim = await this.scheduledEmailRepository.update(
        { id: email.id, status: 'pending' },
        { status: 'sending' },
      );
      if (!claim.affected) continue;

      try {
        const account = await this.accountsService.findOneWithPassword(email.accountId, email.userId);
        if (!account || (!account.password && !account.accessToken)) {
          email.status = 'failed';
          await this.scheduledEmailRepository.save(email);
          continue;
        }

        const creds = {
          email: account.email,
          password: account.password,
          accessToken: account.accessToken,
          imapHost: account.imapHost,
          imapPort: account.imapPort,
          smtpHost: account.smtpHost,
          smtpPort: account.smtpPort,
        };

        const attachments = await this.attachmentRepository.find({ where: { scheduledEmailId: email.id } });

        const result = await this.smtpService.sendEmail(creds, {
          to: email.to,
          subject: email.subject,
          html: email.body,
          cc: email.cc || undefined,
          bcc: email.bcc || undefined,
          senderName: account.displayName || undefined,
          attachments: attachments.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            content: a.content,
          })),
        });

        // Append to Sent folder
        if (result.rawMessage) {
          try {
            await this.imapService.appendToSentFolder(creds, result.rawMessage);
          } catch (err) {
            console.warn('Failed to append scheduled email to Sent folder', err);
          }
        }

        email.status = 'sent';
        await this.scheduledEmailRepository.save(email);
        // The files live on in the Sent folder; no need to keep a copy here.
        await this.attachmentRepository.delete({ scheduledEmailId: email.id });
      } catch (e) {
        console.error(`Failed to send scheduled email ${email.id}`, e);
        email.status = 'failed';
        await this.scheduledEmailRepository.save(email);
      }
    }
  }
}
