import { Injectable, signal } from '@angular/core';

export interface PgpKeyPair {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

export interface PgpContact {
  email: string;
  publicKey: string;
}

const PGP_KEYS_STORAGE = 'mailflow_pgp_keys';
const PGP_CONTACTS_STORAGE = 'mailflow_pgp_contacts';

@Injectable({ providedIn: 'root' })
export class PgpService {
  readonly keyPair = signal<PgpKeyPair | null>(this.loadKeyPair());
  readonly contacts = signal<PgpContact[]>(this.loadContacts());
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
    this.saveKeyPair(kp);
    return kp;
  }

  importPublicKey(email: string, publicKey: string): void {
    const contacts = [...this.contacts()];
    const existing = contacts.findIndex((c) => c.email === email);
    if (existing >= 0) {
      contacts[existing] = { email, publicKey };
    } else {
      contacts.push({ email, publicKey });
    }
    this.contacts.set(contacts);
    this.saveContacts(contacts);
  }

  removeContactKey(email: string): void {
    const contacts = this.contacts().filter((c) => c.email !== email);
    this.contacts.set(contacts);
    this.saveContacts(contacts);
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

  private loadKeyPair(): PgpKeyPair | null {
    try {
      const stored = localStorage.getItem(PGP_KEYS_STORAGE);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  private saveKeyPair(kp: PgpKeyPair): void {
    localStorage.setItem(PGP_KEYS_STORAGE, JSON.stringify(kp));
  }

  private loadContacts(): PgpContact[] {
    try {
      const stored = localStorage.getItem(PGP_CONTACTS_STORAGE);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private saveContacts(contacts: PgpContact[]): void {
    localStorage.setItem(PGP_CONTACTS_STORAGE, JSON.stringify(contacts));
  }
}
