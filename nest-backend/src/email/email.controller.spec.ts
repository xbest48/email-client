import { Test, TestingModule } from '@nestjs/testing';
import { EmailController } from './email.controller';
import { ImapService } from './imap/imap.service';
import { SmtpService } from './smtp/smtp.service';
import { AccountsService } from '../accounts/accounts.service';
import { ContactsService } from '../contacts/contacts.service';
import { UsersService } from '../users/users.service';

describe('EmailController', () => {
  let controller: EmailController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailController],
      providers: [
        { provide: ImapService, useValue: {} },
        { provide: SmtpService, useValue: {} },
        { provide: AccountsService, useValue: {} },
        { provide: ContactsService, useValue: {} },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();

    controller = module.get<EmailController>(EmailController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
