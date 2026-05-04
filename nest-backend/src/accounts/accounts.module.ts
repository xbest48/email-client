import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { Account } from './account.entity';
import { EmailModule } from '../email/email.module';
import { OauthMailModule } from '../oauth-mail/oauth-mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account]),
    forwardRef(() => EmailModule),
    forwardRef(() => OauthMailModule),
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService]
})
export class AccountsModule {}
