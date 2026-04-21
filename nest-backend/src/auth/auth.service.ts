import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import * as qrcode from 'qrcode';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { AuthSession } from '../users/auth-session.entity';
import { SecurityNotificationService } from './security-notification.service';
import {
  BCRYPT_ROUNDS,
  getAccessTokenSecret,
  getRefreshTokenSecret,
  getWebAuthnConfig,
} from './auth.config';

interface SessionTokens {
  access_token: string;
  refresh_token: string;
  rememberMe: boolean;
}

interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

export interface ActiveSessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  rememberMe: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  isCurrent: boolean;
}

@Injectable()
export class AuthService {
  static readonly ACCESS_TOKEN_TTL = '15m';
  static readonly SESSION_REFRESH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
  static readonly PERSISTENT_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  private readonly totp: TOTP;

  // Short-lived in-memory store of challenges issued for usernameless
  // (discoverable credential) WebAuthn logins. The key is the challenge, the
  // value is the issued-at epoch. Entries older than DISCOVERABLE_CHALLENGE_TTL
  // are rejected at verification time. For multi-instance deployments this
  // should be moved to a shared store (Redis, DB, signed cookie...).
  private readonly pendingDiscoverableChallenges = new Map<string, number>();
  private static readonly DISCOVERABLE_CHALLENGE_TTL_MS = 5 * 60 * 1000;

