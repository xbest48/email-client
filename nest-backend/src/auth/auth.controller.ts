import { Controller, Post, Body, Get, UseGuards, Request, UnauthorizedException, Req, Res, Param } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { encrypt } from '../users/crypto.util';

@Controller('api/auth')
export class AuthController {
  private static readonly REFRESH_COOKIE_NAME = 'refresh_token';

  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post('register')
  async register(@Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const session = await this.authService.register(body.email, body.password, this.getSessionContext(req));
    this.setRefreshCookie(res, session.refresh_token, true);
    return { access_token: session.access_token };
  }

  @Post('login')
  async login(@Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
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

  @Post('2fa/authenticate')
  async authenticate2FA(
    @Body() body: { tempToken: string; code: string; rememberMe?: boolean },
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    // We decode and verify the temporary token here
    let payload;
    try {
      payload = this.authService.verifyTempToken(body.tempToken);
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired temporary token');
    }

    if (!payload.isTemp2FA) {
      throw new UnauthorizedException('Invalid token type');
    }

    const userId = payload.sub;

    const isCodeValid = await this.authService.verifyTwoFactorCode(userId, body.code);
    if (!isCodeValid) {
       throw new UnauthorizedException('Invalid 2FA code');
    }
    const user = await this.usersService.findById(userId);
    const session = await this.authService.createSession(user, !!body.rememberMe, this.getSessionContext(req));
    this.setRefreshCookie(res, session.refresh_token, !!body.rememberMe);
    return { access_token: session.access_token };
  }

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

  @UseGuards(JwtAuthGuard)
  @Post('2fa/turn-on')
  async turnOn2FA(@Request() req: any, @Body() body: { code: string }) {
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
      imageAllowedDomains: JSON.parse(user.imageAllowedDomains || '[]'),
      imageBlockedDomains: JSON.parse(user.imageBlockedDomains || '[]'),
      hasAiApiKey: !!(user.aiApiKey || user.openAiApiKey),
      hasOpenAiApiKey: !!(user.aiApiKey || user.openAiApiKey),
      aiProvider: user.aiProvider || 'openai',
      aiApiUrl: user.aiApiUrl || '',
      isAiEnabled: user.isAiEnabled,
      hideAiHints: user.hideAiHints,
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
    } = body;
    const updateData: any = { darkMode, undoSendDelay, blockTrackingPixels };
    if (imagePolicy !== undefined) updateData.imagePolicy = imagePolicy;
    if (imageAllowedDomains !== undefined) updateData.imageAllowedDomains = JSON.stringify(imageAllowedDomains);
    if (imageBlockedDomains !== undefined) updateData.imageBlockedDomains = JSON.stringify(imageBlockedDomains);
    const rawApiKey = aiApiKey !== undefined ? aiApiKey : openAiApiKey;
    if (rawApiKey !== undefined) {
      const trimmed = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';
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

  @Post('webauthn/login/generate-options')
  async generateWebAuthnLoginOptions(@Body() body: { email?: string }) {
    return this.authService.generateWebAuthnLoginOptions(body?.email);
  }

  @Post('webauthn/login/verify')
  async verifyWebAuthnLogin(
    @Body() body: { email?: string; response: any; rememberMe?: boolean },
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
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/api/auth',
        ...(rememberMe ? { maxAge: AuthService.PERSISTENT_REFRESH_TOKEN_TTL_MS } : {}),
      },
    );
  }

  private clearRefreshCookie(res: any): void {
    res.clearCookie(AuthController.REFRESH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
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
}
