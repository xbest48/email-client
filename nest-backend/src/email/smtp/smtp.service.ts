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
    try {
      return await this.compileRawMessage(this.buildMailOptions(credentials, dto));
    } catch {
      return null;
    }
  }

  private async compileRawMessage(mailOptions: nodemailer.SendMailOptions): Promise<Buffer> {
    const transporter = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    try {
      const info = await transporter.sendMail(mailOptions);
      return info.message as Buffer;
    } finally {
      transporter.close();
    }
  }

  private createSmtpTransport(credentials: EmailCredentials) {
    const port = credentials.smtpPort || 465;
    return nodemailer.createTransport({
      host: credentials.smtpHost,
      port,
      // Implicit TLS only on 465. Every other port (587, 25, 2525…) speaks
      // plain SMTP first and upgrades with STARTTLS — forcing `secure: true`
      // there makes the TLS handshake fail ("wrong version number").
      secure: port === 465,
      auth: this.buildSmtpAuth(credentials),
      // Without explicit timeouts a stalled server keeps the HTTP request
      // hanging until the proxy gives up, and the client never learns why.
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
      tls: {
        // SMTP_ALLOW_INVALID_CERTS=true keeps the previous permissive behaviour
        // (handy for self-signed dev servers). By default we now reject invalid
        // certificates, which is what anyone running against a real provider
        // wants.
        rejectUnauthorized: process.env.SMTP_ALLOW_INVALID_CERTS !== 'true',
      },
    });
  }

  async sendEmail(credentials: EmailCredentials, dto: SendEmailDto) {
    const mailOptions = this.buildMailOptions(credentials, dto);
    // Pin the Message-ID so the copy appended to "Sent" is the exact message
    // that went out (same Message-ID, same inline CIDs). Building the options
    // twice used to produce two different Message-IDs, breaking threading.
    const domain = credentials.email.split('@')[1] || 'localhost';
    mailOptions.messageId = `<${crypto.randomUUID()}@${domain}>`;

    const transporter = this.createSmtpTransport(credentials);
    let info: Awaited<ReturnType<typeof transporter.sendMail>>;
    try {
      info = await transporter.sendMail(mailOptions);
    } finally {
      transporter.close();
    }

    let rawMessage: Buffer | null = null;
    try {
      rawMessage = await this.compileRawMessage(mailOptions);
    } catch {
      // The message already left; failing to build the Sent copy is non-fatal.
    }

    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      rawMessage,
    };
  }

  async verifySmtp(credentials: EmailCredentials) {
    const transporter = this.createSmtpTransport(credentials);

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

  /**
   * Maps an image MIME type to a filename extension for CID attachments.
   * Falls back to the subtype after `image/`, or `png` when unknown.
   */
  private mimeTypeToExtension(mimeType: string): string {
    const normalized = (mimeType || '').toLowerCase().trim();
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/x-icon': 'ico',
      'image/vnd.microsoft.icon': 'ico',
      'image/tiff': 'tiff',
      'image/avif': 'avif',
      'image/heic': 'heic',
    };
    if (map[normalized]) return map[normalized];

    const subtype = normalized.split('/')[1];
    if (subtype) {
      // e.g. "svg+xml" -> "svg", strip any parameters/suffixes
      return subtype.split('+')[0].split(';')[0].trim() || 'png';
    }
    return 'png';
  }
}
