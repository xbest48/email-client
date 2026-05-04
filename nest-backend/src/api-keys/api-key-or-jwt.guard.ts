import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiKeysService } from './api-keys.service';

/**
 * Accepts either:
 *  - an MCP API key (Authorization: Bearer mcp_...) → req.user.id + req.mcpAccountId
 *  - a regular JWT (Authorization: Bearer eyJ...)   → falls back to JwtAuthGuard
 *
 * On success, downstream handlers can read:
 *  - `req.user.id`         the user id (always)
 *  - `req.mcpAccountId`    the account id bound to the API key (only when key auth)
 *  - `req.authMethod`      'apikey' | 'jwt'
 */
@Injectable()
export class ApiKeyOrJwtGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly jwtGuard: JwtAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & { user?: { id: string }; mcpAccountId?: string; authMethod?: 'apikey' | 'jwt' }
    >();

    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer mcp_')) {
      const token = auth.slice('Bearer '.length);
      const result = await this.apiKeys.validateToken(token);
      if (!result) throw new UnauthorizedException('Clé invalide ou expirée.');
      req.user = { id: result.userId };
      req.mcpAccountId = result.accountId;
      req.authMethod = 'apikey';
      return true;
    }

    const ok = await this.jwtGuard.canActivate(context);
    if (ok) req.authMethod = 'jwt';
    return !!ok;
  }
}
