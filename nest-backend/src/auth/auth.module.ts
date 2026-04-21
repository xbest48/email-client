import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './jwt.strategy';
import { SecurityNotificationService } from './security-notification.service';
import { AccountsModule } from '../accounts/accounts.module';
import { EmailModule } from '../email/email.module';
import { getAccessTokenSecret } from './auth.config';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    // forwardRef because AccountsModule <-> EmailModule already have a
    // circular dependency and we only need AccountsService / SmtpService here
    // for the new-device notification.
    forwardRef(() => AccountsModule),
    forwardRef(() => EmailModule),
    JwtModule.registerAsync({
      useFactory: () => ({
        // Default secret used when .sign() is called without an explicit one.
        // Per-token secrets (access vs. refresh) are applied explicitly in
        // AuthService.sign*Token().
        secret: getAccessTokenSecret(),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, SecurityNotificationService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
