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
  async authenticate2FA(@Body() body: { userId: string; code: string }) {
    await this.authService.verifyTwoFactorCode(body.userId, body.code);
    const user = await this.usersService.findById(body.userId);
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
  getProfile(@Request() req: any) {
    return req.user;
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
