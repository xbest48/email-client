import { Test, TestingModule } from '@nestjs/testing';
import { SmtpService } from './smtp.service';
import { EmailCredentials } from '../imap/imap.service';

describe('SmtpService', () => {
  let service: SmtpService;
  const credentials: EmailCredentials = {
    email: 'sender@example.com',
    password: 'secret',
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    imapHost: 'imap.example.com',
    imapPort: 993,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SmtpService],
    }).compile();

    service = module.get<SmtpService>(SmtpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('converts data URI img tags into related CID attachments in raw messages', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('hello world').toString('base64')}`;
    const raw = await service.buildRawMessage(credentials, {
      to: 'recipient@example.com',
      subject: 'Test',
      html: `<p>Bonjour</p><img src="${dataUrl}" alt="logo">`,
    });

    expect(raw).toBeTruthy();

    const source = raw!.toString();
    expect(source).toContain('Content-Type: multipart/related;');
    expect(source).toContain('src="cid:');
    expect(source).toContain('Content-ID: <');
    expect(source).not.toContain(dataUrl);
  });

  it('converts CSS data URI images into related CID attachments in raw messages', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('hello world').toString('base64')}`;
    const raw = await service.buildRawMessage(credentials, {
      to: 'recipient@example.com',
      subject: 'Test CSS',
      html: `<div style="background-image:url(${dataUrl})">Bonjour</div>`,
    });

    expect(raw).toBeTruthy();

    const source = raw!.toString();
    expect(source).toContain('Content-Type: multipart/related;');
    expect(source).toContain('background-image:url(cid:');
    expect(source).toContain('Content-ID: <');
    expect(source).not.toContain(dataUrl);
  });
});
