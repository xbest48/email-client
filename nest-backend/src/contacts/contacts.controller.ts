import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  search(@Request() req: any, @Query('q') query: string) {
    return this.contactsService.search(req.user.id, query || '');
  }
}
