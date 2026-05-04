import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { OAuthMailProvider } from '../accounts/account.entity';

export interface ProviderConfig {
  /** Authorization endpoint (where the user logs in). */
  authorizeUrl: string;
  /** Token exchange endpoint. */
  tokenUrl: string;
  /** OAuth2 scopes requested for IMAP + SMTP access. */
  scopes: string[];
  /** OAuth client id (Azure App registration / Google client). */
  clientId: string;
  /**
   * For confidential clients (Google) we also need the secret. Microsoft
   * personal accounts work with PKCE and a public client (no secret).
   */
  clientSecret?: string;
  /** IMAP host hard-coded per provider. */
  imapHost: string;
  imapPort: number;
  /** SMTP host hard-coded per provider. */
  smtpHost: string;
  smtpPort: number;
}

export interface TokenSet {
  accessToken: string;
  /** Some providers omit a fresh refresh_token on refresh — keep the old one. */
  refreshToken?: string;
  /** Absolute expiry in milliseconds since epoch. */
  expiresAt: number;
  idToken?: string;
}

/**
 * Stateless helper for the parts of the OAuth flow that only talk to the
 * provider (no DB, no AccountsService). Lives in its own service so that
 * AccountsService can call it for token refresh without creating a circular
 * dependency with the higher-level OauthMailService that also writes accounts.
 */
@Injectable()
export class OauthMailHttpService {
  private readonly logger = new Logger(OauthMailHttpService.name);

  /**
   * Build the per-provider OAuth config from environment variables. Returns
   * null when the operator hasn't configured the provider, in which case the
   * UI should show the "OAuth not configured" hint.
   */
  getProviderConfig(provider: OAuthMailProvider): ProviderConfig | null {
    if (provider === 'microsoft') {
      const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
      if (!clientId) return null;
      const tenant = process.env.MICROSOFT_OAUTH_TENANT || 'common';
      return {
        authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        clientId,
        scopes: [
          'offline_access',
          'openid',
          'email',
          'profile',
          'https://outlook.office.com/IMAP.AccessAsUser.All',
          'https://outlook.office.com/SMTP.Send',
        ],
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
      };
    }

    if (provider === 'google') {
      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      if (!clientId || !clientSecret) return null;
      return {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId,
        clientSecret,
        scopes: [
          'openid',
          'email',
          'profile',
          'https://mail.google.com/',
        ],
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
      };
    }

    return null;
  }

  async exchangeCodeForTokens(
    provider: OAuthMailProvider,
    args: { code: string; codeVerifier: string; redirectUri: string },
  ): Promise<TokenSet> {
    const cfg = this.requireConfig(provider);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: cfg.clientId,
      code_verifier: args.codeVerifier,
    });
    if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
    return this.requestTokens(cfg, body);
  }

  async refreshAccessToken(provider: OAuthMailProvider, refreshToken: string): Promise<TokenSet> {
    const cfg = this.requireConfig(provider);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cfg.clientId,
    });
    if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
    // Microsoft requires the same scopes on refresh; Google ignores them.
    body.set('scope', cfg.scopes.join(' '));
    return this.requestTokens(cfg, body);
  }

  /**
   * Decode the unsigned id_token payload to extract the user's email address.
   * We don't need to verify the signature: the token was just delivered over
   * TLS by the provider's token endpoint, so trusting its contents is fine.
   */
  extractEmailFromIdToken(idToken: string | undefined): string | null {
    if (!idToken) return null;
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'),
      );
      return (
        payload.email
        ?? payload.preferred_username
        ?? payload.upn
        ?? null
      );
    } catch {
      return null;
    }
  }

  private requireConfig(provider: OAuthMailProvider): ProviderConfig {
    const cfg = this.getProviderConfig(provider);
    if (!cfg) {
      throw new ServiceUnavailableException(
        `Le fournisseur OAuth "${provider}" n'est pas configure. Definissez les variables d'environnement requises.`,
      );
    }
    return cfg;
  }

  private async requestTokens(cfg: ProviderConfig, body: URLSearchParams): Promise<TokenSet> {
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`OAuth token endpoint failed (${res.status}): ${text}`);
      throw new ServiceUnavailableException("L'echange du code OAuth a echoue.");
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
    };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
      idToken: json.id_token,
    };
  }
}
