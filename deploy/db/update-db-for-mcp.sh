node <<'EOF'
const db = new (require("sqlite3").Database)(process.env.DB_PATH || "/home/kyma-mail/settings.sqlite");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS "api_key" (
    "id" varchar PRIMARY KEY NOT NULL,
    "userId" varchar NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "accountId" varchar NOT NULL REFERENCES "account"("id") ON DELETE CASCADE,
    "name" varchar NOT NULL,
    "keyHash" varchar NOT NULL UNIQUE,
    "keyPrefix" varchar NOT NULL,
    "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
    "lastUsedAt" datetime,
    "expiresAt" datetime,
    "revokedAt" datetime
  )`, (e) => console.log("table:", e || "ok"));
  db.run(`CREATE INDEX IF NOT EXISTS "IDX_api_key_userId" ON "api_key" ("userId")`, (e) => console.log("index:", e || "ok"));
});
db.close();
EOF

node <<'EOF'
const db = new (require("sqlite3").Database)(process.env.DB_PATH || "/home/kyma-mail/settings.sqlite");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS "o_auth_auth_code" (
    "id" varchar PRIMARY KEY NOT NULL,
    "codeHash" varchar NOT NULL,
    "apiKeyId" varchar NOT NULL,
    "redirectUri" varchar NOT NULL,
    "codeChallenge" varchar NOT NULL,
    "codeChallengeMethod" varchar NOT NULL,
    "scope" text,
    "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
    "expiresAt" datetime NOT NULL,
    "usedAt" datetime
  )`, (e) => console.log("table:", e || "ok"));
  db.run(`CREATE INDEX IF NOT EXISTS "IDX_oauth_auth_code_codeHash" ON "o_auth_auth_code" ("codeHash")`, (e) => console.log("index:", e || "ok"));
});
db.close();
EOF

node <<'EOF'
const db = new (require("sqlite3").Database)(process.env.DB_PATH || "/home/kyma-mail/settings.sqlite");
db.serialize(() => {
  db.run(`ALTER TABLE "account" ADD COLUMN "oauthProvider" text`,         (e) => console.log("oauthProvider:",       e || "ok"));
  db.run(`ALTER TABLE "account" ADD COLUMN "oauthAccessToken" text`,      (e) => console.log("oauthAccessToken:",    e || "ok"));
  db.run(`ALTER TABLE "account" ADD COLUMN "oauthRefreshToken" text`,     (e) => console.log("oauthRefreshToken:",   e || "ok"));
  db.run(`ALTER TABLE "account" ADD COLUMN "oauthTokenExpiresAt" datetime`, (e) => console.log("oauthTokenExpiresAt:", e || "ok"));
});
db.close();
EOF


# curl -s -X POST https://kymamail.fr/api/mcp \
#   -H "Authorization: Bearer mcp_26cd0ce8_a7f4e5509004f7644fdabb1de977c98e5d64d774fa8d4f96eeb39be8f852ab1f" \
#   -H "Content-Type: application/json" \
#   -H "Accept: application/json, text/event-stream" \
#   -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
