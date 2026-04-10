import { Module } from '@nestjs/common';
import { ImapService } from './imap/imap.service';
import { SmtpService } from './smtp/smtp.service';
import { EmailController } from './email.controller';
import { AccountsModule } from '../accounts/accounts.module';
import { ContactsModule } from '../contacts/contacts.module';
import { UsersModule } from '../users/users.module';
import { forwardRef } from '@nestjs/common';
import { LabelsModule } from '../labels/labels.module';

@Module({
  imports: [forwardRef(() => AccountsModule), ContactsModule, UsersModule, LabelsModule],
  providers: [ImapService, SmtpService],
  controllers: [EmailController],
  exports: [ImapService, SmtpService],
})
export class EmailModule {}
