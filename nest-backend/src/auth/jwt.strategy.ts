import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getAccessTokenSecret } from './auth.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getAccessTokenSecret(),
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    sid: string;
    type?: string;
    isTemp2FA?: boolean;
  }) {
    // Reject everything that is not a regular access token. Temp-2FA tokens
    // must never grant access to JwtAuthGuard-protected routes.
    if (payload?.type && payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    if (payload?.isTemp2FA) {
      throw new UnauthorizedException('Invalid token type');
    }
    return { id: payload.sub, email: payload.email, sid: payload.sid };
  }
}
