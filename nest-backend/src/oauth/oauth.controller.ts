import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { OAuthService } from './oauth.service';

interface AuthorizeQuery {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

interface TokenBody {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
}

function buildIssuer(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  return `${proto}://${host}`;
}

@Controller('.well-known')
export class OAuthMetadataController {
  /**
   * Authorization Server Metadata (RFC 8414). Lets MCP clients (Claude.ai)
   * discover endpoints automatically.
   */
  @Get('oauth-authorization-server')
  @Header('Cache-Control', 'public, max-age=3600')
  metadata(@Req() req: Request) {
    const issuer = buildIssuer(req);
    return {
      issuer,
      authorization_endpoint: `${issuer}/api/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256', 'plain'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
      registration_endpoint: undefined,
    };
  }

  /** RFC 9728 — Protected Resource Metadata (used by MCP clients). */
  @Get('oauth-protected-resource')
  @Header('Cache-Control', 'public, max-age=3600')
  protectedResource(@Req() req: Request) {
    const issuer = buildIssuer(req);
    return {
      resource: `${issuer}/api/mcp`,
      authorization_servers: [issuer],
    };
  }
}

@Controller()
export class OAuthController {
  constructor(private readonly service: OAuthService) {}

  /**
   * OAuth 2.1 authorization endpoint. We do not show a consent screen — the
   * client_id is bound to a specific user/account at creation time, and the
   * client_secret check at /token enforces ownership.
   */
  @Get('api/oauth/authorize')
  async authorize(@Query() q: AuthorizeQuery, @Res() res: Response) {
    if (q.response_type !== 'code') {
      throw new BadRequestException('unsupported response_type');
    }
    if (!q.client_id) throw new BadRequestException('client_id required');
    if (!q.redirect_uri) throw new BadRequestException('redirect_uri required');
    if (!q.code_challenge) throw new BadRequestException('code_challenge required');

    const { code } = await this.service.issueAuthorizationCode({
      clientId: q.client_id,
      redirectUri: q.redirect_uri,
      codeChallenge: q.code_challenge,
      codeChallengeMethod: q.code_challenge_method || 'S256',
      scope: q.scope ?? null,
    });

    const url = new URL(q.redirect_uri);
    url.searchParams.set('code', code);
    if (q.state) url.searchParams.set('state', q.state);
    res.redirect(302, url.toString());
  }

  @Post('api/oauth/token')
  @HttpCode(200)
  async token(@Body() body: TokenBody) {
    if (body.grant_type !== 'authorization_code') {
      throw new BadRequestException('unsupported_grant_type');
    }
    if (!body.code) throw new BadRequestException('code required');
    if (!body.client_id) throw new BadRequestException('client_id required');
    if (!body.client_secret) throw new BadRequestException('client_secret required');
    if (!body.code_verifier) throw new BadRequestException('code_verifier required');
    if (!body.redirect_uri) throw new BadRequestException('redirect_uri required');

    return this.service.exchangeCodeForToken({
      code: body.code,
      clientId: body.client_id,
      clientSecret: body.client_secret,
      codeVerifier: body.code_verifier,
      redirectUri: body.redirect_uri,
    });
  }
}
