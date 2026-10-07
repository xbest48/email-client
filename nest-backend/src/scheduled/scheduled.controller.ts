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
  PayloadTooLargeException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
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

  private static readonly MAX_TOTAL_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

  @Post()
  @UseInterceptors(FilesInterceptor('files', 20, {
    // Browsers send UTF-8 filenames; busboy defaults to latin1 and turned
    // "été.pdf" into "Ã©tÃ©.pdf".
    defParamCharset: 'utf8',
    limits: {
      fieldSize: 25 * 1024 * 1024,
      fileSize: 25 * 1024 * 1024,
    },
  }))
  create(
    @Request() req: any,
    @Headers() headers: any,
    @Body() body: { to: string; subject: string; body: string; cc?: string; bcc?: string; scheduledAt: string },
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const accountId = headers['x-account-id'];
    if (!accountId) throw new BadRequestException('Missing x-account-id header');
    if (!body.to?.trim()) throw new BadRequestException('Missing recipient');
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) throw new BadRequestException('Invalid scheduledAt');

    const total = (files ?? []).reduce((sum, f) => sum + f.size, 0);
    if (total > ScheduledController.MAX_TOTAL_ATTACHMENTS_BYTES) {
      throw new PayloadTooLargeException('Pièces jointes trop volumineuses (25 Mo maximum au total).');
    }

    return this.scheduledService.create(
      req.user.id,
      accountId,
      {
        to: body.to,
        subject: body.subject,
        body: body.body,
        cc: body.cc || undefined,
        bcc: body.bcc || undefined,
        scheduledAt,
      },
      (files ?? []).map((f) => ({
        filename: f.originalname,
        contentType: f.mimetype,
        content: f.buffer,
      })),
    );
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.scheduledService.remove(id, req.user.id);
  }
}
