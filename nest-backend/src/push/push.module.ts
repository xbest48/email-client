import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { PushSubscription } from './push-subscription.entity';
import { InboxWatchState } from './inbox-watch-state.entity';
import { InboxPushWatcherService } from './inbox-push-watcher.service';
import { InboxIdleService } from './inbox-idle.service';
import { AccountsModule } from '../accounts/accounts.module';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PushSubscription, InboxWatchState]),
    forwardRef(() => AccountsModule),
    forwardRef(() => UsersModule),
    forwardRef(() => EmailModule),
  ],
  controllers: [PushController],
  providers: [PushService, InboxIdleService, InboxPushWatcherService],
  exports: [PushService],
})
export class PushModule {}
