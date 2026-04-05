import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcryptjs';
import { TOTP, generateSecret } from 'otplib';
import * as qrcode from 'qrcode';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

const rpName = 'MailFlow';
const rpID = 'localhost';
const origin = `http://${rpID}:4200`;

@Injectable()
export class AuthService {
  private readonly totp: TOTP;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {
    this.totp = new TOTP();
  }

  async register(email: string, pass: string) {
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new BadRequestException('User already exists');
    }
    const passwordHash = await bcrypt.hash(pass, 10);
    const user = await this.usersService.create({ email, passwordHash });

    return this.generateToken(user);
  }

  async login(email: string, pass: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isTwoFactorEnabled) {
      return { isTwoFactorRequired: true, temp_token: this.generateTemp2FAToken(user) };
    }

    return this.generateToken(user);
  }

  generateTemp2FAToken(user: any) {
    const payload = { sub: user.id, isTemp2FA: true };
    return this.jwtService.sign(payload, { expiresIn: '5m' });
  }

  verifyTempToken(token: string) {
    return this.jwtService.verify(token);
  }

  generateToken(user: any) {
    const payload = { email: user.email, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async generateTwoFactorSecret(user: any) {
    const { authenticator } = require('otplib');
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, rpName, secret);
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

    const { authenticator } = require('otplib');
    const isCodeValid = authenticator.check(code, user.twoFactorSecret);

    if (!isCodeValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    return isCodeValid;
  }

  // --- WebAuthn / Passkeys ---

  async generateWebAuthnRegistrationOptions(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new BadRequestException('User not found');

    const userPasskeys = await this.usersService.findCredentialsByUser(userId);

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
        residentKey: 'preferred',
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

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: user.currentChallenge,
        expectedOrigin: origin,
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

  async generateWebAuthnLoginOptions(email: string) {
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

  async verifyWebAuthnLogin(email: string, body: any) {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.currentChallenge) {
      throw new BadRequestException('No active challenge');
    }

    const userPasskeys = await this.usersService.findCredentialsByUser(user.id);
    const passkey = userPasskeys.find(p => p.id === body.id);

    if (!passkey) {
      throw new BadRequestException('Could not find matching passkey');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: user.currentChallenge,
        expectedOrigin: origin,
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

      return this.generateToken(user);
    }

    throw new UnauthorizedException('Passkey verification failed');
  }
}
