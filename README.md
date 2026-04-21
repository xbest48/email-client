# MailFlow — Email Client

A full-stack IMAP/SMTP email client with Passkeys / WebAuthn authentication,
2FA (TOTP), PGP encryption, AI-assisted reading/writing and per-account
session management.

- **Frontend**: Angular 20+ (standalone components, signals, OnPush)
- **Backend**: NestJS 11 (TypeORM + SQLite, Passport JWT, SimpleWebAuthn)

---

## Quick start

```bash
# 1. Install dependencies
npm install
npm install --prefix nest-backend

# 2. Create your backend configuration
cp nest-backend/.env.example nest-backend/.env
# Fill ENCRYPTION_KEY, JWT_SECRET, JWT_REFRESH_SECRET (see below).

# 3. Run backend and frontend in two terminals
npm --prefix nest-backend run start:dev   # http://localhost:3300
npm start                                 # http://localhost:4200
```

Open <http://localhost:4200>, create an account, then add an IMAP/SMTP
mailbox from the settings page.

---

## Configuration

All runtime configuration lives in `nest-backend/.env` (see
[`nest-backend/.env.example`](nest-backend/.env.example)). Frontend
configuration uses the standard Angular `src/app/environments/environment.ts`.

### Generating secrets

Every secret listed as **required** below must be a strong, random value.
Use one of:

