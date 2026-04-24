import { Body, Controller, Headers, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService, AiActionItem, AiCategoryResult, AiPhishingResult, EmailTriageInput, EmailTriageResult } from './ai.service';

@UseGuards(JwtAuthGuard)
@Controller('api/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('compose')
  async compose(
    @Request() req: any,
    @Body() body: { prompt: string; currentDraft?: string; tone?: string },
  ): Promise<{ result: string }> {
    const result = await this.aiService.compose(
      req.user.id,
      body.prompt,
      body.currentDraft,
      body.tone,
    );
    return { result };
  }

  @Post('summarize')
  async summarize(
    @Request() req: any,
    @Body() body: { emailContent: string },
  ): Promise<{ result: string }> {
    const result = await this.aiService.summarize(req.user.id, body.emailContent);
    return { result };
  }

  @Post('reply')
  async reply(
    @Request() req: any,
    @Body() body: { emailContent: string },
  ): Promise<{ result: string[] }> {
    const result = await this.aiService.reply(req.user.id, body.emailContent);
    return { result };
  }

  @Post('extract')
  async extract(
    @Request() req: any,
    @Body() body: { emailContent: string },
  ): Promise<{ result: AiActionItem[] }> {
    const result = await this.aiService.extract(req.user.id, body.emailContent);
    return { result };
  }

  @Post('translate')
  async translate(
    @Request() req: any,
    @Body() body: { emailContent: string; targetLanguage: string },
  ): Promise<{ result: string }> {
    const result = await this.aiService.translate(req.user.id, body.emailContent, body.targetLanguage);
    return { result };
  }

  @Post('categorize')
  async categorize(
    @Request() req: any,
    @Headers('x-account-id') accountId: string | undefined,
    @Body() body: { emailContent: string; messageId?: string; folder?: string; uid?: number },
  ): Promise<{ result: AiCategoryResult }> {
    const result = await this.aiService.categorize(
      req.user.id,
      body.emailContent,
      {
        messageId: body.messageId,
        folder: body.folder,
        uid: body.uid,
      },
      accountId,
    );
    return { result };
  }

  @Post('phishing')
  async phishing(
    @Request() req: any,
    @Headers('x-account-id') accountId: string | undefined,
    @Body() body: { emailContent: string; messageId?: string; folder?: string; uid?: number },
  ): Promise<{ result: AiPhishingResult }> {
    const result = await this.aiService.phishing(
      req.user.id,
      body.emailContent,
      {
        messageId: body.messageId,
        folder: body.folder,
        uid: body.uid,
      },
      accountId,
    );
    return { result };
  }

  @Post('triage')
  async triage(
    @Request() req: any,
    @Headers('x-account-id') accountId: string | undefined,
    @Body() body: { emails: EmailTriageInput[] },
  ): Promise<{ result: EmailTriageResult[] }> {
    const result = await this.aiService.triage(req.user.id, body.emails ?? [], accountId);
    return { result };
  }
}
