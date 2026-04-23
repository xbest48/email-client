/**
 * Centralised, fail-fast loader for authentication-related environment config.
 *
 * Anything that previously defaulted to a hardcoded value (JWT secret,
 * WebAuthn rpID/origin...) is now strictly required in production and
 * generates an explicit warning in development.
 */

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

function required(name: string, value: string | undefined, minLength = 32): string {
  if (!value || value.trim().length < minLength) {
    if (IS_PRODUCTION) {
      throw new Error(
        `${name} environment variable is required (min ${minLength} chars) in production. ` +
          `Generate one with \`openssl rand -hex 32\` and add it to your .env.`,
      );
    }
    // Development-only: print a loud warning. Tests and CLI tooling still work,
    // but the fallback is a random per-process value so nothing leaks across
    // restarts.
    const generated = (globalThis as any).__devFallbackSecrets ?? new Map<string, string>();
    if (!generated.has(name)) {
      const rand = require('crypto').randomBytes(48).toString('hex');
      generated.set(name, rand);
      (globalThis as any).__devFallbackSecrets = generated;
      // eslint-disable-next-line no-console
      console.warn(
        `[auth-config] ${name} is not set. A random dev secret was generated for this process. ` +
          `Set ${name} in your .env to persist sessions across restarts.`,
      );
    }
    return generated.get(name)!;
  }
  return value;
}

export function getAccessTokenSecret(): string {
  return required('JWT_SECRET', process.env.JWT_SECRET);
}

export function getRefreshTokenSecret(): string {
  // Refresh tokens should ideally use a *different* secret so leaking the
  // access-token signing key (e.g. via a compromised JWT verifier) does not
  // invalidate long-lived sessions.
  return required(
    'JWT_REFRESH_SECRET',
    process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET,
  );
}

export const BCRYPT_ROUNDS = (() => {
  const parsed = Number.parseInt(process.env.BCRYPT_ROUNDS ?? '', 10);
  if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 15) return parsed;
  return 12;
})();

export interface WebAuthnConfig {
  rpName: string;
  rpID: string;
  origins: string[];
}

export function getWebAuthnConfig(): WebAuthnConfig {
  const rpName = process.env.WEBAUTHN_RP_NAME || 'KYMA Mail';
  const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
  const originsEnv = process.env.WEBAUTHN_ORIGINS
    || process.env.WEBAUTHN_ORIGIN
    || `http://${rpID}:4200`;
  const origins = originsEnv
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  if (IS_PRODUCTION) {
    if (rpID === 'localhost') {
      throw new Error('WEBAUTHN_RP_ID must be set to your real domain in production.');
    }
    if (origins.some((o) => o.startsWith('http://'))) {
      throw new Error('WEBAUTHN_ORIGINS must use https:// in production.');
    }
  }

  return { rpName, rpID, origins };
}

export function getCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS || 'http://localhost:4200,http://localhost:4000';
  return raw.split(',').map((o) => o.trim()).filter((o) => o.length > 0);
}

export const IS_PROD = IS_PRODUCTION;
