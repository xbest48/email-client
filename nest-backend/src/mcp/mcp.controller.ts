import {
  All,
  BadRequestException,
  Controller,
  Headers,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ApiKeyOrJwtGuard } from '../api-keys/api-key-or-jwt.guard';
import { ImapService } from '../email/imap/imap.service';
import { SmtpService } from '../email/smtp/smtp.service';
import { AccountsService } from '../accounts/accounts.service';
import { LabelsService } from '../labels/labels.service';
import { createMcpServer } from './mcp-server.factory';

type AuthedRequest = ExpressRequest & {
  user?: { id: string };
  mcpAccountId?: string;
  body?: unknown;
};

@UseGuards(ApiKeyOrJwtGuard)
@Controller('api/mcp')
export class McpController {
  constructor(
    private readonly imap: ImapService,
    private readonly smtp: SmtpService,
    private readonly accounts: AccountsService,
    private readonly labels: LabelsService,
  ) {}

  @All()
  async handle(
    @Request() req: AuthedRequest,
    @Res() res: Response,
    @Headers('x-account-id') accountIdHeader?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Utilisateur non identifié.');

    // API key auth: accountId is bound to the key. JWT auth: must be supplied
    // by the client through the x-account-id header (legacy behavior).
    const accountId = req.mcpAccountId ?? accountIdHeader;
    if (!accountId) throw new BadRequestException('Compte email non spécifié.');

    const server = createMcpServer(
      { imap: this.imap, smtp: this.smtp, accounts: this.accounts, labels: this.labels },
      { userId, accountId },
    );

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
