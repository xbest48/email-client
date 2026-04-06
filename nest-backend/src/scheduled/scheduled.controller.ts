import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Headers,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ScheduledService } from './scheduled.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/scheduled')
export class ScheduledController {
  constructor(private readonly scheduledService: ScheduledService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.scheduledService.findAll(req.user.id);
  }

  @Post()
  create(
    @Request() req: any,
    @Headers() headers: any,
    @Body() body: { to: string; subject: string; body: string; cc?: string; bcc?: string; scheduledAt: string },
  ) {
    const accountId = headers['x-account-id'];
    if (!accountId) throw new BadRequestException('Missing x-account-id header');

    return this.scheduledService.create(req.user.id, accountId, {
      to: body.to,
      subject: body.subject,
      body: body.body,
      cc: body.cc,
      bcc: body.bcc,
      scheduledAt: new Date(body.scheduledAt),
    });
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.scheduledService.remove(id, req.user.id);
  }
}