```bash
openssl rand -hex 32          # → 64-character hex string (recommended)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> ⚠️ In production, the backend refuses to start if `ENCRYPTION_KEY`,
> `JWT_SECRET`, or `JWT_REFRESH_SECRET` are missing or too short.
> In development, it generates a random per-process value and prints a
> warning — sessions and encrypted values won't survive a restart.

### Backend environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `production` enables strict checks (HTTPS origins, cookie `Secure`, no TypeORM auto-sync, no verbose validation errors). |
| `PORT` | no | `3300` | HTTP port the API listens on. |
| `DB_PATH` | no | `settings.sqlite` | Path to the SQLite database file. |
| `DB_SYNC` | no | `true` (dev) / forced `false` (prod) | Whether TypeORM auto-syncs the schema at boot. Dangerous in production. |
| `ENCRYPTION_KEY` | **yes** | — | AES-256-GCM master key used to encrypt IMAP/SMTP passwords, AI API keys, OAuth tokens, and PGP private keys at rest. Generate 32 random bytes. |
| `LEGACY_ENCRYPTION_KEY` | no | — | Previous `ENCRYPTION_KEY`. Allows reading old AES-256-CBC ciphertexts during a key rotation. Remove once all rows have been re-encrypted. |
| `JWT_SECRET` | **yes** | — | Signing key for access tokens and temporary 2FA tokens. ≥ 32 chars. |
| `JWT_REFRESH_SECRET` | **yes (prod)** | falls back to `JWT_SECRET` in dev | Signing key for refresh tokens. Use a **different** value than `JWT_SECRET` so leaking one doesn't compromise the other. |
| `BCRYPT_ROUNDS` | no | `12` | Bcrypt cost factor for password and refresh-token hashing. Valid range: `10`..`15`. Higher is safer but slower on login. |
| `CORS_ORIGINS` | no | `http://localhost:4200,http://localhost:4000` | Comma-separated list of origins allowed to call the API with credentials. Must include the frontend's exact origin because the refresh cookie is `SameSite=Strict`. |
| `WEBAUTHN_RP_NAME` | no | `MailFlow` | Human-readable relying-party name displayed in the OS credential dialog. |
| `WEBAUTHN_RP_ID` | no | `localhost` | WebAuthn relying-party ID. Must be the registrable domain (e.g. `example.com`, not `https://mail.example.com`). In production, `localhost` is refused. |
| `WEBAUTHN_ORIGINS` | no | `http://<RP_ID>:4200` | Comma-separated list of full origins accepted during passkey ceremonies. In production all entries must use `https://`. |
| `SMTP_ALLOW_INVALID_CERTS` | no | `false` | Set to `true` to keep the previous permissive TLS behaviour (accept self-signed certs from the user's SMTP server). Leave `false` for real providers. |

### Example: local development

```env
NODE_ENV=development
PORT=3300

ENCRYPTION_KEY=3a9f8d2e7b1c4a6f9e0d2b5a7f3c1e8b4d6a9c2e5f1b8d4a7c3e0f9b2d6a5c1e
JWT_SECRET=0e7f3c1a8b6d2f5a9c4e1b7d3a6f0c9e2b5d8a1f4c7e0b3d6a9c2f5e8b1d4a7c
JWT_REFRESH_SECRET=b1d4a7c0e3f6a9c2e5b8d1f4a7c0e3f6a9c2e5b8d1f4a7c0e3f6a9c2e5b8d1f4

CORS_ORIGINS=http://localhost:4200
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGINS=http://localhost:4200
```

### Example: production

```env
NODE_ENV=production
PORT=3300

ENCRYPTION_KEY=<openssl rand -hex 32>
JWT_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32>
BCRYPT_ROUNDS=12

DB_PATH=/var/lib/mailflow/settings.sqlite
DB_SYNC=false

CORS_ORIGINS=https://mail.example.com
WEBAUTHN_RP_NAME=Example Mail
WEBAUTHN_RP_ID=example.com
WEBAUTHN_ORIGINS=https://mail.example.com
```

### User-facing settings (stored in the database)

These are configured per-user from the in-app **Settings** page — no env
variable needed:

| Setting | Description |
| --- | --- |
| Dark mode | Light / dark / follow system. |
| Undo-send delay | Seconds before a sent email is actually dispatched (0 disables). |
| Remote image policy | `ask` / `always` load / `never` load external images. |
| Image allow/block lists | Per-domain overrides for the global image policy. |
| Block tracking pixels | Strip 1×1 tracking images before rendering. |
| AI provider | `openai` / `anthropic` / `google` / `mistral` / `other`. |
| AI API URL | Optional override for self-hosted / proxy endpoints. |
| AI API key | Stored AES-256-GCM encrypted with `ENCRYPTION_KEY`. |
| AI enabled | Master switch for AI features. |
| Hide AI hints | Hides inline AI suggestions without disabling the provider. |
| 2FA (TOTP) | Enable from the security section; produces a QR for your authenticator app. |
| Passkeys | Register one or more WebAuthn credentials (resident keys supported). |

### IMAP/SMTP account configuration

Each mailbox is added at runtime from the frontend and stored encrypted in
the database. Required fields:

- **Display name** (optional)
- **Email address**
- **IMAP host / port** (typical: `imap.example.com` / `993`)
- **SMTP host / port** (typical: `smtp.example.com` / `465` for TLS, `587` for STARTTLS)
- **Password / app password**

Passwords are encrypted with `ENCRYPTION_KEY` before reaching the database;
they are decrypted in memory only to open an IMAP/SMTP connection.

---

## Security model

This project has been audited (see `git log` for the hardening commits).
Key guarantees:

- **Authenticated encryption at rest** (AES-256-GCM) for every sensitive
  value: IMAP/SMTP passwords, AI API keys, PGP private keys. Legacy
  AES-256-CBC ciphertexts are transparently upgraded.
- **Fail-fast secret loading**: the backend refuses to start in production
  without `ENCRYPTION_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`.
- **Refresh tokens are HTTP-only, `SameSite=Strict`, `Secure` cookies**,
  rotated on every use. Reuse of an old refresh token revokes the session
  (replay protection).
- **Distinct signing keys** for access vs. refresh tokens.
- **bcrypt cost 12** (configurable) with constant-time comparison in the
  login path, and a decoy compare for unknown emails (no user enumeration
  via timing).
- **TOTP**: single-use per 30-second step (replay blocked); temp-tokens
  issued after password success are JTI-tracked and single-use.
- **Passkey/WebAuthn**: `rpID` and accepted origins are env-configurable;
  production blocks `localhost` and plain `http://`.
- **Rate limiting** (Nest `ThrottlerGuard`): 120 req/min global, tighter
  limits on `/login` (10), `/register` (5), `/2fa/authenticate` (5),
  `/refresh` (30) and WebAuthn endpoints.
- **Global `ValidationPipe`** with `whitelist: true`, `forbidNonWhitelisted:
  true`, and DTOs for every auth endpoint (email format, password policy,
  TOTP regex, PGP armor checks).
- **SMTP header-injection protection**: every address/subject/display-name
  is rejected if it contains `\r`, `\n`, or `\0`; recipient count capped at
  100.
- **Helmet** enabled with `Cross-Origin-Resource-Policy: same-site` and
  `Referrer-Policy: no-referrer`.
- **`cookie-parser`** wired up so the refresh cookie is parsed safely.
- **Print sandbox**: emails are printed via a sandboxed `<iframe srcdoc>`
  with neither scripts nor same-origin — preventing untrusted HTML from
  touching cookies or localStorage.

### Rotating `ENCRYPTION_KEY`

1. Set the current value as `LEGACY_ENCRYPTION_KEY`.
2. Generate a new `ENCRYPTION_KEY` (`openssl rand -hex 32`).
3. Restart the backend. Every time an encrypted value is read, if it still
   matches the legacy format, it is decrypted with the legacy key and
   rewritten with the new key on the next save.
4. Once no legacy-format rows remain (e.g. after users re-authenticate or
   resave settings), remove `LEGACY_ENCRYPTION_KEY`.

### Rotating JWT secrets

Rotate during a maintenance window. All active sessions are invalidated
— users will have to log in again. For zero-downtime rotation you need to
add a grace period verifier that accepts both secrets; this is not yet
implemented.

---

## Development

```bash
# Frontend dev server (HMR)
npm start

# Backend dev server (auto-reload)
npm --prefix nest-backend run start:dev

# Type-check + build both
npm run build
npm --prefix nest-backend run build

# Tests
npm test                          # Angular (Karma)
npm --prefix nest-backend test    # NestJS (Jest)
```

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Angular dev server at `http://localhost:4200`. |
| `npm run build` | Production frontend bundle in `dist/`. |
| `npm --prefix nest-backend run start:dev` | NestJS watch mode. |
| `npm --prefix nest-backend run start:prod` | Run the built NestJS backend from `dist/`. |
| `npm --prefix nest-backend run lint` | ESLint + auto-fix. |

### Angular conventions enforced in this repo

See [`.claude/CLAUDE.md`](.claude/CLAUDE.md):

- Standalone components only (never set `standalone: true`; implicit in v20+).
- Signals for state, `computed()` for derived values.
- Host bindings via the `host: {}` metadata, **never** `@HostBinding` / `@HostListener`.
- Native control flow (`@if`, `@for`, `@switch`) — no `*ngIf`/`*ngFor`.
- Class/style bindings (`[class.x]`, `[style.y]`) — no `ngClass`/`ngStyle`.
- `inject()` for DI; reactive forms; `OnPush` everywhere.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `ENCRYPTION_KEY environment variable is required` | Set `ENCRYPTION_KEY` in `nest-backend/.env`. |
| `Legacy ciphertext cannot be decrypted with the provided keys` | You changed `ENCRYPTION_KEY` without setting `LEGACY_ENCRYPTION_KEY` to the previous value. |
| Passkey login fails in production | Check `WEBAUTHN_RP_ID` matches your registrable domain and `WEBAUTHN_ORIGINS` lists the exact HTTPS origin. |
| CORS error in the browser | Add the frontend origin to `CORS_ORIGINS`. Remember the refresh cookie requires `credentials: true` — origins with wildcards are rejected. |
| Login throttled unexpectedly | Global limit is 120 req/min; `/login` allows 10/min. Wait a minute or tune `@Throttle()` overrides in `auth.controller.ts`. |
| Self-signed SMTP rejected | Set `SMTP_ALLOW_INVALID_CERTS=true` (only if you really need it). |

---

## Project layout

```
email-client/
├── src/                       # Angular frontend
│   ├── app/
│   │   ├── components/        # UI components (login, email-list, email-detail, compose, ...)
│   │   ├── services/          # auth, email, ai, pgp, settings, toast, ...
│   │   ├── guards/            # Route guards
│   │   ├── interceptors/      # auth.interceptor (adds Bearer token + refresh on 401)
│   │   ├── directives/        # sandboxed-html.directive (Shadow DOM renderer)
│   │   └── models/            # TypeScript interfaces
│   └── styles.css
└── nest-backend/
    ├── .env.example           # ← configuration reference
    └── src/
        ├── auth/              # login, WebAuthn, 2FA, DTOs, throttling
        ├── users/             # User, WebAuthnCredential, AuthSession, crypto.util
        ├── accounts/          # IMAP/SMTP accounts (passwords encrypted)
        ├── email/             # IMAP + SMTP services + controller
        ├── ai/                # OpenAI / Anthropic / Google / Mistral proxy
        ├── pgp/               # PGP key storage (private keys encrypted)
        ├── labels/, filters/, snooze/, scheduled/, contacts/
        └── main.ts            # bootstrap + helmet + CORS + ValidationPipe
```

---

## License

UNLICENSED — internal project.
