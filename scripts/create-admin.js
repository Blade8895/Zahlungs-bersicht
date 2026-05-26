import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';
import { openDatabase, nowIso } from '../src/server/db.js';
import { hashPassword, id } from '../src/server/auth.js';

class SilentOutput extends Writable {
  constructor(target) {
    super();
    this.target = target;
    this.muted = false;
  }

  _write(chunk, encoding, callback) {
    if (!this.muted) this.target.write(chunk, encoding);
    callback();
  }
}

const args = parseArgs(process.argv.slice(2));
const db = openDatabase();

try {
  const email = normalizeEmail(args.email || await prompt('E-Mail: '));
  const name = sanitizeName(args.name || await prompt('Name: '));
  const password = args.password || await promptHidden('Passwort (mindestens 8 Zeichen): ');
  const confirmPassword = args.password || await promptHidden('Passwort wiederholen: ');

  if (!email) fail('E-Mail ist erforderlich.');
  if (!name) fail('Name ist erforderlich.');
  if (password.length < 8) fail('Das Passwort muss mindestens 8 Zeichen lang sein.');
  if (password !== confirmPassword) fail('Die Passwörter stimmen nicht überein.');

  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (existing) fail('Für diese E-Mail existiert bereits ein Benutzer.');

  const now = nowIso();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, is_active, is_default_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ADMIN', 1, 0, ?, ?)
  `).run(id('usr'), email, name, hashPassword(password), now, now);

  process.stdout.write(`Admin erstellt: ${email}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 1);
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    result[key] = next && !next.startsWith('--') ? next : 'true';
    if (result[key] === next) index += 1;
  }
  return result;
}

async function prompt(label) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    return String(await rl.question(label)).trim();
  } finally {
    rl.close();
  }
}

async function promptHidden(label) {
  const output = new SilentOutput(process.stdout);
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    output.muted = false;
    process.stdout.write(label);
    output.muted = true;
    const value = String(await rl.question('')).trim();
    process.stdout.write('\n');
    return value;
  } finally {
    output.muted = false;
    rl.close();
  }
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function sanitizeName(value) {
  return String(value || '').trim().slice(0, 160);
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}