import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AccountsModule } from './accounts/accounts.module';
import { Account } from './accounts/account.entity';
import { EmailModule } from './email/email.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { User } from './users/user.entity';
import { WebAuthnCredential } from './users/webauthn-credential.entity';
import { AuthSession } from './users/auth-session.entity';
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
import { PgpModule } from './pgp/pgp.module';
import { PgpKey, PgpContactKey } from './pgp/pgp-key.entity';
import { EmailAiInsight } from './ai/email-ai-insight.entity';

const IS_PROD = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.DB_PATH || 'settings.sqlite',
      entities: [
        Account,
        User,
        WebAuthnCredential,
        AuthSession,
        Label,
        EmailLabel,
        FilterRule,
        SnoozedEmail,
        ScheduledEmail,
        Contact,
        PgpKey,
        PgpContactKey,
        EmailAiInsight,
      ],
      // WARNING: synchronize: true is convenient but DROPS columns when the
      // TypeORM schema diverges from the DB. Opt in explicitly via env.
      synchronize: !IS_PROD && process.env.DB_SYNC !== 'false',
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    AccountsModule,
    EmailModule,
    UsersModule,
    AuthModule,
    AiModule,
    LabelsModule,
    FiltersModule,
    SnoozeModule,
    ScheduledModule,
    ContactsModule,
    PgpModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply rate limiting globally. Individual endpoints can override the
    // limits with @Throttle or opt out with @SkipThrottle.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
