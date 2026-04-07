import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnoozeController } from './snooze.controller';
import { SnoozeService } from './snooze.service';
import { SnoozedEmail } from './snoozed-email.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SnoozedEmail])],
  controllers: [SnoozeController],
  providers: [SnoozeService],
  exports: [SnoozeService],
})
export class SnoozeModule {}
