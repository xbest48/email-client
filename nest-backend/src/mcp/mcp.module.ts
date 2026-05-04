import { Module, forwardRef } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { EmailModule } from '../email/email.module';
import { LabelsModule } from '../labels/labels.module';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { McpController } from './mcp.controller';

@Module({
  imports: [
    forwardRef(() => AccountsModule),
    EmailModule,
    LabelsModule,
    AuthModule,
    ApiKeysModule,
  ],
  controllers: [McpController],
})
export class McpModule {}
