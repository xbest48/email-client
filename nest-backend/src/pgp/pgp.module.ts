import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PgpKey, PgpContactKey } from './pgp-key.entity';
import { PgpService } from './pgp.service';
import { PgpController } from './pgp.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PgpKey, PgpContactKey])],
  controllers: [PgpController],
  providers: [PgpService],
  exports: [PgpService],
})
export class PgpModule {}
