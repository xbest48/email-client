import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { Account } from './account.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  findAll(@Request() req: any): Promise<Account[]> {
    return this.accountsService.findAll(req.user.id);
  }

  @Post()
  create(@Request() req: any, @Body() account: Partial<Account>): Promise<Account> {
    return this.accountsService.create({ ...account, user: req.user.id } as any);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string): Promise<void> {
    return this.accountsService.remove(id, req.user.id);
  }
}
