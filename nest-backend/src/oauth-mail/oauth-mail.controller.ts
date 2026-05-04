import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes, createHash } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OauthMailHttpService } from './oauth-mail-http.service';
import { AccountsService } from '../accounts/accounts.service';
import { OAuthMailProvider } from '../accounts/account.entity';

interface PendingFlow {
  userId: string;
  codeVerifier: string;
  redirectUri: string;
  provider: OAuthMailProvider;
  expiresAt: number;
}

const FLOW_TTL_MS = 10 * 60 * 1000;
const SUPPORTED_PROVIDERS: OAuthMailProvider[] = ['microsoft', 'google'];

function base64UrlNoPad(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

@Controller('api/oauth-mail')
export class OauthMailController {
  // In-memory state map. OAuth flows complete in seconds, so a map with TTL is
  // safer (and faster) than a DB table that could be queried by an attacker.
  private readonly pendingFlows = new Map<string, PendingFlow>();

  constructor(
    private readonly oauthHttp: OauthMailHttpService,
    private readonly accountsService: AccountsService,
  ) {}

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [state, flow] of this.pendingFlows) {
      if (flow.expiresAt < now) this.pendingFlows.delete(state);
    }
  }

  private resolveRedirectUri(req: Request, provider: OAuthMailProvider): string {
    const explicit = process.env.OAUTH_MAIL_REDIRECT_URI;
    if (explicit) return `${explicit.replace(/\/$/, '')}/${provider}/callback`;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}/api/oauth-mail/${provider}/callback`;
  }

  /** Returns the list of OAuth providers the operator has configured. */
  @Get('providers')
  listProviders(): { providers: OAuthMailProvider[] } {
    return {
      providers: SUPPORTED_PROVIDERS.filter(
        (provider) => this.oauthHttp.getProviderConfig(provider) !== null,
      ),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':provider/start')
  start(
    @Param('provider') providerParam: string,
    @Req() req: Request & { user: { id: string } },
    @Res() res: Response,
  ): void {
    const provider = providerParam as OAuthMailProvider;
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      throw new BadRequestException('Unknown OAuth provider');
    }
    const cfg = this.oauthHttp.getProviderConfig(provider);
    if (!cfg) {
      throw new ServiceUnavailableException(
        `OAuth ${provider} n'est pas configure sur ce serveur.`,
      );
    }

    this.cleanupExpired();

    const codeVerifier = base64UrlNoPad(randomBytes(48));
    const codeChallenge = base64UrlNoPad(createHash('sha256').update(codeVerifier).digest());
    const state = base64UrlNoPad(randomBytes(24));
    const redirectUri = this.resolveRedirectUri(req, provider);

    this.pendingFlows.set(state, {
      userId: req.user.id,
      codeVerifier,
      redirectUri,
      provider,
      expiresAt: Date.now() + FLOW_TTL_MS,
    });

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: cfg.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // Force account selection so users can pick the right Microsoft account
      // each time, even if they were already signed in to one.
      prompt: 'select_account',
    });
    if (provider === 'google') {
      // Google needs explicit access_type=offline to deliver a refresh_token,
      // and "consent" to keep that refresh_token across reconnects.
      params.set('access_type', 'offline');
      params.set('prompt', 'consent');
    }

    res.redirect(`${cfg.authorizeUrl}?${params.toString()}`);
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') providerParam: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = providerParam as OAuthMailProvider;

    if (error) {
      res.send(this.renderResultHtml({ ok: false, message: errorDescription || error }));
      return;
    }
    if (!code || !state) {
      res.send(this.renderResultHtml({ ok: false, message: 'Reponse OAuth invalide.' }));
      return;
    }

    const flow = this.pendingFlows.get(state);
    if (!flow || flow.expiresAt < Date.now() || flow.provider !== provider) {
      this.pendingFlows.delete(state);
      res.send(this.renderResultHtml({ ok: false, message: 'Etat OAuth expire ou invalide.' }));
      return;
    }
    this.pendingFlows.delete(state);

    try {
      const tokens = await this.oauthHttp.exchangeCodeForTokens(provider, {
        code,
        codeVerifier: flow.codeVerifier,
        redirectUri: flow.redirectUri,
      });

      const email = this.oauthHttp.extractEmailFromIdToken(tokens.idToken);
      if (!email) {
        res.send(this.renderResultHtml({
          ok: false,
          message: "Impossible de recuperer l'adresse email du compte OAuth.",
        }));
        return;
      }
      if (!tokens.refreshToken) {
        res.send(this.renderResultHtml({
          ok: false,
          message: "Aucun refresh_token retourne. Reessayez en revoquant l'acces dans les parametres du fournisseur.",
        }));
        return;
      }

      const cfg = this.oauthHttp.getProviderConfig(provider)!;
      await this.accountsService.upsertOAuthAccount(flow.userId, {
        email,
        provider,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(tokens.expiresAt),
        imapHost: cfg.imapHost,
        imapPort: cfg.imapPort,
        smtpHost: cfg.smtpHost,
        smtpPort: cfg.smtpPort,
      });

      res.send(this.renderResultHtml({ ok: true, email, provider }));
    } catch (err: any) {
      res.send(this.renderResultHtml({
        ok: false,
        message: err?.message || 'Echec de la connexion OAuth.',
      }));
    }
  }

  /**
   * Page rendered inside the popup window after the OAuth round-trip. It
   * postMessages the result back to the opener and self-closes so the user
   * doesn't have to deal with a stray window.
   */
  private renderResultHtml(result:
    | { ok: true; email: string; provider: string }
    | { ok: false; message: string }
  ): string {
    const payload = JSON.stringify({ type: 'oauth-mail-result', ...result });
    const message = result.ok
      ? `Compte ${result.email} connecte. Vous pouvez fermer cette fenetre.`
      : `Echec de connexion : ${result.message}`;
    return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Connexion OAuth</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; background: #0b1220; color: #e2e8f0;
       display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 1rem; }
.box { max-width: 26rem; text-align: center; line-height: 1.5; }
</style></head>
<body><div class="box"><p>${this.escapeHtml(message)}</p></div>
<script>
(function () {
  var payload = ${payload};
  try { if (window.opener) window.opener.postMessage(payload, window.location.origin); } catch (e) {}
  setTimeout(function () { try { window.close(); } catch (e) {} }, 1500);
})();
</script></body></html>`;
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
