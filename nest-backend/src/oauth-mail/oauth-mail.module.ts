import { Module, forwardRef } from '@nestjs/common';
import { OauthMailController } from './oauth-mail.controller';
import { OauthMailHttpService } from './oauth-mail-http.service';
import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [forwardRef(() => AccountsModule), AuthModule],
  controllers: [OauthMailController],
  providers: [OauthMailHttpService],
  exports: [OauthMailHttpService],
})
export class OauthMailModule {}
