import { Module } from '@nestjs/common';
import { ImapService } from './imap/imap.service';
import { SmtpService } from './smtp/smtp.service';
import { EmailController } from './email.controller';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [AccountsModule],
  providers: [ImapService, SmtpService],
  controllers: [EmailController],
  exports: [ImapService, SmtpService],
})
export class EmailModule {}
