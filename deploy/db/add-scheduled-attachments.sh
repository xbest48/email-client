#!/usr/bin/env bash
# Adds the table holding attachments of scheduled emails.
# Production runs with TypeORM `synchronize` off, so this must be applied once
# before starting the new backend. Idempotent: safe to run several times.
#
# Usage (from the backend release folder, so `sqlite3` resolves):
#   DB_PATH=/home/kyma-mail/settings.sqlite bash add-scheduled-attachments.sh
set -euo pipefail

node <<'JS'
const db = new (require("sqlite3").Database)(process.env.DB_PATH || "/home/kyma-mail/settings.sqlite");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS "scheduled_email_attachment" (
    "id" varchar PRIMARY KEY NOT NULL,
    "scheduledEmailId" varchar NOT NULL,
    "filename" text NOT NULL,
    "contentType" varchar NOT NULL,
    "content" blob NOT NULL,
    CONSTRAINT "FK_6ba9b5337a9263d96243059f198" FOREIGN KEY ("scheduledEmailId")
      REFERENCES "scheduled_email" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
  )`, (e) => console.log("table:", e || "ok"));
  db.run(`CREATE INDEX IF NOT EXISTS "IDX_6ba9b5337a9263d96243059f19" ON "scheduled_email_attachment" ("scheduledEmailId")`,
    (e) => console.log("index:", e || "ok"));
});
db.close();
JS
