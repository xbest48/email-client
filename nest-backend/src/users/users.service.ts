import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Not, Repository } from 'typeorm';
import { User } from './user.entity';
import { WebAuthnCredential } from './webauthn-credential.entity';
import { AuthSession } from './auth-session.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(WebAuthnCredential)
    private credentialsRepository: Repository<WebAuthnCredential>,
    @InjectRepository(AuthSession)
    private authSessionsRepository: Repository<AuthSession>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  async create(user: Partial<User>): Promise<User> {
    const newUser = this.usersRepository.create(user);
    return this.usersRepository.save(newUser);
  }

  async update(id: string, partial: Partial<User>): Promise<void> {
    await this.usersRepository.update(id, partial);
  }

  async saveCredential(credential: Partial<WebAuthnCredential>): Promise<WebAuthnCredential> {
    const newCred = this.credentialsRepository.create(credential);
    return this.credentialsRepository.save(newCred);
  }

  async findCredentialsByUser(userId: string): Promise<WebAuthnCredential[]> {
    return this.credentialsRepository.find({ where: { user: { id: userId } } });
  }

  async findCredentialById(id: string): Promise<WebAuthnCredential | null> {
    return this.credentialsRepository.findOne({
      where: { id },
      relations: ['user'],
    });
  }

  async updateCredentialCounter(credentialId: string, counter: number): Promise<void> {
    await this.credentialsRepository.update(credentialId, { counter });
  }

  async createAuthSession(session: Partial<AuthSession>): Promise<AuthSession> {
    const newSession = this.authSessionsRepository.create(session);
    return this.authSessionsRepository.save(newSession);
  }

  async findAuthSessionById(id: string): Promise<AuthSession | null> {
    return this.authSessionsRepository.findOne({
      where: { id },
      relations: ['user'],
    });
  }

  async findActiveAuthSessionsByUser(userId: string): Promise<AuthSession[]> {
    return this.authSessionsRepository.find({
      where: {
        user: { id: userId },
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { lastSeenAt: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * Returns every session ever created for a user (including revoked/expired).
   * Used by the new-device detection: an already-known device is one we've
   * seen on any prior session for this user, regardless of its current state.
   */
  async findAllAuthSessionsByUser(userId: string): Promise<AuthSession[]> {
    return this.authSessionsRepository.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
    });
  }

  async updateAuthSession(id: string, partial: Partial<AuthSession>): Promise<void> {
    await this.authSessionsRepository.update(id, partial);
  }

  async revokeAuthSession(id: string): Promise<void> {
    await this.authSessionsRepository.update(id, { revokedAt: new Date() });
  }

  async revokeOtherAuthSessions(userId: string, currentSessionId: string): Promise<void> {
    await this.authSessionsRepository.update(
      {
        user: { id: userId },
        id: Not(currentSessionId),
        revokedAt: IsNull(),
      },
      { revokedAt: new Date() },
    );
  }
}
