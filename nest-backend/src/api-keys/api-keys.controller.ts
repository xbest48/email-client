import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiKeysService } from './api-keys.service';

interface CreateBody {
  name: string;
  accountId: string;
  /** ISO date string, or null/undefined for no expiration. */
  expiresAt?: string | null;
}

@UseGuards(JwtAuthGuard)
@Controller('api/api-keys')
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Get()
  list(@Request() req: { user: { id: string } }) {
    return this.service.listForUser(req.user.id);
  }

  @Post()
  async create(@Request() req: { user: { id: string } }, @Body() body: CreateBody) {
    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      const d = new Date(body.expiresAt);
      if (isNaN(d.getTime())) throw new BadRequestException("Date d'expiration invalide.");
      if (d.getTime() < Date.now()) throw new BadRequestException("L'expiration doit être dans le futur.");
      expiresAt = d;
    }
    return this.service.create(req.user.id, {
      name: body.name,
      accountId: body.accountId,
      expiresAt,
    });
  }

  @Delete(':id')
  async revoke(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    await this.service.revoke(id, req.user.id);
    return { success: true };
  }
}
