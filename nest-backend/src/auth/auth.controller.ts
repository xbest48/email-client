import { Controller, Post, Body, Get, UseGuards, Request, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';

@Controller('api/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post('register')
  async register(@Body() body: any) {
    return this.authService.register(body.email, body.password);
  }

  @Post('login')
  async login(@Body() body: any) {
    return this.authService.login(body.email, body.password);
  }

  @Post('2fa/authenticate')
  async authenticate2FA(@Body() body: { tempToken: string; code: string }) {
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
    return this.authService.generateToken(user);
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
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('profile/settings')
  async updateSettings(@Request() req: any, @Body() body: any) {
    const { darkMode, undoSendDelay, blockTrackingPixels, imagePolicy, imageAllowedDomains, imageBlockedDomains } = body;
    const updateData: any = { darkMode, undoSendDelay, blockTrackingPixels };
    if (imagePolicy !== undefined) updateData.imagePolicy = imagePolicy;
    if (imageAllowedDomains !== undefined) updateData.imageAllowedDomains = JSON.stringify(imageAllowedDomains);
    if (imageBlockedDomains !== undefined) updateData.imageBlockedDomains = JSON.stringify(imageBlockedDomains);
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
  async generateWebAuthnLoginOptions(@Body() body: { email: string }) {
    return this.authService.generateWebAuthnLoginOptions(body.email);
  }

  @Post('webauthn/login/verify')
  async verifyWebAuthnLogin(@Body() body: { email: string; response: any }) {
    return this.authService.verifyWebAuthnLogin(body.email, body.response);
  }
}
