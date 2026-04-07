import { Module } from '@nestjs/common';
import { ImapService } from './imap/imap.service';
import { SmtpService } from './smtp/smtp.service';
import { EmailController } from './email.controller';
import { AccountsModule } from '../accounts/accounts.module';
import { ContactsModule } from '../contacts/contacts.module';
import { forwardRef } from '@nestjs/common';

@Module({
  imports: [forwardRef(() => AccountsModule), ContactsModule],
  providers: [ImapService, SmtpService],
  controllers: [EmailController],
  exports: [ImapService, SmtpService],
})
export class EmailModule {}
