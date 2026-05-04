import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OAuthAuthCode } from './oauth-auth-code.entity';
import { ApiKey } from '../api-keys/api-key.entity';
import { OAuthService } from './oauth.service';
import { OAuthController, OAuthMetadataController } from './oauth.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [TypeOrmModule.forFeature([OAuthAuthCode, ApiKey]), ApiKeysModule],
  providers: [OAuthService],
  controllers: [OAuthController, OAuthMetadataController],
})
export class OAuthModule {}
