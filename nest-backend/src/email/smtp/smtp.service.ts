import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { EmailCredentials } from '../imap/imap.service';

export interface SendEmailDto {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string | string[];
  requestReadReceipt?: boolean;
  attachments?: { filename: string; content: Buffer; contentType: string; cid?: string }[];
  senderName?: string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const replaceBase64Images: (html: string, getCid: (mimeType: string, base64: string) => string) => string =
  require('nodemailer-plugin-inline-base64/src/replaceBase64Images');

@Injectable()
export class SmtpService {
  private buildMailOptions(credentials: EmailCredentials, dto: SendEmailDto): nodemailer.SendMailOptions {
    const { html: processedHtml, cidAttachments } = this.convertDataUrlsToCid(dto.html);

    const allAttachments = [...(dto.attachments ?? []), ...cidAttachments];

    const mailOptions: nodemailer.SendMailOptions = {
      from: dto.senderName ? `"${dto.senderName}" <${credentials.email}>` : credentials.email,
      to: dto.to || undefined,
      subject: dto.subject || '',
      text: dto.text,
      html: processedHtml,
    };

    if (dto.cc) mailOptions.cc = dto.cc;
    if (dto.bcc) mailOptions.bcc = dto.bcc;
    if (dto.inReplyTo) mailOptions.inReplyTo = dto.inReplyTo;
    if (dto.references) mailOptions.references = dto.references;
    if (dto.requestReadReceipt) {
      mailOptions.headers = {
        ...((mailOptions.headers as any) || {}),
        'Disposition-Notification-To': credentials.email,
        'Return-Receipt-To': credentials.email,
      };
    }
    if (allAttachments.length) {
      mailOptions.attachments = allAttachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
        cid: attachment.cid,
        contentDisposition: attachment.cid ? 'inline' : 'attachment',
      }));
    }

    return mailOptions;
  }

  async buildRawMessage(credentials: EmailCredentials, dto: SendEmailDto): Promise<Buffer | null> {
    const mailOptions = this.buildMailOptions(credentials, dto);

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const MailComposer = require('nodemailer/lib/mail-composer');
      const composer = new MailComposer(mailOptions);
      return await new Promise<Buffer>((resolve, reject) => {
        composer.compile().build((err: any, message: Buffer) => {
          if (err) return reject(err);
          resolve(message);
        });
      });
    } catch {
      return null;
    }
  }

  async sendEmail(credentials: EmailCredentials, dto: SendEmailDto) {
    const transporter = nodemailer.createTransport({
      host: credentials.smtpHost,
      port: credentials.smtpPort || 465,
      secure: credentials.smtpPort === 587 ? false : true,
      auth: {
        user: credentials.email,
        pass: credentials.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    const mailOptions = this.buildMailOptions(credentials, dto);

    const info = await transporter.sendMail(mailOptions);
    transporter.close();

    // Build raw RFC822 message for IMAP Sent folder append
    // Re-use the same already-converted mailOptions via buildRawMessage
    const rawMessage = await this.buildRawMessage(credentials, dto);

    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      rawMessage,
    };
  }

  async verifySmtp(credentials: EmailCredentials) {
    const transporter = nodemailer.createTransport({
      host: credentials.smtpHost,
      port: credentials.smtpPort || 465,
      secure: credentials.smtpPort === 587 ? false : true,
      auth: {
        user: credentials.email,
        pass: credentials.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    try {
      await transporter.verify();
      return true;
    } finally {
      transporter.close();
    }
  }

  private convertDataUrlsToCid(html: string | undefined): {
    html: string | undefined;
    cidAttachments: Array<{ filename: string; content: Buffer; contentType: string; cid: string }>;
  } {
    if (!html) return { html, cidAttachments: [] };

    const cidByBase64 = new Map<string, string>();
    const cidAttachments: Array<{ filename: string; content: Buffer; contentType: string; cid: string }> = [];

    const getOrCreateCid = (mimeType: string, base64: string): string => {
      const stripped = base64.replace(/\s+/g, '');
      const existing = cidByBase64.get(stripped);
      if (existing) return existing;

      const cid = `img-${crypto.randomBytes(8).toString('hex')}@mailflow`;
      cidByBase64.set(stripped, cid);

      try {
        const content = Buffer.from(stripped, 'base64');
        cidAttachments.push({
          filename: `image.${this.mimeTypeToExtension(mimeType)}`,
          content,
          contentType: mimeType,
          cid,
        });
      } catch {
        // Malformed base64 — skip this attachment, leave original src in HTML
      }

      return cid;
    };

    const processedHtml = replaceBase64Images(html, getOrCreateCid);
    return { html: processedHtml, cidAttachments };
  }

  private mimeTypeToExtension(mimeType: string): string {
    const knownExtensions: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/x-icon': 'ico',
    };

    return knownExtensions[mimeType.toLowerCase()] ?? 'img';
  }
}
