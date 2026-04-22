import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { UsersModule } from '../users/users.module';
import { EmailAiInsight } from './email-ai-insight.entity';

@Module({
  imports: [UsersModule, TypeOrmModule.forFeature([EmailAiInsight])],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
