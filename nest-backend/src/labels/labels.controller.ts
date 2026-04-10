import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LabelsService } from './labels.service';

@UseGuards(JwtAuthGuard)
@Controller('api/labels')
export class LabelsController {
  constructor(private readonly labelsService: LabelsService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.labelsService.findAllByUser(req.user.id);
  }

  @Post()
  create(@Request() req: any, @Body() body: { name: string; color: string }) {
    return this.labelsService.create(req.user.id, body);
  }

  @Put(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: Partial<{ name: string; color: string }>,
  ) {
    const label = await this.labelsService.update(id, req.user.id, body);
    if (!label) throw new NotFoundException('Label not found');
    return label;
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.labelsService.remove(id, req.user.id);
  }

  @Post(':id/emails')
  addEmail(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { folder: string; uid: number },
  ) {
    return this.labelsService.addEmailToLabel(id, req.user.id, body.folder, body.uid);
  }

  @Delete(':id/emails')
  removeEmail(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { folder: string; uid: number },
  ) {
    return this.labelsService.removeEmailFromLabel(id, req.user.id, body.folder, body.uid);
  }

  @Get(':id/emails')
  getEmails(@Request() req: any, @Param('id') id: string) {
    return this.labelsService.getEmailsByLabel(id, req.user.id);
  }

  @Get('counts')
  getCounts(@Request() req: any) {
    return this.labelsService.getLabelCountsForUser(req.user.id);
  }

  @Get('all-emails')
  getAllEmailAssignments(@Request() req: any) {
    return this.labelsService.getAllEmailLabelsForUser(req.user.id);
  }

  @Get('for-email/:folder/:uid')
  getLabelsForEmail(
    @Request() req: any,
    @Param('folder') folder: string,
    @Param('uid') uid: string,
  ) {
    return this.labelsService.getLabelsForEmail(req.user.id, folder, parseInt(uid, 10));
  }
}
