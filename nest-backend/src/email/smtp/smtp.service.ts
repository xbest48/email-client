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
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  senderName?: string;
}

@Injectable()
export class SmtpService {
  async buildRawMessage(credentials: EmailCredentials, dto: SendEmailDto): Promise<Buffer | null> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: dto.senderName ? `"${dto.senderName}" <${credentials.email}>` : credentials.email,
      to: dto.to || undefined,
      subject: dto.subject || '',
      text: dto.text,
    };

    if (dto.cc) mailOptions.cc = dto.cc;
    if (dto.bcc) mailOptions.bcc = dto.bcc;
    if (dto.html) mailOptions.html = dto.html;
    if (dto.inReplyTo) mailOptions.inReplyTo = dto.inReplyTo;
    if (dto.references) mailOptions.references = dto.references;
    if (dto.requestReadReceipt) {
      mailOptions.headers = {
        ...((mailOptions.headers as any) || {}),
        'Disposition-Notification-To': credentials.email,
        'Return-Receipt-To': credentials.email,
      };
    }
    if (dto.attachments?.length) {
      mailOptions.attachments = dto.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      }));
    }

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

    const mailOptions: nodemailer.SendMailOptions = {
      from: dto.senderName ? `"${dto.senderName}" <${credentials.email}>` : credentials.email,
      to: dto.to,
      subject: dto.subject,
      text: dto.text,
    };

    if (dto.cc) mailOptions.cc = dto.cc;
    if (dto.bcc) mailOptions.bcc = dto.bcc;
    if (dto.html) mailOptions.html = dto.html;
    if (dto.inReplyTo) mailOptions.inReplyTo = dto.inReplyTo;
    if (dto.references) mailOptions.references = dto.references;
    if (dto.requestReadReceipt) {
      mailOptions.headers = {
        ...((mailOptions.headers as any) || {}),
        'Disposition-Notification-To': credentials.email,
        'Return-Receipt-To': credentials.email,
      };
    }
    if (dto.attachments?.length) {
      mailOptions.attachments = dto.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      }));
    }

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
