import { ValueTransformer } from 'typeorm';
import { decrypt, encrypt } from './crypto.util';

function isProbablyCiphertext(value: string): boolean {
  return value.startsWith('v2:') || /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(value);
}

export const encryptedTextTransformer: ValueTransformer = {
  to(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined || value === '') return value;
    if (isProbablyCiphertext(value)) return value;
    return encrypt(value);
  },
  from(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined || value === '') return value;
    if (!isProbablyCiphertext(value)) return value;
    try {
      return decrypt(value);
    } catch {
      return value;
    }
  },
};
