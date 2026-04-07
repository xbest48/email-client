import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export interface PgpKeyPair {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

export interface PgpContact {
  email: string;
  publicKey: string;
}

@Injectable({ providedIn: 'root' })
export class PgpService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly keyPair = signal<PgpKeyPair | null>(null);
  readonly contacts = signal<PgpContact[]>([]);
  readonly available = signal(false);

  private openpgp: any = null;

  constructor() {
    this.loadOpenpgp();
  }

  private async loadOpenpgp(): Promise<void> {
    try {
      this.openpgp = await import('openpgp');
      this.available.set(true);
    } catch {
      this.available.set(false);
    }
  }

  async loadFromServer(): Promise<void> {
    try {
      const kp = await firstValueFrom(
        this.http.get<PgpKeyPair | null>(`${this.apiUrl}/pgp/keys`, { withCredentials: true })
      );
      this.keyPair.set(kp);
    } catch {
      this.keyPair.set(null);
    }
    try {
      const contacts = await firstValueFrom(
        this.http.get<PgpContact[]>(`${this.apiUrl}/pgp/contacts`, { withCredentials: true })
      );
      this.contacts.set(contacts);
    } catch {
      this.contacts.set([]);
    }
  }

  async generateKeyPair(name: string, email: string, passphrase: string): Promise<PgpKeyPair | null> {
    if (!this.openpgp) return null;
    const { generateKey } = this.openpgp;
    const { privateKey, publicKey } = await generateKey({
      type: 'rsa',
      rsaBits: 2048,
      userIDs: [{ name, email }],
      passphrase,
    });

    const parsed = await this.openpgp.readKey({ armoredKey: publicKey });
    const fingerprint = parsed.getFingerprint();

    const kp: PgpKeyPair = { publicKey, privateKey, fingerprint };
    this.keyPair.set(kp);

    // Persist to server
    try {
      await firstValueFrom(
        this.http.post(`${this.apiUrl}/pgp/keys`, kp, { withCredentials: true })
      );
    } catch {
      // Fallback: still usable in memory for this session
    }

    return kp;
  }

  async importPublicKey(email: string, publicKey: string): Promise<void> {
    const contacts = [...this.contacts()];
    const existing = contacts.findIndex((c) => c.email === email);
    if (existing >= 0) {
      contacts[existing] = { email, publicKey };
    } else {
      contacts.push({ email, publicKey });
    }
    this.contacts.set(contacts);

    try {
      await firstValueFrom(
        this.http.post(`${this.apiUrl}/pgp/contacts`, { email, publicKey }, { withCredentials: true })
      );
    } catch {
      // Non-critical
    }
  }

  async removeContactKey(email: string): Promise<void> {
    const contacts = this.contacts().filter((c) => c.email !== email);
    this.contacts.set(contacts);

    try {
      await firstValueFrom(
        this.http.delete(`${this.apiUrl}/pgp/contacts/${encodeURIComponent(email)}`, { withCredentials: true })
      );
    } catch {
      // Non-critical
    }
  }

  async encrypt(text: string, recipientEmail: string): Promise<string | null> {
    if (!this.openpgp) return null;
    const contact = this.contacts().find((c) => c.email === recipientEmail);
    if (!contact) return null;

    const publicKey = await this.openpgp.readKey({ armoredKey: contact.publicKey });
    const encrypted = await this.openpgp.encrypt({
      message: await this.openpgp.createMessage({ text }),
      encryptionKeys: publicKey,
    });
    return encrypted as string;
  }

  async decrypt(encryptedText: string, passphrase: string): Promise<string | null> {
    if (!this.openpgp) return null;
    const kp = this.keyPair();
    if (!kp) return null;

    try {
      const privateKey = await this.openpgp.decryptKey({
        privateKey: await this.openpgp.readPrivateKey({ armoredKey: kp.privateKey }),
        passphrase,
      });

      const message = await this.openpgp.readMessage({ armoredMessage: encryptedText });
      const { data } = await this.openpgp.decrypt({
        message,
        decryptionKeys: privateKey,
      });
      return data as string;
    } catch {
      return null;
    }
  }

  isPgpMessage(text: string): boolean {
    return text?.includes('-----BEGIN PGP MESSAGE-----') || false;
  }
}
