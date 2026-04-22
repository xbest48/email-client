import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  NotFoundException,
  Headers,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { FiltersService } from './filters.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FilterRule } from './filter-rule.entity';
import { ImapService, EmailCredentials } from '../email/imap/imap.service';
import { AccountsService } from '../accounts/accounts.service';
import { AiService } from '../ai/ai.service';

@UseGuards(JwtAuthGuard)
@Controller('api/filters')
export class FiltersController {
  constructor(
    private readonly filtersService: FiltersService,
    @Inject(forwardRef(() => ImapService))
    private readonly imapService: ImapService,
    @Inject(forwardRef(() => AccountsService))
    private readonly accountsService: AccountsService,
    private readonly aiService: AiService,
  ) {}

  private async getCredentials(req: any, headers: any): Promise<EmailCredentials> {
    const accountId = headers['x-account-id'];
    if (!accountId) throw new BadRequestException('Missing x-account-id header');
    const account = await this.accountsService.findOneWithPassword(accountId, req.user.id);
    if (!account) throw new BadRequestException('Account not found');
    return {
      email: account.email,
      password: account.password,
      imapHost: account.imapHost,
      imapPort: account.imapPort,
      smtpHost: account.smtpHost,
      smtpPort: account.smtpPort,
    } as EmailCredentials;
  }

  @Get()
  findAll(@Request() req: any): Promise<FilterRule[]> {
    return this.filtersService.findAll(req.user.id);
  }

  @Post()
  create(@Request() req: any, @Body() body: Partial<FilterRule>): Promise<FilterRule> {
    return this.filtersService.create(req.user.id, body);
  }

  @Put(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: Partial<FilterRule>,
  ): Promise<FilterRule> {
    const rule = await this.filtersService.update(id, req.user.id, body);
    if (!rule) throw new NotFoundException('Filter rule not found');
    return rule;
  }

  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string): Promise<void> {
    return this.filtersService.remove(id, req.user.id);
  }

  @Post(':id/apply')
  async apply(
    @Request() req: any,
    @Param('id') id: string,
    @Headers() headers: any,
    @Body('folder') folder: string,
  ): Promise<{ applied: number }> {
    const rule = await this.filtersService.findOne(id, req.user.id);
    if (!rule) throw new NotFoundException('Filter rule not found');

    const creds = await this.getCredentials(req, headers);
    const targetFolder = folder || 'INBOX';

    // Fetch emails from the folder
    const result = await this.imapService.fetchEmails(creds, targetFolder, 1, 200);
    let applied = 0;

    for (const email of result.emails) {
      let matches = false;
      let fieldValue = '';

      switch (rule.conditionField) {
        case 'from':
          fieldValue = email.from?.email || email.from?.name || '';
          break;
        case 'to':
          fieldValue = (email.to || []).map((t: any) => t.email || t.name).join(', ');
          break;
        case 'subject':
          fieldValue = email.subject || '';
          break;
        case 'hasAttachment':
          fieldValue = email.hasAttachments ? 'true' : 'false';
          break;
        case 'category': {
          const content = [
            email.subject || '',
            email.snippet || '',
            email.from?.email || email.from?.name || '',
          ]
            .filter(Boolean)
            .join('\n\n');
          const category = await this.aiService.categorize(
            req.user.id,
            content,
            {
              messageId: email.messageId,
              folder: email.folder,
              uid: email.uid,
            },
            headers['x-account-id'],
          );
          fieldValue = category.category || 'Autre';
          break;
        }
      }

      switch (rule.conditionOperator) {
        case 'contains':
          matches = fieldValue.toLowerCase().includes(rule.conditionValue.toLowerCase());
          break;
        case 'equals':
          matches = fieldValue.toLowerCase() === rule.conditionValue.toLowerCase();
          break;
        case 'startsWith':
          matches = fieldValue.toLowerCase().startsWith(rule.conditionValue.toLowerCase());
          break;
      }

      if (matches) {
        try {
          switch (rule.actionType) {
            case 'move':
              await this.imapService.moveEmail(creds, targetFolder, email.uid, rule.actionValue);
              break;
            case 'star':
              await this.imapService.setFlag(creds, targetFolder, email.uid, '\\Flagged', true);
              break;
            case 'markRead':
              await this.imapService.setFlag(creds, targetFolder, email.uid, '\\Seen', true);
              break;
            case 'label':
              // Labels are treated as folders in IMAP - copy to the label folder
              await this.imapService.moveEmail(creds, targetFolder, email.uid, rule.actionValue);
              break;
          }
          applied++;
        } catch (e) {
          console.error(`Failed to apply filter action to email ${email.uid}`, e);
        }
      }
    }

    return { applied };
  }
}
