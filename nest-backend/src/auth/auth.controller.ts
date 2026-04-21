import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  UnauthorizedException,
  Req,
  Res,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { encrypt } from '../users/crypto.util';
import { IS_PROD } from './auth.config';
import {
  LoginDto,
  RegisterDto,
  TwoFactorAuthenticateDto,
  TwoFactorCodeDto,
  WebAuthnLoginOptionsDto,
  WebAuthnLoginVerifyDto,
} from './dto/auth.dto';

@Controller('api/auth')
export class AuthController {
  private static readonly REFRESH_COOKIE_NAME = 'refresh_token';

  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body() body: RegisterDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const session = await this.authService.register(body.email, body.password, this.getSessionContext(req));
    this.setRefreshCookie(res, session.refresh_token, true);
    return { access_token: session.access_token };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(@Body() body: LoginDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const result = await this.authService.login(
      body.email,
      body.password,
      !!body.rememberMe,
      this.getSessionContext(req),
    );
    if ('access_token' in result && 'refresh_token' in result) {
      this.setRefreshCookie(res, result.refresh_token, !!body.rememberMe);
      return { access_token: result.access_token };
    }
    return result;
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/authenticate')
  async authenticate2FA(
    @Body() body: TwoFactorAuthenticateDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    let payload: any;
    try {
      payload = this.authService.verifyTempToken(body.tempToken);
    } catch (e: any) {
      throw new UnauthorizedException(e?.message || 'Invalid or expired temporary token');
    }

    const userId = payload.sub;
    try {
      await this.authService.verifyTwoFactorCode(userId, body.code);
    } finally {
      // The temp token is now consumed regardless of the 2FA outcome to
      // prevent brute force against the same temp token.
      this.authService.consumeTempToken(payload.jti, payload.exp);
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const session = await this.authService.createSession(user, !!body.rememberMe, this.getSessionContext(req));
    this.setRefreshCookie(res, session.refresh_token, !!body.rememberMe);
    return { access_token: session.access_token };
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const refreshToken = this.readRefreshCookie(req);
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const session = await this.authService.refreshSession(refreshToken);
    this.setRefreshCookie(res, session.refresh_token, session.rememberMe);
    return { access_token: session.access_token };
  }

  @SkipThrottle()
  @Post('logout')
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.authService.revokeSession(this.readRefreshCookie(req) ?? undefined);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async getSessions(@Request() req: any) {
    return this.authService.listActiveSessions(req.user.id, req.user.sid);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-others')
  async revokeOtherSessions(@Request() req: any) {
    await this.authService.revokeOtherSessions(req.user.id, req.user.sid);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/:sessionId/revoke')
  async revokeSessionById(@Request() req: any, @Param('sessionId') sessionId: string) {
    await this.authService.revokeSessionById(req.user.id, sessionId);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/generate')
  async generate2FA(@Request() req: any) {
    return this.authService.generateTwoFactorSecret(req.user);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post('2fa/turn-on')
  async turnOn2FA(@Request() req: any, @Body() body: TwoFactorCodeDto) {
    const isCodeValid = await this.authService.verifyTwoFactorCode(req.user.id, body.code);
    await this.authService.turnOnTwoFactorAuthentication(req.user.id, isCodeValid);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req: any) {
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      return req.user;
    }
    return {
      id: user.id,
      email: user.email,
      darkMode: user.darkMode,
      undoSendDelay: user.undoSendDelay,
      blockTrackingPixels: user.blockTrackingPixels,
      imagePolicy: user.imagePolicy || 'ask',
      imageAllowedDomains: this.safeJsonParse(user.imageAllowedDomains),
      imageBlockedDomains: this.safeJsonParse(user.imageBlockedDomains),
      hasAiApiKey: !!(user.aiApiKey || user.openAiApiKey),
      hasOpenAiApiKey: !!(user.aiApiKey || user.openAiApiKey),
      aiProvider: user.aiProvider || 'openai',
      aiApiUrl: user.aiApiUrl || '',
      isAiEnabled: user.isAiEnabled,
      hideAiHints: user.hideAiHints,
      desktopNotificationsEnabled: user.desktopNotificationsEnabled ?? true,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('profile/settings')
  async updateSettings(@Request() req: any, @Body() body: any) {
    const {
      darkMode,
      undoSendDelay,
      blockTrackingPixels,
      imagePolicy,
      imageAllowedDomains,
      imageBlockedDomains,
      aiApiKey,
      openAiApiKey,
      aiProvider,
      aiApiUrl,
      isAiEnabled,
      hideAiHints,
      desktopNotificationsEnabled,
    } = body;
    const updateData: any = { darkMode, undoSendDelay, blockTrackingPixels };
    if (imagePolicy !== undefined) updateData.imagePolicy = imagePolicy;
    if (imageAllowedDomains !== undefined) updateData.imageAllowedDomains = JSON.stringify(imageAllowedDomains);
    if (imageBlockedDomains !== undefined) updateData.imageBlockedDomains = JSON.stringify(imageBlockedDomains);
    const rawApiKey = aiApiKey !== undefined ? aiApiKey : openAiApiKey;
    if (rawApiKey !== undefined) {
      const trimmed = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';
      if (trimmed && trimmed.length > 512) {
        throw new BadRequestException('API key too long');
      }
      updateData.aiApiKey = trimmed ? encrypt(trimmed) : null;
      updateData.openAiApiKey = trimmed ? encrypt(trimmed) : null;
      if (!trimmed) {
        updateData.isAiEnabled = false;
      }
    }
    if (aiProvider !== undefined) updateData.aiProvider = aiProvider;
    if (aiApiUrl !== undefined) updateData.aiApiUrl = typeof aiApiUrl === 'string' ? aiApiUrl.trim() : null;
    if (isAiEnabled !== undefined && updateData.isAiEnabled === undefined) {
      updateData.isAiEnabled = !!isAiEnabled;
    }
    if (hideAiHints !== undefined) updateData.hideAiHints = !!hideAiHints;
    if (desktopNotificationsEnabled !== undefined) updateData.desktopNotificationsEnabled = !!desktopNotificationsEnabled;
    await this.usersService.update(req.user.id, updateData);
    return { success: true };
  }

  // --- WebAuthn ---

  @UseGuards(JwtAuthGuard)
  @Get('webauthn/register/generate-options')
  async generateWebAuthnRegisterOptions(@Request() req: any) {
    return this.authService.generateWebAuthnRegistrationOptions(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('webauthn/register/verify')
  async verifyWebAuthnRegister(@Request() req: any, @Body() body: any) {
    return this.authService.verifyWebAuthnRegistration(req.user.id, body);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('webauthn/login/generate-options')
  async generateWebAuthnLoginOptions(@Body() body: WebAuthnLoginOptionsDto) {
    return this.authService.generateWebAuthnLoginOptions(body?.email);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('webauthn/login/verify')
  async verifyWebAuthnLogin(
    @Body() body: WebAuthnLoginVerifyDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await this.authService.verifyWebAuthnLogin(
      body?.email,
      body.response,
      !!body.rememberMe,
      this.getSessionContext(req),
    );
    if ('access_token' in result && 'refresh_token' in result) {
      this.setRefreshCookie(res, result.refresh_token, !!body.rememberMe);
      return { access_token: result.access_token };
    }
    return result;
  }

  private readRefreshCookie(req: any): string | null {
    // Prefer cookie-parser's req.cookies; fall back to manual parsing for safety.
    if (req?.cookies && typeof req.cookies === 'object') {
      const v = req.cookies[AuthController.REFRESH_COOKIE_NAME];
      if (typeof v === 'string' && v.length > 0) return v;
    }

    const cookieHeader = req?.headers?.cookie;
    if (!cookieHeader || typeof cookieHeader !== 'string') return null;

    const cookies = cookieHeader.split(';');
    for (const cookie of cookies) {
      const [rawName, ...rest] = cookie.trim().split('=');
      if (rawName === AuthController.REFRESH_COOKIE_NAME) {
        return decodeURIComponent(rest.join('='));
      }
    }

    return null;
  }

  private setRefreshCookie(res: any, refreshToken: string, rememberMe: boolean): void {
    res.cookie(
      AuthController.REFRESH_COOKIE_NAME,
      refreshToken,
      {
        httpOnly: true,
        // Strict: the refresh cookie is never sent on cross-site navigations,
        // blocking CSRF against /api/auth/refresh.
        sameSite: 'strict',
        secure: IS_PROD,
        path: '/api/auth',
        ...(rememberMe ? { maxAge: AuthService.PERSISTENT_REFRESH_TOKEN_TTL_MS } : {}),
      },
    );
  }

  private clearRefreshCookie(res: any): void {
    res.clearCookie(AuthController.REFRESH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'strict',
      secure: IS_PROD,
      path: '/api/auth',
    });
  }

  private getSessionContext(req: any): { userAgent?: string; ipAddress?: string } {
    const forwardedFor = req?.headers?.['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return {
      userAgent: req?.headers?.['user-agent'],
      ipAddress: typeof forwardedIp === 'string'
        ? forwardedIp.split(',')[0].trim()
        : req?.ip,
    };
  }

  private safeJsonParse(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
