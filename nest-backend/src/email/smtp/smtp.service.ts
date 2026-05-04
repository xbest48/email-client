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
  private static readonly MAX_RECIPIENTS = 100;

  private buildSmtpAuth(credentials: EmailCredentials): any {
    if (credentials.accessToken) {
      return {
        type: 'OAuth2',
        user: credentials.email,
        accessToken: credentials.accessToken,
      };
    }
    return {
      user: credentials.email,
      pass: credentials.password,
    };
  }

  // Characters that would allow header injection if present in a header value.
  private static readonly HEADER_INJECTION_REGEX = /[\r\n\0]/;

  private sanitizeHeaderValue(value: string, field: string): string {
    if (typeof value !== 'string') return '';
    if (SmtpService.HEADER_INJECTION_REGEX.test(value)) {
      throw new Error(`Invalid characters in ${field}`);
    }
    return value;
  }

  private sanitizeAddressList(value: string | string[] | undefined, field: string): string | string[] | undefined {
    if (value === undefined) return undefined;
    const list = Array.isArray(value) ? value : [value];
    if (list.length > SmtpService.MAX_RECIPIENTS) {
      throw new Error(`Too many recipients in ${field}`);
    }
    const cleaned = list.map((addr) => this.sanitizeHeaderValue(String(addr), field));
    return Array.isArray(value) ? cleaned : cleaned[0];
  }

  private buildMailOptions(credentials: EmailCredentials, dto: SendEmailDto): nodemailer.SendMailOptions {
    const prepared = this.prepareInlineCssDataImages(dto.html, dto.attachments);
    const senderName = dto.senderName
      ? this.sanitizeHeaderValue(dto.senderName, 'senderName').replace(/"/g, '')
      : undefined;
    const subject = this.sanitizeHeaderValue(dto.subject || '', 'subject');

    const mailOptions: nodemailer.SendMailOptions = {
      from: senderName ? `"${senderName}" <${credentials.email}>` : credentials.email,
      to: this.sanitizeAddressList(dto.to, 'to') || undefined,
      subject,
      text: dto.text,
      html: prepared.html,
      attachDataUrls: true,
    };

    if (dto.cc) mailOptions.cc = this.sanitizeAddressList(dto.cc, 'cc');
    if (dto.bcc) mailOptions.bcc = this.sanitizeAddressList(dto.bcc, 'bcc');
    if (dto.inReplyTo) mailOptions.inReplyTo = this.sanitizeHeaderValue(String(dto.inReplyTo), 'inReplyTo');
    if (dto.references) {
      mailOptions.references = Array.isArray(dto.references)
        ? (this.sanitizeAddressList(dto.references, 'references') as string[])
        : this.sanitizeHeaderValue(String(dto.references), 'references');
    }
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
      const transporter = nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
      });
      const info = await transporter.sendMail(mailOptions);
      transporter.close();
      return info.message as Buffer;
    } catch {
      return null;
    }
  }

  private prepareInlineCssDataImages(
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

    const updatedHtml = html.replace(
      /(url\s*\(\s*)(["']?)(data:image\/[^"')]+)\2(\s*\))/gi,
      (match, urlOpen: string, quote: string, dataUrl: string, urlClose: string) => {
        const cid = convertDataUrl(dataUrl);
        return cid ? `${urlOpen}${quote}cid:${cid}${quote}${urlClose}` : match;
      },
    );

    return { html: updatedHtml, attachments: preparedAttachments };
  }

  private dataUrlToInlineAttachment(
    dataUrl: string,
    imageIndex: number,
  ): NonNullable<SendEmailDto['attachments']>[number] | null {
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

  async sendEmail(credentials: EmailCredentials, dto: SendEmailDto) {
    const transporter = nodemailer.createTransport({
      host: credentials.smtpHost,
      port: credentials.smtpPort || 465,
      secure: credentials.smtpPort === 587 ? false : true,
      auth: this.buildSmtpAuth(credentials),
      tls: {
        // SMTP_ALLOW_INVALID_CERTS=true keeps the previous permissive behaviour
        // (handy for self-signed dev servers). By default we now reject invalid
        // certificates, which is what anyone running against a real provider
        // wants.
        rejectUnauthorized: process.env.SMTP_ALLOW_INVALID_CERTS !== 'true',
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

  async verifySmtp(credentials: EmailCredentials) {
    const transporter = nodemailer.createTransport({
      host: credentials.smtpHost,
      port: credentials.smtpPort || 465,
      secure: credentials.smtpPort === 587 ? false : true,
      auth: this.buildSmtpAuth(credentials),
      tls: {
        // SMTP_ALLOW_INVALID_CERTS=true keeps the previous permissive behaviour
        // (handy for self-signed dev servers). By default we now reject invalid
        // certificates, which is what anyone running against a real provider
        // wants.
        rejectUnauthorized: process.env.SMTP_ALLOW_INVALID_CERTS !== 'true',
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