  // Single-use store for temporary 2FA tokens. Once a tempToken is consumed
  // (successfully or not), its JTI is blacklisted until it naturally expires.
  private readonly usedTempTokens = new Map<string, number>();
  // Replay-protection for TOTP codes: remember the last accepted code per user
  // for the duration of a TOTP step (30 s) so a sniffed code cannot be reused.
  private readonly lastTotpByUser = new Map<string, { code: string; at: number }>();
  private static readonly TOTP_STEP_MS = 30 * 1000;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private securityNotificationService: SecurityNotificationService,
  ) {
    this.totp = new TOTP({
      crypto: new NobleCryptoPlugin(),
      base32: new ScureBase32Plugin(),
    });
  }

  async register(email: string, pass: string, context?: SessionContext) {
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new BadRequestException('User already exists');
    }
    const passwordHash = await bcrypt.hash(pass, BCRYPT_ROUNDS);
    const user = await this.usersService.create({ email, passwordHash });

    return this.createSession(user, true, context);
  }

  async login(email: string, pass: string, rememberMe = false, context?: SessionContext) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Defense against user enumeration: still perform a bcrypt comparison on
      // a dummy hash so the response time does not leak existence.
      await bcrypt.compare(pass, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
      throw new UnauthorizedException('Invalid credentials');
    }
    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isTwoFactorEnabled) {
      return { isTwoFactorRequired: true, temp_token: this.generateTemp2FAToken(user) };
    }

    return this.createSession(user, rememberMe, context);
  }

  generateTemp2FAToken(user: any) {
    const jti = crypto.randomUUID();
    const payload = { sub: user.id, isTemp2FA: true, jti };
    return this.jwtService.sign(payload, {
      secret: getAccessTokenSecret(),
      expiresIn: '5m',
    });
  }

  verifyTempToken(token: string) {
    const payload = this.jwtService.verify(token, { secret: getAccessTokenSecret() });
    if (!payload?.isTemp2FA || !payload.jti) {
      throw new UnauthorizedException('Invalid token type');
    }
    // Single-use enforcement. We GC entries opportunistically.
    this.gcUsedTempTokens();
    if (this.usedTempTokens.has(payload.jti)) {
      throw new UnauthorizedException('Temporary token already used');
    }
    return payload;
  }

  consumeTempToken(jti: string, exp: number | undefined): void {
    const ttlMs = (exp ? exp * 1000 : Date.now() + 5 * 60 * 1000) - Date.now();
    this.usedTempTokens.set(jti, Date.now() + Math.max(ttlMs, 0));
  }

  private gcUsedTempTokens(): void {
    const now = Date.now();
    for (const [jti, exp] of this.usedTempTokens) {
      if (exp <= now) this.usedTempTokens.delete(jti);
    }
  }

  async createSession(user: any, rememberMe = false, context?: SessionContext): Promise<SessionTokens> {
    const session = await this.usersService.createAuthSession({
      user,
      refreshTokenHash: '',
      expiresAt: new Date(Date.now() + this.getRefreshTokenTtlMs(rememberMe)),
      rememberMe,
      userAgent: context?.userAgent || undefined,
      ipAddress: context?.ipAddress || undefined,
      lastSeenAt: new Date(),
    });
    const accessToken = this.signAccessToken(user, session.id);
    const refreshToken = this.signRefreshToken(user.id, session.id, rememberMe);
    await this.storeRefreshToken(session.id, refreshToken, rememberMe, context);

    // Fire-and-forget: warn the user by email if this (UA, IP /24) combo
    // has never been seen before. The service handles missing SMTP accounts
    // silently and never rejects, so login flow is unaffected.
    if (context) {
      this.securityNotificationService.notifyIfNewDevice(user, context, session.id);
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      rememberMe,
    };
  }

  async refreshSession(refreshToken: string): Promise<SessionTokens> {
    const payload = this.verifyRefreshToken(refreshToken);
    const session = await this.usersService.findAuthSessionById(payload.sid);
    const user = await this.usersService.findById(payload.sub);
    if (!user || !session || !session.refreshTokenHash || session.revokedAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.user.id !== user.id) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.usersService.revokeAuthSession(session.id);
      throw new UnauthorizedException('Refresh token expired');
    }

    const matches = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!matches) {
      // Token reuse on a rotated refresh token ⇒ likely theft, revoke session.
      await this.usersService.revokeAuthSession(session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const accessToken = this.signAccessToken(user, session.id);
    const nextRememberMe = !!payload.rememberMe;
    const nextRefreshToken = this.signRefreshToken(user.id, session.id, nextRememberMe);
    await this.storeRefreshToken(session.id, nextRefreshToken, nextRememberMe);

    return {
      access_token: accessToken,
      refresh_token: nextRefreshToken,
      rememberMe: nextRememberMe,
    };
  }

  async revokeSession(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;

    try {
      const payload = this.verifyRefreshToken(refreshToken);
      await this.usersService.revokeAuthSession(payload.sid);
    } catch {
      // Ignore invalid refresh tokens during logout and just clear the cookie.
    }
  }

  async listActiveSessions(userId: string, currentSessionId?: string): Promise<ActiveSessionInfo[]> {
    const sessions = await this.usersService.findActiveAuthSessionsByUser(userId);
    return sessions.map((session) => this.toActiveSessionInfo(session, currentSessionId));
  }

  async revokeSessionById(userId: string, sessionId: string): Promise<void> {
    const session = await this.usersService.findAuthSessionById(sessionId);
    if (!session || session.user.id !== userId || session.revokedAt) {
      throw new UnauthorizedException('Session introuvable');
    }
    await this.usersService.revokeAuthSession(sessionId);
  }

  async revokeOtherSessions(userId: string, currentSessionId: string): Promise<void> {
    await this.usersService.revokeOtherAuthSessions(userId, currentSessionId);
  }

  generateToken(user: any, context?: SessionContext) {
    return this.createSession(user, true, context);
  }

  async generateTwoFactorSecret(user: any) {
    const secret = this.totp.generateSecret();
    const { rpName } = getWebAuthnConfig();
    const otpauthUrl = this.totp.toURI({ issuer: rpName, label: user.email, secret });
    await this.usersService.update(user.id, { twoFactorSecret: secret });

    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);
    return {
      secret,
      otpauthUrl,
      qrCodeDataUrl,
    };
  }

  async turnOnTwoFactorAuthentication(userId: string, isCodeValid: boolean) {
    if (isCodeValid) {
      await this.usersService.update(userId, { isTwoFactorEnabled: true });
    } else {
      throw new UnauthorizedException('Invalid 2FA code');
    }
  }

  async verifyTwoFactorCode(userId: string, code: string): Promise<boolean> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.twoFactorSecret) {
      throw new UnauthorizedException('Invalid user or 2FA not enabled');
    }

    const result = await this.totp.verify(code, { secret: user.twoFactorSecret });

    if (!result.valid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    // Replay protection within the same step.
    this.gcRecentTotpCodes();
    const last = this.lastTotpByUser.get(userId);
    if (last && last.code === code && Date.now() - last.at < AuthService.TOTP_STEP_MS) {
      throw new UnauthorizedException('2FA code already used');
    }
    this.lastTotpByUser.set(userId, { code, at: Date.now() });

    return true;
  }

  private gcRecentTotpCodes(): void {
    const now = Date.now();
    for (const [user, entry] of this.lastTotpByUser) {
      if (now - entry.at > AuthService.TOTP_STEP_MS * 2) {
        this.lastTotpByUser.delete(user);
      }
    }
  }

  // --- WebAuthn / Passkeys ---

  async generateWebAuthnRegistrationOptions(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new BadRequestException('User not found');

    const userPasskeys = await this.usersService.findCredentialsByUser(userId);
    const { rpName, rpID } = getWebAuthnConfig();

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(user.id),
      userName: user.email,
      attestationType: 'none',
      excludeCredentials: userPasskeys.map(passkey => ({
        id: passkey.id,
        type: 'public-key',
        transports: passkey.transports as any,
      })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'preferred',
      },
    });

    await this.usersService.update(userId, { currentChallenge: options.challenge });

    return options;
  }

  async verifyWebAuthnRegistration(userId: string, body: any) {
    const user = await this.usersService.findById(userId);
    if (!user || !user.currentChallenge) {
      throw new BadRequestException('No active challenge');
    }

    const { rpID, origins } = getWebAuthnConfig();

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: user.currentChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
      });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }

    if (verification.verified && verification.registrationInfo) {
      const credential = verification.registrationInfo.credential;

      await this.usersService.saveCredential({
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: body.response.transports || [],
        user,
      });

      await this.usersService.update(userId, { currentChallenge: undefined });
      return { verified: true };
    }

    return { verified: false };
  }

  async generateWebAuthnLoginOptions(email?: string) {
    const { rpID } = getWebAuthnConfig();

    // Classic flow: an email is provided. We scope the allowCredentials to
    // that user and store the challenge on the user record (legacy passkeys
    // that were registered without resident key still work).
    if (email) {
      const user = await this.usersService.findByEmail(email);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      const userPasskeys = await this.usersService.findCredentialsByUser(user.id);

      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: userPasskeys.map(passkey => ({
          id: passkey.id,
          type: 'public-key',
          transports: passkey.transports as any,
        })),
        userVerification: 'preferred',
      });

      await this.usersService.update(user.id, { currentChallenge: options.challenge });

      return options;
    }

    // Usernameless flow: no email. The browser will offer the user any
    // discoverable credential (resident key) registered for this RP and
    // return the associated userHandle in the assertion.
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: [],
      userVerification: 'preferred',
    });

    this.rememberDiscoverableChallenge(options.challenge);
    return options;
  }

  async verifyWebAuthnLogin(email: string | undefined, body: any, rememberMe = false, context?: SessionContext) {
    if (email) {
      return this.verifyWebAuthnLoginWithEmail(email, body, rememberMe, context);
    }
    return this.verifyWebAuthnLoginUsernameless(body, rememberMe, context);
  }

  private async verifyWebAuthnLoginWithEmail(email: string, body: any, rememberMe: boolean, context?: SessionContext) {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.currentChallenge) {
      throw new BadRequestException('No active challenge');
    }

    const userPasskeys = await this.usersService.findCredentialsByUser(user.id);
    const passkey = userPasskeys.find(p => p.id === body.id);

    if (!passkey) {
      throw new BadRequestException('Could not find matching passkey');
    }

    const { rpID, origins } = getWebAuthnConfig();

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: user.currentChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        credential: {
          id: passkey.id,
          publicKey: Buffer.from(passkey.publicKey, 'base64url'),
          counter: passkey.counter,
          transports: passkey.transports as any,
        },
      });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }

    if (verification.verified && verification.authenticationInfo) {
      const { newCounter } = verification.authenticationInfo;
      await this.usersService.updateCredentialCounter(passkey.id, newCounter);
      await this.usersService.update(user.id, { currentChallenge: undefined });

      if (user.isTwoFactorEnabled) {
        return { isTwoFactorRequired: true, temp_token: this.generateTemp2FAToken(user) };
      }

        return this.createSession(user, rememberMe, context);
    }

    throw new UnauthorizedException('Passkey verification failed');
  }

  private async verifyWebAuthnLoginUsernameless(body: any, rememberMe: boolean, context?: SessionContext) {
    const expectedChallenge = this.extractChallengeFromClientData(body?.response?.clientDataJSON);
    if (!expectedChallenge || !this.consumeDiscoverableChallenge(expectedChallenge)) {
      throw new BadRequestException('No active challenge');
    }

    const passkey = await this.usersService.findCredentialById(body.id);
    if (!passkey || !passkey.user) {
      throw new BadRequestException('Could not find matching passkey');
    }

    const user = passkey.user;
    const { rpID, origins } = getWebAuthnConfig();

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        credential: {
          id: passkey.id,
          publicKey: Buffer.from(passkey.publicKey, 'base64url'),
          counter: passkey.counter,
          transports: passkey.transports as any,
        },
      });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }

    if (verification.verified && verification.authenticationInfo) {
      const { newCounter } = verification.authenticationInfo;
      await this.usersService.updateCredentialCounter(passkey.id, newCounter);

      if (user.isTwoFactorEnabled) {
        return { isTwoFactorRequired: true, temp_token: this.generateTemp2FAToken(user) };
      }

        return this.createSession(user, rememberMe, context);
    }

    throw new UnauthorizedException('Passkey verification failed');
  }

  private rememberDiscoverableChallenge(challenge: string): void {
    const now = Date.now();
    // Opportunistic cleanup of expired entries.
    for (const [key, issuedAt] of this.pendingDiscoverableChallenges) {
      if (now - issuedAt > AuthService.DISCOVERABLE_CHALLENGE_TTL_MS) {
        this.pendingDiscoverableChallenges.delete(key);
      }
    }
    this.pendingDiscoverableChallenges.set(challenge, now);
  }

  private consumeDiscoverableChallenge(challenge: string): boolean {
    const issuedAt = this.pendingDiscoverableChallenges.get(challenge);
    if (issuedAt === undefined) {
      return false;
    }
    this.pendingDiscoverableChallenges.delete(challenge);
    return Date.now() - issuedAt <= AuthService.DISCOVERABLE_CHALLENGE_TTL_MS;
  }

  private extractChallengeFromClientData(clientDataJSON: unknown): string | null {
    if (typeof clientDataJSON !== 'string' || clientDataJSON.length === 0) {
      return null;
    }
    try {
      const decoded = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded) as { challenge?: unknown };
      return typeof parsed.challenge === 'string' ? parsed.challenge : null;
    } catch {
      return null;
    }
  }

  private signAccessToken(user: any, sessionId: string): string {
    const payload = { email: user.email, sub: user.id, sid: sessionId, type: 'access' };
    return this.jwtService.sign(payload, {
      secret: getAccessTokenSecret(),
      expiresIn: AuthService.ACCESS_TOKEN_TTL,
    });
  }

  private signRefreshToken(userId: string, sessionId: string, rememberMe: boolean): string {
    const payload = { sub: userId, sid: sessionId, type: 'refresh', rememberMe };
    return this.jwtService.sign(payload, {
      secret: getRefreshTokenSecret(),
      expiresIn: `${this.getRefreshTokenTtlMs(rememberMe)}ms`,
    });
  }

  private verifyRefreshToken(refreshToken: string): { sub: string; sid: string; type: string; rememberMe?: boolean } {
    const payload = this.jwtService.verify(refreshToken, {
      secret: getRefreshTokenSecret(),
    }) as { sub: string; sid: string; type: string; rememberMe?: boolean };

    if (payload.type !== 'refresh' || !payload.sid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return payload;
  }

  private async storeRefreshToken(
    sessionId: string,
    refreshToken: string,
    rememberMe: boolean,
    context?: SessionContext,
  ): Promise<void> {
    const payload = this.verifyRefreshToken(refreshToken);
    const refreshTokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + this.getRefreshTokenTtlMs(rememberMe));

    await this.usersService.updateAuthSession(sessionId, {
      refreshTokenHash,
      expiresAt,
      rememberMe: !!payload.rememberMe,
      lastSeenAt: new Date(),
      ...(context?.userAgent ? { userAgent: context.userAgent } : {}),
      ...(context?.ipAddress ? { ipAddress: context.ipAddress } : {}),
    });
  }

  private getRefreshTokenTtlMs(rememberMe: boolean): number {
    return rememberMe
      ? AuthService.PERSISTENT_REFRESH_TOKEN_TTL_MS
      : AuthService.SESSION_REFRESH_TOKEN_TTL_MS;
  }

  private toActiveSessionInfo(session: AuthSession, currentSessionId?: string): ActiveSessionInfo {
    return {
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt ? new Date(session.lastSeenAt).toISOString() : null,
      expiresAt: new Date(session.expiresAt).toISOString(),
      rememberMe: !!session.rememberMe,
      userAgent: session.userAgent || null,
      ipAddress: session.ipAddress || null,
      isCurrent: session.id === currentSessionId,
    };
  }
}
