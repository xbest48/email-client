import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { ScheduledEmail } from './scheduled-email.entity';
import { SmtpService } from '../email/smtp/smtp.service';
import { ImapService } from '../email/imap/imap.service';
import { AccountsService } from '../accounts/accounts.service';

@Injectable()
export class ScheduledService {
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(ScheduledEmail)
    private readonly scheduledEmailRepository: Repository<ScheduledEmail>,
    @Inject(forwardRef(() => SmtpService))
    private readonly smtpService: SmtpService,
    @Inject(forwardRef(() => ImapService))
    private readonly imapService: ImapService,
    @Inject(forwardRef(() => AccountsService))
    private readonly accountsService: AccountsService,
  ) {
    // Check for due emails every 30 seconds
    this.intervalRef = setInterval(() => this.processDueEmails(), 30_000);
  }

  async findAll(userId: string): Promise<ScheduledEmail[]> {
    return this.scheduledEmailRepository.find({
      where: { userId },
      order: { scheduledAt: 'ASC' },
    });
  }

  async create(userId: string, accountId: string, data: Partial<ScheduledEmail>): Promise<ScheduledEmail> {
    const scheduled = this.scheduledEmailRepository.create({
      ...data,
      userId,
      accountId,
      status: 'pending',
      user: { id: userId } as any,
    });
    return this.scheduledEmailRepository.save(scheduled);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.scheduledEmailRepository.delete({ id, userId, status: 'pending' });
  }

  async processDueEmails(): Promise<void> {
    const dueEmails = await this.scheduledEmailRepository.find({
      where: {
        status: 'pending',
        scheduledAt: LessThanOrEqual(new Date()),
      },
    });

    for (const email of dueEmails) {
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

        const result = await this.smtpService.sendEmail(creds, {
          to: email.to,
          subject: email.subject,
          html: email.body,
          cc: email.cc || undefined,
          bcc: email.bcc || undefined,
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
      } catch (e) {
        console.error(`Failed to send scheduled email ${email.id}`, e);
        email.status = 'failed';
        await this.scheduledEmailRepository.save(email);
      }
    }
  }
}
