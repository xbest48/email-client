import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from './api-key.entity';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyOrJwtGuard } from './api-key-or-jwt.guard';
import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey]),
    forwardRef(() => AccountsModule),
    AuthModule,
  ],
  providers: [ApiKeysService, ApiKeyOrJwtGuard, JwtAuthGuard],
  controllers: [ApiKeysController],
  exports: [ApiKeysService, ApiKeyOrJwtGuard, JwtAuthGuard],
})
export class ApiKeysModule {}
