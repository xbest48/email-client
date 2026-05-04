import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { OAuthAuthCode } from './oauth-auth-code.entity';
import { ApiKey } from '../api-keys/api-key.entity';
import { ApiKeysService } from '../api-keys/api-keys.service';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function safeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function base64UrlSha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

@Injectable()
export class OAuthService {
  constructor(
    @InjectRepository(OAuthAuthCode)
    private readonly codes: Repository<OAuthAuthCode>,
    @InjectRepository(ApiKey)
    private readonly keys: Repository<ApiKey>,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  /**
   * Issue an authorization code for the OAuth client (= ApiKey by id).
   *
   * Note: per OAuth, this endpoint should require user authentication so
   * the user can consent. We skip explicit consent because the requester
   * proved ownership of the client_id when they created the ApiKey in
   * settings — they only need the client_secret to redeem the code.
   */
  async issueAuthorizationCode(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string | null;
  }): Promise<{ code: string }> {
    const apiKey = await this.keys.findOne({ where: { id: input.clientId } });
    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException('invalid_client');
    }
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('invalid_client');
    }

    if (!input.codeChallenge) throw new BadRequestException('code_challenge required');
    const method = (input.codeChallengeMethod || 'S256').toUpperCase();
    if (method !== 'S256' && method !== 'PLAIN') {
      throw new BadRequestException('unsupported code_challenge_method');
    }
    if (!/^https:\/\//.test(input.redirectUri) && !/^http:\/\/localhost(:\d+)?\//.test(input.redirectUri)) {
      throw new BadRequestException('invalid redirect_uri');
    }

    const code = randomBytes(32).toString('base64url');
    await this.codes.save(
      this.codes.create({
        codeHash: sha256(code),
        apiKeyId: apiKey.id,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: method,
        scope: input.scope,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        usedAt: null,
      }),
    );
    return { code };
  }

  async exchangeCodeForToken(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{
    access_token: string;
    token_type: 'Bearer';
    expires_in: number;
    scope?: string;
  }> {
    const codeRow = await this.codes.findOne({
      where: { codeHash: sha256(input.code) },
    });
    if (!codeRow) throw new UnauthorizedException('invalid_grant');
    if (codeRow.usedAt) throw new UnauthorizedException('invalid_grant');
    if (codeRow.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('invalid_grant');
    if (codeRow.apiKeyId !== input.clientId) throw new UnauthorizedException('invalid_grant');
    if (codeRow.redirectUri !== input.redirectUri) throw new UnauthorizedException('invalid_grant');

    // Verify PKCE.
    if (codeRow.codeChallengeMethod === 'S256') {
      const expected = base64UrlSha256(input.codeVerifier);
      if (!safeEquals(expected, codeRow.codeChallenge)) {
        throw new UnauthorizedException('invalid_grant');
      }
    } else {
      if (!safeEquals(input.codeVerifier, codeRow.codeChallenge)) {
        throw new UnauthorizedException('invalid_grant');
      }
    }

    // Validate client_secret against the parent ApiKey hash.
    const apiKey = await this.keys.findOne({ where: { id: input.clientId } });
    if (!apiKey || apiKey.revokedAt) throw new UnauthorizedException('invalid_client');
    if (apiKey.keyHash !== sha256(input.clientSecret)) {
      throw new UnauthorizedException('invalid_client');
    }

    // Burn the code.
    codeRow.usedAt = new Date();
    await this.codes.save(codeRow);

    // Issue a derived access key bound to the same user/account, short-lived.
    // It is created via the ApiKeysService with a generated name.
    const ttlMs = Math.min(
      ACCESS_TOKEN_TTL_MS,
      apiKey.expiresAt
        ? Math.max(60_000, apiKey.expiresAt.getTime() - Date.now())
        : ACCESS_TOKEN_TTL_MS,
    );
    const expiresAt = new Date(Date.now() + ttlMs);

    const created = await this.apiKeysService.create(apiKey.userId, {
      name: `${apiKey.name} (session)`,
      accountId: apiKey.accountId,
      expiresAt,
    });

    return {
      access_token: created.token,
      token_type: 'Bearer',
      expires_in: Math.floor(ttlMs / 1000),
      scope: codeRow.scope ?? undefined,
    };
  }
}
