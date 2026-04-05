import { Entity, Column, PrimaryColumn, ManyToOne } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class WebAuthnCredential {
  @PrimaryColumn()
  id: string; // The base64url encoded credential ID

  @Column({ type: 'text' })
  publicKey: string; // Base64url encoded public key

  @Column()
  counter: number;

  @Column('simple-array', { nullable: true })
  transports?: string[]; // Authenticator transports ('usb', 'ble', 'nfc', 'internal')

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}
