import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FiltersController } from './filters.controller';
import { FiltersService } from './filters.service';
import { FilterRule } from './filter-rule.entity';
import { EmailModule } from '../email/email.module';
import { AccountsModule } from '../accounts/accounts.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FilterRule]),
    forwardRef(() => EmailModule),
    forwardRef(() => AccountsModule),
    AiModule,
  ],
  controllers: [FiltersController],
  providers: [FiltersService],
  exports: [FiltersService],
})
export class FiltersModule {}
