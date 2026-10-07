process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);

import { ScheduledService } from './scheduled.service';
import { decryptBuffer, encryptBuffer } from '../users/crypto.util';

/** Minimal in-memory stand-in for a TypeORM repository. */
function fakeRepo<T extends { id?: string }>() {
  const rows: T[] = [];
  let seq = 0;
  const matches = (row: any, where: any) => Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    create: (data: Partial<T>) => ({ ...data }) as T,
    save: async (input: T | T[]) => {
      for (const row of Array.isArray(input) ? input : [input]) {
        if (!row.id) row.id = `id${++seq}`;
        if (!rows.includes(row)) rows.push(row);
      }
      return input;
    },
    find: async ({ where }: any = {}) => rows.filter((r) => !where || matches(r, where)),
    update: async (where: any, patch: Partial<T>) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    },
    delete: async (where: any) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { affected: before - rows.length };
    },
  };
}

describe('ScheduledService attachments', () => {
  let emails: ReturnType<typeof fakeRepo<any>>;
  let files: ReturnType<typeof fakeRepo<any>>;
  let service: ScheduledService;
  const smtp = { sendEmail: jest.fn() };
  const imap = { appendToSentFolder: jest.fn() };
  const accounts = { findOneWithPassword: jest.fn() };

  beforeEach(() => {
    jest.useFakeTimers();
    emails = fakeRepo();
    files = fakeRepo();
    smtp.sendEmail.mockReset().mockResolvedValue({ rawMessage: null });
    accounts.findOneWithPassword.mockResolvedValue({ email: 'me@x.fr', password: 'p', displayName: 'Me' });
    service = new ScheduledService(emails as any, files as any, smtp as any, imap as any, accounts as any);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('sends stored attachments when the email is due, then drops them', async () => {
    const content = Buffer.from('%PDF-1.4 contenu');
    await service.create(
      'u1',
      'acc1',
      { to: 'a@b.fr', subject: 'S', body: '<p>B</p>', scheduledAt: new Date(0) },
      [{ filename: 'facture_été.pdf', contentType: 'application/pdf', content }],
    );
    // processDueEmails filters by date through a TypeORM operator; the fake
    // repo ignores it, so only the status matters here.
    emails.find = async () => emails.rows.filter((r) => r.status === 'pending');

    await service.processDueEmails();

    expect(smtp.sendEmail).toHaveBeenCalledTimes(1);
    const dto = smtp.sendEmail.mock.calls[0][1];
    expect(dto.senderName).toBe('Me');
    expect(dto.attachments).toEqual([
      { filename: 'facture_été.pdf', contentType: 'application/pdf', content },
    ]);
    expect(emails.rows[0].status).toBe('sent');
    expect(files.rows).toHaveLength(0);
  });

  it('removes attachments when a scheduled email is cancelled', async () => {
    const created = await service.create(
      'u1',
      'acc1',
      { to: 'a@b.fr', subject: 'S', body: 'B', scheduledAt: new Date() },
      [{ filename: 'a.txt', contentType: 'text/plain', content: Buffer.from('x') }],
    );
    await service.remove(created.id, 'u1');
    expect(files.rows).toHaveLength(0);
  });

  it('does not keep a scheduled email whose attachments failed to save', async () => {
    files.save = async () => { throw new Error('disk full'); };
    await expect(
      service.create('u1', 'acc1', { to: 'a@b.fr', subject: 'S', body: 'B', scheduledAt: new Date() }, [
        { filename: 'a.txt', contentType: 'text/plain', content: Buffer.from('x') },
      ]),
    ).rejects.toThrow('disk full');
    expect(emails.rows).toHaveLength(0);
  });
});

describe('encryptBuffer', () => {
  it('round-trips binary data without exposing it', () => {
    const plain = Buffer.from([0, 1, 2, 255, 254, 0x25, 0x50, 0x44, 0x46]);
    const sealed = encryptBuffer(plain);
    expect(sealed.includes(plain)).toBe(false);
    expect(Buffer.compare(decryptBuffer(sealed), plain)).toBe(0);
  });

  it('rejects tampered ciphertext', () => {
    const sealed = encryptBuffer(Buffer.from('secret'));
    sealed[sealed.length - 1] ^= 1;
    expect(() => decryptBuffer(sealed)).toThrow();
  });
});
