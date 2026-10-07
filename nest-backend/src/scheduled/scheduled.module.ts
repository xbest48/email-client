import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledController } from './scheduled.controller';
import { ScheduledService } from './scheduled.service';
import { ScheduledEmail } from './scheduled-email.entity';
import { ScheduledEmailAttachment } from './scheduled-email-attachment.entity';
import { EmailModule } from '../email/email.module';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScheduledEmail, ScheduledEmailAttachment]),
    forwardRef(() => EmailModule),
    forwardRef(() => AccountsModule),
  ],
  controllers: [ScheduledController],
  providers: [ScheduledService],
  exports: [ScheduledService],
})
export class ScheduledModule {}
