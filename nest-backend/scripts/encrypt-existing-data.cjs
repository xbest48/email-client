#!/usr/bin/env node

const crypto = require('crypto');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

try {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env.production') });
} catch {
  // dotenv is expected through @nestjs/config, but the script can still run
  // when operators export ENCRYPTION_KEY directly in the shell.
}

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const VERSION_PREFIX = 'v2';

const encryptedColumns = {
  user: [
    'twoFactorSecret',
    'currentChallenge',
    'imageAllowedDomains',
    'imageBlockedDomains',
    'aiApiUrl',
    'appSettings',
  ],
  account: ['email', 'displayName', 'imapHost', 'smtpHost'],
  contact: ['name', 'email'],
  label: ['name'],
  filter_rule: ['name', 'conditionValue', 'actionValue'],
  scheduled_email: ['to', 'cc', 'bcc', 'subject', 'body'],
  pgp_key: ['publicKey', 'privateKey'],
  pgp_contact_key: ['email', 'publicKey'],
  email_ai_insight: ['category', 'reason'],
  auth_session: ['userAgent', 'ipAddress'],
};

function deriveKey(raw, context) {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (raw.length === KEY_LENGTH) return Buffer.from(raw, 'utf8');
  try {
    const base64 = Buffer.from(raw, 'base64');
    if (base64.length === KEY_LENGTH) return base64;
  } catch {
    // Ignore and fall back to SHA-256.
  }
  return crypto.createHash('sha256').update(`${context}:${raw}`).digest();
}

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is required before encrypting existing data.');
  }
  return deriveKey(raw, 'ENCRYPTION_KEY');
}

function isProbablyCiphertext(value) {
  return typeof value === 'string'
    && (value.startsWith(`${VERSION_PREFIX}:`) || /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(value));
}

function encrypt(value, key) {
  if (typeof value !== 'string' || value.length === 0 || isProbablyCiphertext(value)) {
    return value;
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

async function tableExists(db, tableName) {
  const rows = await all(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  );
  return rows.length > 0;
}

async function encryptTable(db, tableName, columns, key) {
  if (!(await tableExists(db, tableName))) return { tableName, updated: 0 };

  const tableInfo = await all(db, `PRAGMA table_info("${tableName}")`);
  const existingColumns = new Set(tableInfo.map((column) => column.name));
  const presentColumns = columns.filter((column) => existingColumns.has(column));
  if (!presentColumns.length || !existingColumns.has('id')) return { tableName, updated: 0 };

  const selectedColumns = ['id', ...presentColumns].map((column) => `"${column}"`).join(', ');
  const rows = await all(db, `SELECT ${selectedColumns} FROM "${tableName}"`);
  let updated = 0;

  for (const row of rows) {
    const next = {};
    for (const column of presentColumns) {
      const encrypted = encrypt(row[column], key);
      if (encrypted !== row[column]) {
        next[column] = encrypted;
      }
    }

    const changedColumns = Object.keys(next);
    if (!changedColumns.length) continue;

    const assignments = changedColumns.map((column) => `"${column}" = ?`).join(', ');
    const params = changedColumns.map((column) => next[column]);
    params.push(row.id);
    await run(db, `UPDATE "${tableName}" SET ${assignments} WHERE "id" = ?`, params);
    updated += 1;
  }

  return { tableName, updated };
}

async function main() {
  const dbPath = process.env.DB_PATH || 'settings.sqlite';
  const key = getKey();
  const db = new sqlite3.Database(dbPath);

  try {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION');
    for (const [tableName, columns] of Object.entries(encryptedColumns)) {
      const result = await encryptTable(db, tableName, columns, key);
      if (result.updated > 0) {
        console.log(`${result.tableName}: ${result.updated} ligne(s) chiffree(s)`);
      }
    }
    await run(db, 'COMMIT');
    console.log('Chiffrement des donnees existantes termine.');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
