import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AccountsModule } from './accounts/accounts.module';
import { Account } from './accounts/account.entity';
import { EmailModule } from './email/email.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { User } from './users/user.entity';
import { WebAuthnCredential } from './users/webauthn-credential.entity';
import { LabelsModule } from './labels/labels.module';
import { Label } from './labels/label.entity';
import { EmailLabel } from './labels/email-label.entity';
import { FiltersModule } from './filters/filters.module';
import { FilterRule } from './filters/filter-rule.entity';
import { SnoozeModule } from './snooze/snooze.module';
import { SnoozedEmail } from './snooze/snoozed-email.entity';
import { ScheduledModule } from './scheduled/scheduled.module';
import { ScheduledEmail } from './scheduled/scheduled-email.entity';
import { ContactsModule } from './contacts/contacts.module';
import { Contact } from './contacts/contact.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'settings.sqlite',
      entities: [
        Account,
        User,
        WebAuthnCredential,
        Label,
        EmailLabel,
        FilterRule,
        SnoozedEmail,
        ScheduledEmail,
        Contact,
      ],
      synchronize: true,
    }),
    AccountsModule,
    EmailModule,
    UsersModule,
    AuthModule,
    LabelsModule,
    FiltersModule,
    SnoozeModule,
    ScheduledModule,
    ContactsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
