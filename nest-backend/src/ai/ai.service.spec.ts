import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from '../users/users.service';
import { EmailAiInsight } from './email-ai-insight.entity';

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: UsersService,
          useValue: {},
        },
        { provide: getRepositoryToken(EmailAiInsight), useValue: {} },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
