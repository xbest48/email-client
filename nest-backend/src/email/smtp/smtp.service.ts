import { Injectable } from '@nestjs/common';
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

@Injectable()
export class SmtpService {
  private buildMailOptions(credentials: EmailCredentials, dto: SendEmailDto): nodemailer.SendMailOptions {
    const prepared = this.prepareInlineDataImages(dto.html, dto.attachments);

    const mailOptions: nodemailer.SendMailOptions = {
      from: dto.senderName ? `"${dto.senderName}" <${credentials.email}>` : credentials.email,
      to: dto.to || undefined,
      subject: dto.subject || '',
      text: dto.text,
      html: prepared.html,
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
    if (prepared.attachments.length) {
      mailOptions.attachments = prepared.attachments.map((attachment) => ({
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
    const rawMessage = await this.buildRawMessage(credentials, dto);

    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      rawMessage,
    };
  }

  private prepareInlineDataImages(
    html: string | undefined,
    attachments: SendEmailDto['attachments'],
  ): { html: string | undefined; attachments: NonNullable<SendEmailDto['attachments']> } {
    const preparedAttachments = [...(attachments ?? [])];
    if (!html) {
      return { html, attachments: preparedAttachments };
    }

    const dataUrlCache = new Map<string, string>();
    let imageIndex = 0;

    const convertDataUrl = (dataUrl: string): string | null => {
      // Strip any stray whitespace that survived normalization
      const trimmed = dataUrl.replace(/\s+/g, '');
      const cached = dataUrlCache.get(trimmed);
      if (cached) return cached;

      const inlineImage = this.dataUrlToInlineAttachment(trimmed, imageIndex);
      if (!inlineImage?.cid) return null;

      imageIndex += 1;
      dataUrlCache.set(trimmed, inlineImage.cid);
      preparedAttachments.push(inlineImage);
      return inlineImage.cid;
    };

    // Replace <img src="data:image/..."> — capture only the src value so we
    // don't need to re-match the rest of the tag (avoids issues with > inside
    // other attribute values).
    let updatedHtml = html.replace(
      /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:image\/[^"']+)\2/gi,
      (_match, prefix: string, quote: string, dataUrl: string) => {
        const cid = convertDataUrl(dataUrl);
        return cid ? `${prefix}${quote}cid:${cid}${quote}` : _match;
      },
    );

    // Also replace CSS url(data:image/...) — covers background-image and other
    // CSS properties that embed inline images (e.g. table cell backgrounds).
    updatedHtml = updatedHtml.replace(
      /(url\s*\(\s*)(["']?)(data:image\/[^"')]+)\2(\s*\))/gi,
      (_match, urlOpen: string, quote: string, dataUrl: string, urlClose: string) => {
        const cid = convertDataUrl(dataUrl);
        return cid ? `${urlOpen}${quote}cid:${cid}${quote}${urlClose}` : _match;
      },
    );

    return { html: updatedHtml, attachments: preparedAttachments };
  }

  private dataUrlToInlineAttachment(
    dataUrl: string,
    imageIndex: number,
  ): NonNullable<SendEmailDto['attachments']>[number] | null {
    // Use the 's' flag so '.' matches newlines in case any whitespace slipped through
    const match = dataUrl.match(/^data:([^;,]+)((?:;[^;,]+)*?)(?:,([\s\S]*))$/i);
    if (!match) return null;

    const mimeType = match[1];
    const metadata = match[2] ?? '';
    const payload = match[3] ?? '';
    const isBase64 = /;base64/i.test(metadata);

    let content: Buffer;
    try {
      if (isBase64) {
        content = Buffer.from(payload.replace(/\s+/g, ''), 'base64');
      } else {
        content = Buffer.from(decodeURIComponent(payload), 'utf8');
      }
    } catch {
      return null;
    }

    const extension = this.mimeTypeToExtension(mimeType);
    const cid = `inline-image-${Date.now()}-${imageIndex}@mailflow`;
    return {
      filename: `inline-image-${imageIndex + 1}.${extension}`,
      content,
      contentType: mimeType,
      cid,
    };
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
}
