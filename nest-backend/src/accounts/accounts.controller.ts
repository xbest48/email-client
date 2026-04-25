import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Inject, forwardRef } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { Account } from './account.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImapService } from '../email/imap/imap.service';

@UseGuards(JwtAuthGuard)
@Controller('api/accounts')
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    @Inject(forwardRef(() => ImapService))
    private readonly imapService: ImapService
  ) {}

  @Get()
  findAll(@Request() req: any): Promise<Account[]> {
    return this.accountsService.findAll(req.user.id);
  }

  @Post('test')
  async testConnection(@Body() credentials: any): Promise<{ success: boolean; message?: string }> {
    try {
      await this.imapService.listFolders({
        email: credentials.email,
        password: credentials.password,
        imapHost: credentials.imapHost,
        imapPort: credentials.imapPort,
        smtpHost: credentials.smtpHost,
        smtpPort: credentials.smtpPort,
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message || 'Connection failed' };
    }
  }

  @Post()
  create(@Request() req: any, @Body() account: Partial<Account>): Promise<Account> {
    return this.accountsService.create({ ...account, user: req.user.id } as any);
  }

  @Put(':id')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: Partial<Account>): Promise<Account | null> {
    return this.accountsService.update(id, req.user.id, body);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string): Promise<void> {
    return this.accountsService.remove(id, req.user.id);
  }
}
