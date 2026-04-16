import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { WebAuthnCredential } from './webauthn-credential.entity';
import { AuthSession } from './auth-session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, WebAuthnCredential, AuthSession])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
