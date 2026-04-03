import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthController', () => {
  let controller: AuthController;
  let mockUsersService: any;

  beforeEach(async () => {
    mockUsersService = {
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should call update with correct properties', async () => {
    await controller.updateSettings({ user: { id: 'test-id' } }, { darkMode: true, undoSendDelay: 5, blockTrackingPixels: true });
    expect(mockUsersService.update).toHaveBeenCalledWith('test-id', { darkMode: true, undoSendDelay: 5, blockTrackingPixels: true });
  });
});
