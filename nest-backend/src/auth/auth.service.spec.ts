process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.BCRYPT_ROUNDS = '10';

// ESM-only / unrelated to token rotation: stub them so Jest can load the service.
jest.mock('otplib', () => ({ TOTP: jest.fn(), NobleCryptoPlugin: jest.fn(), ScureBase32Plugin: jest.fn() }));
jest.mock('@simplewebauthn/server', () => ({}));
jest.mock('qrcode', () => ({}));
jest.mock('./security-notification.service', () => ({ SecurityNotificationService: jest.fn() }));

import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService.refreshSession', () => {
  const user = { id: 'user-1', email: 'user@example.test' };
  let session: Record<string, any>;
  let service: AuthService;
  let usersService: Record<string, jest.Mock>;

  beforeEach(() => {
    session = {
      id: 'session-1',
      user,
      refreshTokenHash: '',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: null,
    };
    usersService = {
      findAuthSessionById: jest.fn(async () => session),
      findById: jest.fn(async () => user),
      updateAuthSession: jest.fn(async (_id: string, partial: Record<string, unknown>) => {
        Object.assign(session, partial);
      }),
      revokeAuthSession: jest.fn(async () => {
        session.revokedAt = new Date();
      }),
    };
    service = new AuthService(usersService as any, new JwtService({}), {} as any);
  });

  async function issueInitialToken(): Promise<string> {
    const token = (service as any).signRefreshToken(user.id, session.id, false);
    await (service as any).storeRefreshToken(session.id, token, false);
    return token;
  }

  it('rotates the refresh token', async () => {
    const t0 = await issueInitialToken();
    const { refresh_token: t1 } = await service.refreshSession(t0);
    expect(t1).not.toEqual(t0);
    await expect(service.refreshSession(t1)).resolves.toHaveProperty('access_token');
  });

  it('still accepts sessions stored with the legacy bcrypt hash', async () => {
    const t0 = (service as any).signRefreshToken(user.id, session.id, false);
    session.refreshTokenHash = await bcrypt.hash(t0, 10);
    await expect(service.refreshSession(t0)).resolves.toHaveProperty('access_token');
    expect(session.refreshTokenHash.startsWith('sha256:')).toBe(true);
  });

  it('accepts the previous token once more within the grace window (lost response)', async () => {
    const t0 = await issueInitialToken();
    await service.refreshSession(t0); // response "lost": the browser still has t0
    await expect(service.refreshSession(t0)).resolves.toHaveProperty('access_token');
    expect(usersService.revokeAuthSession).not.toHaveBeenCalled();
  });

  it('revokes the session when an old token is replayed after the grace window', async () => {
    const t0 = await issueInitialToken();
    await service.refreshSession(t0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60 * 1000);
    try {
      await expect(service.refreshSession(t0)).rejects.toBeInstanceOf(UnauthorizedException);
    } finally {
      nowSpy.mockRestore();
    }
    expect(usersService.revokeAuthSession).toHaveBeenCalledWith(session.id);
  });
});
