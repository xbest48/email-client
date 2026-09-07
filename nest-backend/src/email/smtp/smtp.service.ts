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
    const { html: processedHtml, cidAttachments } = this.convertDataUrlsToCid(dto.html);
    const senderName = dto.senderName
      ? this.sanitizeHeaderValue(dto.senderName, 'senderName').replace(/"/g, '')
      : undefined;
    const subject = this.sanitizeHeaderValue(dto.subject || '', 'subject');

    const allAttachments = [...(dto.attachments ?? []), ...cidAttachments];

    const mailOptions: nodemailer.SendMailOptions = {
      from: senderName ? `"${senderName}" <${credentials.email}>` : credentials.email,
      to: this.sanitizeAddressList(dto.to, 'to') || undefined,
      subject,
      text: dto.text,
      html: processedHtml,
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
}
