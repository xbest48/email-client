import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface EmailCredentials {
  email: string;
  password?: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

@Injectable()
export class ImapService implements OnModuleDestroy {
  private connections = new Map<string, ImapFlow>();

  private getConnectionKey(credentials: EmailCredentials): string {
    return `${credentials.email}:${credentials.imapHost}:${credentials.imapPort}`;
  }

  async getConnection(credentials: EmailCredentials): Promise<ImapFlow> {
    const key = this.getConnectionKey(credentials);
    if (this.connections.has(key)) {
      const client = this.connections.get(key);
      if (client?.usable) return client;
      this.connections.delete(key);
    }

    const client = new ImapFlow({
      host: credentials.imapHost,
      port: credentials.imapPort || 993,
      secure: true,
      auth: {
        user: credentials.email,
        pass: credentials.password || '',
      },
      logger: false,
    });

    client.on('error', (err) => {
      console.warn(`ImapFlow background error for ${credentials.email}:`, err);
      // Remove the broken connection from the pool so a new one can be created next time
      this.connections.delete(key);
    });

    await client.connect();
    this.connections.set(key, client);
    return client;
  }

  async closeConnection(credentials: EmailCredentials): Promise<void> {
    const key = this.getConnectionKey(credentials);
    if (this.connections.has(key)) {
      const client = this.connections.get(key);
      try {
        await client?.logout();
      } catch {
        // ignore
      }
      this.connections.delete(key);
    }
  }

  async onModuleDestroy() {
    for (const [key, client] of this.connections.entries()) {
      try {
        await client.logout();
      } catch {
        // ignore
      }
    }
    this.connections.clear();
  }

  async listFolders(credentials: EmailCredentials) {
    const client = await this.getConnection(credentials);
    const folders = await client.list();
    return folders.map((f: any) => ({
      path: f.path,
      name: f.name,
      delimiter: f.delimiter,
      flags: Array.from(f.flags || []),
      specialUse: f.specialUse || null,
      listed: f.listed,
      subscribed: f.subscribed,
    }));
  }

  async getFolderStatus(credentials: EmailCredentials, folder: string) {
    const client = await this.getConnection(credentials);
    try {
      const status = await client.status(folder, {
        messages: true,
        unseen: true,
        recent: true,
      });
      return {
        path: folder,
        messages: status.messages,
        unseen: status.unseen,
        recent: status.recent,
      };
    } catch (err) {
      console.warn(`Failed to get status for ${folder}`, err);
      return {
        path: folder,
        messages: 0,
        unseen: 0,
        recent: 0,
      }
    }
  }

  async fetchEmails(credentials: EmailCredentials, folder: string, page = 1, pageSize = 25) {
    const client = await this.getConnection(credentials);

    let lock;
    try {
      lock = await client.getMailboxLock(folder);
    } catch (e) {
      console.warn(`Mailbox ${folder} does not exist, returning empty list`);
      return { emails: [], total: 0, page, pageSize };
    }

    try {
      const mailbox = client.mailbox as any;
      const total = mailbox?.exists || 0;
      if (total === 0) return { emails: [], total: 0, page, pageSize };

      const end = Math.max(total - (page - 1) * pageSize, 0);
      const start = Math.max(end - pageSize + 1, 1);

      if (end <= 0) return { emails: [], total, page, pageSize };

      const emails = [];
      for await (const msg of client.fetch(`${start}:${end}`, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        uid: true,
        size: true,
      })) {
        emails.push(this.formatEmailSummary(msg as any, folder));
      }

      emails.reverse();

      return { emails, total, page, pageSize };
    } finally {
      lock.release();
    }
  }

  async searchEmails(credentials: EmailCredentials, folder: string, query: string) {
    const client = await this.getConnection(credentials);
    let lock;
    try {
      lock = await client.getMailboxLock(folder);
    } catch (e) {
      return { emails: [], total: 0 };
    }

    try {
      const searchCriteria = this.buildSearchCriteria(query);
      const results: any = await client.search(searchCriteria, { uid: true });

      if (!results || results.length === 0) return { emails: [], total: 0 };

      const uids = results.slice(-50).reverse();
      const emails = [];

      for await (const msg of client.fetch(uids, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        uid: true,
        size: true,
      }, { uid: true })) {
        emails.push(this.formatEmailSummary(msg as any, folder));
      }

      emails.reverse();
      return { emails, total: results.length };
    } finally {
      lock.release();
    }
  }

  async fetchEmail(credentials: EmailCredentials, folder: string, uid: number) {
    const client = await this.getConnection(credentials);
    const lock = await client.getMailboxLock(folder);

    try {
      const msg: any = await client.fetchOne(uid, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        uid: true,
        size: true,
        source: true,
      }, { uid: true });

      const parsed = await simpleParser(msg.source);

      return {
        uid: msg.uid,
        folder,
        messageId: msg.envelope.messageId,
        subject: msg.envelope.subject || '(sans objet)',
        from: this.formatAddress(msg.envelope.from),
        to: this.formatAddresses(msg.envelope.to),
        cc: this.formatAddresses(msg.envelope.cc),
        bcc: this.formatAddresses(msg.envelope.bcc),
        date: msg.envelope.date ? msg.envelope.date.toISOString() : null,
        flags: Array.from(msg.flags || []),
        isRead: msg.flags?.has('\\Seen') || false,
        isStarred: msg.flags?.has('\\Flagged') || false,
        body: parsed.text || '',
        htmlBody: parsed.html || '',
        attachments: (parsed.attachments || []).map((att, i) => ({
          id: String(i),
          filename: att.filename || 'attachment',
          mimeType: att.contentType,
          size: att.size || 0,
        })),
        hasAttachments: (parsed.attachments || []).length > 0,
        size: msg.size,
        readReceiptRequested: !!(parsed.headers?.get('disposition-notification-to')),
        readReceiptTo: (parsed.headers?.get('disposition-notification-to') as string) || '',
      };
    } finally {
      lock.release();
    }
  }

  async fetchAttachment(
    credentials: EmailCredentials,
    folder: string,
    uid: number,
    attachmentIndex: number,
  ): Promise<{ filename: string; contentType: string; content: Buffer } | null> {
    const client = await this.getConnection(credentials);
    const lock = await client.getMailboxLock(folder);

    try {
      const msg: any = await client.fetchOne(
        uid,
        { source: true },
        { uid: true },
      );
      const parsed = await simpleParser(msg.source);
      const att = parsed.attachments?.[attachmentIndex];
      if (!att) return null;
      return {
        filename: att.filename || 'attachment',
        contentType: att.contentType,
        content: att.content,
      };
    } finally {
      lock.release();
    }
  }

  async fetchThread(credentials: EmailCredentials, folder: string, uid: number) {
    const client = await this.getConnection(credentials);
    const lock = await client.getMailboxLock(folder);

    try {
      // 1. Fetch the target email to get its headers
      const targetMsg: any = await client.fetchOne(uid, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        uid: true,
        size: true,
        source: true,
      }, { uid: true });

      const parsed = await simpleParser(targetMsg.source);
      const targetMessageId = targetMsg.envelope.messageId || '';
      const references: string[] = [];

      if (parsed.references) {
        if (Array.isArray(parsed.references)) {
          references.push(...parsed.references);
        } else {
          references.push(parsed.references);
        }
      }
      if (parsed.inReplyTo) {
        const inReplyToId = typeof parsed.inReplyTo === 'string' ? parsed.inReplyTo : String(parsed.inReplyTo);
        if (!references.includes(inReplyToId)) {
          references.push(inReplyToId);
        }
      }
      if (targetMessageId && !references.includes(targetMessageId)) {
        references.push(targetMessageId);
      }

      const allRelatedUids = new Set<number>();
      allRelatedUids.add(uid);

      // 2. Search by References/In-Reply-To headers
      for (const ref of references) {
        try {
          const headerResults: any = await client.search({ header: { 'References': ref } }, { uid: true });
          if (headerResults) headerResults.forEach((u: number) => allRelatedUids.add(u));
        } catch { /* ignore */ }

        try {
          const inReplyResults: any = await client.search({ header: { 'In-Reply-To': ref } }, { uid: true });
          if (inReplyResults) inReplyResults.forEach((u: number) => allRelatedUids.add(u));
        } catch { /* ignore */ }

        try {
          const msgIdResults: any = await client.search({ header: { 'Message-ID': ref } }, { uid: true });
          if (msgIdResults) msgIdResults.forEach((u: number) => allRelatedUids.add(u));
        } catch { /* ignore */ }
      }

      // 3. Fallback: search by normalized subject
      const rawSubject = targetMsg.envelope.subject || '';
      const normalizedSubject = rawSubject.replace(/^(Re|Fwd|Fw|Tr)\s*:\s*/gi, '').trim();
      if (normalizedSubject) {
        try {
          const subjectResults: any = await client.search({ subject: normalizedSubject }, { uid: true });
          if (subjectResults) subjectResults.forEach((u: number) => allRelatedUids.add(u));
        } catch { /* ignore */ }
      }

      // 4. Fetch all related emails
      const uids = Array.from(allRelatedUids);
      if (uids.length <= 1) {
        return [];
      }

      const threadEmails = [];
      for await (const msg of client.fetch(uids, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        uid: true,
        size: true,
        source: true,
      }, { uid: true })) {
        const msgParsed = await simpleParser((msg as any).source);
        threadEmails.push({
          uid: (msg as any).uid,
          folder,
          messageId: (msg as any).envelope.messageId,
          subject: (msg as any).envelope.subject || '(sans objet)',
          from: this.formatAddress((msg as any).envelope.from),
          to: this.formatAddresses((msg as any).envelope.to),
          cc: this.formatAddresses((msg as any).envelope.cc),
          date: (msg as any).envelope.date ? (msg as any).envelope.date.toISOString() : null,
          flags: Array.from((msg as any).flags || []),
          isRead: (msg as any).flags?.has('\\Seen') || false,
          body: msgParsed.text || '',
          htmlBody: msgParsed.html || '',
          size: (msg as any).size,
        });
      }

      // Sort by date ascending
      threadEmails.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db = b.date ? new Date(b.date).getTime() : 0;
        return da - db;
      });

      return threadEmails;
    } finally {
      lock.release();
    }
  }

  async setFlag(credentials: EmailCredentials, folder: string, uid: number, flag: string, value: boolean) {
    const client = await this.getConnection(credentials);
    const lock = await client.getMailboxLock(folder);

    try {
      if (value) {
        await client.messageFlagsAdd(uid, [flag], { uid: true });
      } else {
        await client.messageFlagsRemove(uid, [flag], { uid: true });
      }
    } finally {
      lock.release();
    }
  }

  async moveEmail(credentials: EmailCredentials, fromFolder: string, uid: number, toFolder: string) {
    const client = await this.getConnection(credentials);
    const lock = await client.getMailboxLock(fromFolder);

    try {
      await client.messageMove(uid, toFolder, { uid: true });
    } finally {
      lock.release();
    }
  }

  async deleteEmail(credentials: EmailCredentials, folder: string, uid: number, trashFolder?: string) {
    if (trashFolder && folder !== trashFolder) {
      await this.moveEmail(credentials, folder, uid, trashFolder);
    } else {
      const client = await this.getConnection(credentials);
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
        await client.messageDelete(uid, { uid: true });
      } finally {
        lock.release();
      }
    }
  }

  async createFolder(credentials: EmailCredentials, folderPath: string) {
    const client = await this.getConnection(credentials);
    await client.mailboxCreate(folderPath);
  }

  async appendToSentFolder(credentials: EmailCredentials, rawMessage: string | Buffer): Promise<void> {
    const client = await this.getConnection(credentials);
    const folders = await client.list();
    const sentFolder = folders.find(
      (f: any) => f.specialUse === '\\Sent',
    );

    if (!sentFolder) {
      console.warn('No Sent folder found, skipping append');
      return;
    }

    await client.append(sentFolder.path, rawMessage, ['\\Seen']);
  }

  async deleteFolder(credentials: EmailCredentials, folderPath: string) {
    const client = await this.getConnection(credentials);
    await client.mailboxDelete(folderPath);
  }

  // --- Helper functions ---

  private formatEmailSummary(msg: any, folder: string) {
    const hasAttachments = this.checkAttachments(msg.bodyStructure);
    return {
      uid: msg.uid,
      folder,
      subject: msg.envelope.subject || '(sans objet)',
      from: this.formatAddress(msg.envelope.from),
      to: this.formatAddresses(msg.envelope.to),
      date: msg.envelope.date ? msg.envelope.date.toISOString() : null,
      flags: Array.from(msg.flags || []),
      isRead: msg.flags?.has('\\Seen') || false,
      isStarred: msg.flags?.has('\\Flagged') || false,
      hasAttachments,
      size: msg.size,
      snippet: '',
    };
  }

  private formatAddress(addresses: any) {
    if (!addresses || addresses.length === 0) return { name: '', email: '' };
    const addr = addresses[0];
    return {
      name: addr.name || addr.address || '',
      email: addr.address || '',
    };
  }

  private formatAddresses(addresses: any[]) {
    if (!addresses) return [];
    return addresses.map((addr) => ({
      name: addr.name || addr.address || '',
      email: addr.address || '',
    }));
  }

  private checkAttachments(bodyStructure: any): boolean {
    if (!bodyStructure) return false;
    if (bodyStructure.disposition === 'attachment') return true;
    if (bodyStructure.childNodes) {
      return bodyStructure.childNodes.some((node: any) => this.checkAttachments(node));
    }
    return false;
  }

  private buildSearchCriteria(query: string) {
    if (!query || typeof query === 'string') {
      if (!query) return { all: true };

      const criteria: any = {};
      const parts = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
      const textParts = [];

      for (const part of parts) {
        if (part.startsWith('from:')) {
          criteria.from = part.slice(5);
        } else if (part.startsWith('to:')) {
          criteria.to = part.slice(3);
        } else if (part.startsWith('subject:')) {
          criteria.subject = part.slice(8);
        } else if (part === 'is:unread') {
          criteria.unseen = true;
        } else if (part.startsWith('since:') || part.startsWith('after:')) {
          criteria.since = new Date(part.split(':')[1]);
        } else if (part.startsWith('before:')) {
          criteria.before = new Date(part.split(':')[1]);
        } else {
          textParts.push(part);
        }
      }

      if (textParts.length > 0) {
        criteria.or = [
          { subject: textParts.join(' ') },
          { body: textParts.join(' ') },
          { from: textParts.join(' ') },
        ];
      }

      return criteria;
    }
    return query;
  }
}
