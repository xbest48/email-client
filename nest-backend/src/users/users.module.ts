import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { WebAuthnCredential } from './webauthn-credential.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, WebAuthnCredential])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
