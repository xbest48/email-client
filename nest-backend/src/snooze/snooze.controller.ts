import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SnoozeService } from './snooze.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/snooze')
export class SnoozeController {
  constructor(private readonly snoozeService: SnoozeService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.snoozeService.findAll(req.user.id);
  }

  @Post()
  create(
    @Request() req: any,
    @Body() body: { folder: string; uid: number; until: string },
  ) {
    return this.snoozeService.create(req.user.id, {
      folder: body.folder,
      uid: body.uid,
      snoozeUntil: new Date(body.until),
    });
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.snoozeService.remove(id, req.user.id);
  }

  @Get('due')
  findDue(@Request() req: any) {
    return this.snoozeService.findDue(req.user.id);
  }

  @Get('count')
  count(@Request() req: any) {
    return this.snoozeService.count(req.user.id);
  }
}
