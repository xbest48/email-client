import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AccountsModule } from './accounts/accounts.module';
import { Account } from './accounts/account.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'settings.sqlite',
      entities: [Account],
      synchronize: true,
    }),
    AccountsModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
