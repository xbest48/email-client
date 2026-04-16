jest.mock('./auth.service', () => ({
  AuthService: class AuthService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { decrypt } from '../users/crypto.util';

describe('AuthController', () => {
  let controller: AuthController;
  let usersService: { update: jest.Mock };

  beforeEach(async () => {
    usersService = {
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {},
        },
        {
          provide: UsersService,
          useValue: usersService,
        }
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should encrypt and persist the OpenAI key', async () => {
    await controller.updateSettings(
      { user: { id: 'user-1' } },
      { aiApiKey: 'sk-test-key', aiProvider: 'openai', isAiEnabled: true },
    );

    expect(usersService.update).toHaveBeenCalledTimes(1);
    const [, payload] = usersService.update.mock.calls[0];
    expect(payload.isAiEnabled).toBe(true);
    expect(payload.aiApiKey).not.toBe('sk-test-key');
    expect(decrypt(payload.aiApiKey)).toBe('sk-test-key');
    expect(payload.aiProvider).toBe('openai');
  });

  it('should disable AI when the key is cleared', async () => {
    await controller.updateSettings(
      { user: { id: 'user-1' } },
      { aiApiKey: '', isAiEnabled: true },
    );

    const [, payload] = usersService.update.mock.calls[0];
    expect(payload.aiApiKey).toBeNull();
    expect(payload.isAiEnabled).toBe(false);
  });
});
