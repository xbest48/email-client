import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { WebAuthnCredential } from './webauthn-credential.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(WebAuthnCredential)
    private credentialsRepository: Repository<WebAuthnCredential>,
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
}
