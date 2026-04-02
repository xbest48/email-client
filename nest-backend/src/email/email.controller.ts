import { Controller, Get, Post, Delete, Param, Query, Body, Headers, BadRequestException, UseGuards, Request } from '@nestjs/common';
import { ImapService, EmailCredentials } from './imap/imap.service';
import type { SendEmailDto } from './smtp/smtp.service';
import { SmtpService } from './smtp/smtp.service';
import { AccountsService } from '../accounts/accounts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api')
export class EmailController {
  constructor(
    private readonly imapService: ImapService,
    private readonly smtpService: SmtpService,
    private readonly accountsService: AccountsService,
  ) {}

  private async getCredentials(req: any, headers: any): Promise<EmailCredentials> {
    const accountId = headers['x-account-id'];
    if (!accountId) throw new BadRequestException('Missing x-account-id header');

    const account = await this.accountsService.findOne(accountId, req.user.id);
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

  @Get('folders')
  async getFolders(@Request() req: any, @Headers() headers: any) {
    const creds = await this.getCredentials(req, headers);
    return this.imapService.listFolders(creds);
  }

  @Get('folders/:folder/status')
  async getFolderStatus(@Request() req: any, @Headers() headers: any, @Param('folder') folder: string) {
    const creds = await this.getCredentials(req, headers);
    return this.imapService.getFolderStatus(creds, decodeURIComponent(folder));
  }

  @Post('folders')
  async createFolder(@Request() req: any, @Headers() headers: any, @Body('name') name: string) {
    const creds = await this.getCredentials(req, headers);
    await this.imapService.createFolder(creds, name);
    return { success: true };
  }

  @Delete('folders/:folder')
  async deleteFolder(@Request() req: any, @Headers() headers: any, @Param('folder') folder: string) {
    const creds = await this.getCredentials(req, headers);
    await this.imapService.deleteFolder(creds, decodeURIComponent(folder));
    return { success: true };
  }

  @Get('emails/:folder')
  async getEmails(
    @Request() req: any,
    @Headers() headers: any,
    @Param('folder') folder: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
  ) {
    const creds = await this.getCredentials(req, headers);
    const decodedFolder = decodeURIComponent(folder);
    const pageNum = parseInt(page || '1', 10);
    const sizeNum = parseInt(pageSize || '25', 10);

    if (q) {
      return this.imapService.searchEmails(creds, decodedFolder, q);
    }
    return this.imapService.fetchEmails(creds, decodedFolder, pageNum, sizeNum);
  }

  @Get('email/:folder/:uid')
  async getEmail(
    @Request() req: any,
    @Headers() headers: any,
    @Param('folder') folder: string,
    @Param('uid') uid: string,
  ) {
    const creds = await this.getCredentials(req, headers);
    return this.imapService.fetchEmail(creds, decodeURIComponent(folder), parseInt(uid, 10));
  }

  @Post('email/:folder/:uid/flag')
  async setFlag(
    @Request() req: any,
    @Headers() headers: any,
    @Param('folder') folder: string,
    @Param('uid') uid: string,
    @Body('flag') flag: string,
    @Body('value') value: boolean,
  ) {
    const creds = await this.getCredentials(req, headers);
    await this.imapService.setFlag(creds, decodeURIComponent(folder), parseInt(uid, 10), flag, value);
    return { success: true };
  }

  @Post('email/:folder/:uid/move')
  async moveEmail(
    @Request() req: any,
    @Headers() headers: any,
    @Param('folder') folder: string,
    @Param('uid') uid: string,
    @Body('destination') destination: string,
  ) {
    const creds = await this.getCredentials(req, headers);
    await this.imapService.moveEmail(creds, decodeURIComponent(folder), parseInt(uid, 10), destination);
    return { success: true };
  }

  @Delete('email/:folder/:uid')
  async deleteEmail(
    @Request() req: any,
    @Headers() headers: any,
    @Param('folder') folder: string,
    @Param('uid') uid: string,
    @Query('trash') trash?: string,
  ) {
    const creds = await this.getCredentials(req, headers);
    await this.imapService.deleteEmail(creds, decodeURIComponent(folder), parseInt(uid, 10), trash);
    return { success: true };
  }

  @Post('send')
  async sendEmail(@Request() req: any, @Headers() headers: any, @Body() dto: SendEmailDto) {
    const creds = await this.getCredentials(req, headers);
    return this.smtpService.sendEmail(creds, dto);
  }
}
