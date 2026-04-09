import { Controller, Get, Post, Delete, Param, Query, Body, Headers, BadRequestException, UseGuards, Request, Inject, forwardRef, Res, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ImapService, EmailCredentials } from './imap/imap.service';
import type { SendEmailDto } from './smtp/smtp.service';
import { SmtpService } from './smtp/smtp.service';
import { AccountsService } from '../accounts/accounts.service';
import { ContactsService } from '../contacts/contacts.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api')
export class EmailController {
  constructor(
    private readonly imapService: ImapService,
    private readonly smtpService: SmtpService,
    @Inject(forwardRef(() => AccountsService))
    private readonly accountsService: AccountsService,
    private readonly contactsService: ContactsService,
    private readonly usersService: UsersService,
  ) {}

  private async getCredentials(req: any, headers: any): Promise<EmailCredentials> {
    const accountId = headers['x-account-id'];
    if (!accountId) throw new BadRequestException('Missing x-account-id header');

    // We must use findOneWithPassword internally to connect
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

  @Get('folders/:folder/archive')
  async downloadFolderArchive(
    @Request() req: any,
    @Headers() headers: any,
    @Param('folder') folder: string,
    @Res() res: Response,
  ) {
    const creds = await this.getCredentials(req, headers);
    const decodedFolder = decodeURIComponent(folder);
    const mbox = await this.imapService.exportFolderAsMbox(creds, decodedFolder);
    const safeName = (decodedFolder || 'dossier').replace(/[\\/:*?"<>|]+/g, '_');

    res.setHeader('Content-Type', 'application/mbox');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mbox"`);
    res.setHeader('Content-Length', String(mbox.length));
    res.end(mbox);
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
    let decodedFolder = decodeURIComponent(folder);

    // Map special frontend routes to actual IMAP folders if needed.
    const folderMap: Record<string, string> = {
      'inbox': 'INBOX',
    };

    if (folderMap[decodedFolder.toLowerCase()]) {
       decodedFolder = folderMap[decodedFolder.toLowerCase()];
    }

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

  @Delete('trash')
  async emptyTrash(@Request() req: any, @Headers() headers: any) {
    const creds = await this.getCredentials(req, headers);
    await this.imapService.emptyTrashFolder(creds);
    return { success: true };
  }

  @Get('email/:folder/:uid/attachment/:attachmentId')
  async getAttachment(
    @Request() req: any,
    @Headers() headers: any,
    @Param('folder') folder: string,
    @Param('uid') uid: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const creds = await this.getCredentials(req, headers);
    const attachment = await this.imapService.fetchAttachment(
      creds,
      decodeURIComponent(folder),
      parseInt(uid, 10),
      parseInt(attachmentId, 10),
    );
    if (!attachment) throw new BadRequestException('Attachment not found');
    res.setHeader('Content-Type', attachment.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
    res.send(attachment.content);
  }

  @Get('email/:folder/:uid/thread')
  async getThread(
    @Request() req: any,
    @Headers() headers: any,
    @Param('folder') folder: string,
    @Param('uid') uid: string,
  ) {
    const creds = await this.getCredentials(req, headers);
    return this.imapService.fetchThread(creds, decodeURIComponent(folder), parseInt(uid, 10));
  }

  @Post('send')
  @UseInterceptors(FilesInterceptor('files', 20, {
    limits: {
      fieldSize: 25 * 1024 * 1024,
      fileSize: 25 * 1024 * 1024,
    },
  }))
  async sendEmail(@Request() req: any, @Headers() headers: any, @Body() dto: SendEmailDto, @UploadedFiles() files?: Express.Multer.File[]) {
    const creds = await this.getCredentials(req, headers);

    // Set sender display name from account
    if (!dto.senderName) {
      const accountId = headers['x-account-id'];
      if (accountId) {
        const account = await this.accountsService.findOne(accountId, req.user.id);
        if (account?.displayName) {
          dto.senderName = account.displayName;
        }
      }
    }

    // Map uploaded files to attachment DTO format
    if (files?.length) {
      dto.attachments = files.map((f) => ({
        filename: f.originalname,
        content: f.buffer,
        contentType: f.mimetype,
      }));
    }

    // Handle multipart string 'true' for requestReadReceipt
    if ((dto.requestReadReceipt as any) === 'true') {
      dto.requestReadReceipt = true;
    }

    const result = await this.smtpService.sendEmail(creds, dto);

    // Append sent message to IMAP Sent folder
    if (result.rawMessage) {
      try {
        await this.imapService.appendToSentFolder(creds, result.rawMessage);
      } catch (err) {
        console.warn('Failed to append message to Sent folder', err);
      }
    }

    // Save contacts from recipients for autocomplete
    try {
      const toAddrs = Array.isArray(dto.to) ? dto.to : [dto.to];
      const ccAddrs = dto.cc ? (Array.isArray(dto.cc) ? dto.cc : [dto.cc]) : [];
      const bccAddrs = dto.bcc ? (Array.isArray(dto.bcc) ? dto.bcc : [dto.bcc]) : [];
      const allAddrs = [...toAddrs, ...ccAddrs, ...bccAddrs].map((email) => ({ name: email, email }));
      await this.contactsService.upsertFromSend(req.user.id, allAddrs);
    } catch {
      // Non-critical: don't fail the send if contact save fails
    }

    return {
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
    };
  }

  @Post('draft')
  async saveDraft(@Request() req: any, @Headers() headers: any, @Body() dto: SendEmailDto & { previousFolder?: string; previousUid?: number }) {
    const creds = await this.getCredentials(req, headers);

    if (!dto.senderName) {
      const accountId = headers['x-account-id'];
      if (accountId) {
        const account = await this.accountsService.findOne(accountId, req.user.id);
        if (account?.displayName) {
          dto.senderName = account.displayName;
        }
      }
    }

    const rawMessage = await this.smtpService.buildRawMessage(creds, dto);
    if (!rawMessage) {
      throw new BadRequestException('Failed to build draft message');
    }

    return this.imapService.appendToDraftsFolder(
      creds,
      rawMessage,
      dto.previousFolder,
      dto.previousUid ? Number(dto.previousUid) : undefined,
    );
  }

  @Delete('draft/:folder/:uid')
  async deleteDraft(
    @Request() req: any,
    @Headers() headers: any,
    @Param('folder') folder: string,
    @Param('uid') uid: string,
  ) {
    const creds = await this.getCredentials(req, headers);
    await this.imapService.deleteEmail(creds, decodeURIComponent(folder), parseInt(uid, 10));
    return { success: true };
  }
}
