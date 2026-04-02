import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { Account } from './account.entity';

@Controller('api/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  findAll(): Promise<Account[]> {
    return this.accountsService.findAll();
  }

  @Post()
  create(@Body() account: Partial<Account>): Promise<Account> {
    return this.accountsService.create(account);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.accountsService.remove(id);
  }
}
