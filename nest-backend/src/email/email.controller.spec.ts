import { Test, TestingModule } from '@nestjs/testing';
import { EmailController } from './email.controller';
import { ImapService } from './imap/imap.service';
import { SmtpService } from './smtp/smtp.service';
import { AccountsService } from '../accounts/accounts.service';
import { ContactsService } from '../contacts/contacts.service';
import { UsersService } from '../users/users.service';
import { LabelsService } from '../labels/labels.service';

describe('EmailController', () => {
  let controller: EmailController;
  const imapService = { fetchSource: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailController],
      providers: [
        { provide: ImapService, useValue: imapService },
        { provide: SmtpService, useValue: {} },
        { provide: AccountsService, useValue: {} },
        { provide: ContactsService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: LabelsService, useValue: {} }
      ],
    }).compile();

    controller = module.get<EmailController>(EmailController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSource', () => {
    const res = () => ({ setHeader: jest.fn(), send: jest.fn() });

    beforeEach(() => {
      imapService.fetchSource.mockReset();
      jest.spyOn(controller as any, 'getCredentials').mockResolvedValue({ user: 'u' });
    });

    it('sends the raw message bytes as message/rfc822', async () => {
      const raw = Buffer.from('Subject: =?UTF-8?Q?=C3=A9t=C3=A9?=\r\n\r\nBody');
      imapService.fetchSource.mockResolvedValue(raw);
      const response = res();

      await controller.getSource({}, {}, 'INBOX%2FFactures', '42', response as any);

      expect(imapService.fetchSource).toHaveBeenCalledWith({ user: 'u' }, 'INBOX/Factures', 42);
      expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'message/rfc822');
      expect(response.setHeader).toHaveBeenCalledWith('Content-Length', String(raw.length));
      expect(response.send).toHaveBeenCalledWith(raw);
    });

    it('returns 404 when the message no longer exists', async () => {
      imapService.fetchSource.mockResolvedValue(null);

      await expect(controller.getSource({}, {}, 'INBOX', '42', res() as any)).rejects.toThrow('Message not found');
    });
  });
});
