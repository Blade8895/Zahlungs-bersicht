import { DatabaseSync } from 'node:sqlite';
import { config, ensureRuntimeDirectories } from './config.js';

export function openDatabase() {
  ensureRuntimeDirectories();
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('USER', 'ADMIN')),
      is_active INTEGER NOT NULL DEFAULT 1,
      is_default_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#2dd4bf',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_tenants (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, tenant_id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      category_id TEXT REFERENCES categories(id),
      recipient_name TEXT,
      iban TEXT,
      purpose TEXT,
      amount DECIMAL,
      due_date TEXT,
      status TEXT NOT NULL,
      notes TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      qr_payload TEXT,
      qr_generated_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      updated_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payments_tenant_status_due ON payments(tenant_id, status, due_date);
    CREATE INDEX IF NOT EXISTS idx_payments_archive ON payments(is_archived);

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      remember INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, 'payments', 'paid_at', 'TEXT');
  db.exec("UPDATE payments SET paid_at = COALESCE(paid_at, updated_at) WHERE status = 'Bezahlt';");
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function bool(value) {
  return value ? 1 : 0;
}
