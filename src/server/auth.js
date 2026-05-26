import crypto from 'node:crypto';
import { config } from './config.js';
import { nowIso } from './db.js';

const encoder = new TextEncoder();

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const iterations = 210000;
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$${iterations}$${salt}$${key}`;
}

export function verifyPassword(password, encodedHash) {
  const [scheme, iterationText, salt, expected] = String(encodedHash || '').split('$');
  if (scheme !== 'pbkdf2_sha256' || !iterationText || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, Number(iterationText), 32, 'sha256').toString('base64url');
  return timingSafeEqual(actual, expected);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

export function signJwt(payload, expiresAt) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, exp: Math.floor(expiresAt.getTime() / 1000) };
  const unsigned = `${base64urlJson(header)}.${base64urlJson(body)}`;
  const signature = crypto.createHmac('sha256', config.jwtSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(unsigned).digest('base64url');
  if (!timingSafeEqual(parts[2], expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSession(db, userId, remember) {
  const sessionId = id('ses');
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + (remember ? config.rememberDays : config.sessionDays) * 86400000);
  const token = signJwt({ sid: sessionId, sub: userId }, expiresAt);
  const tokenHash = sha256(token);
  const now = nowIso();
  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, csrf_token, remember, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, tokenHash, csrfToken, remember ? 1 : 0, expiresAt.toISOString(), now, now);
  return { token, csrfToken, expiresAt };
}

export function revokeSession(db, sessionId) {
  db.prepare('UPDATE sessions SET revoked_at = ?, last_seen_at = ? WHERE id = ?')
    .run(nowIso(), nowIso(), sessionId);
}

export function authenticateRequest(db, req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[config.sessionCookie];
  if (!token) return null;
  const payload = verifyJwt(token);
  if (!payload?.sid || !payload?.sub) return null;
  const session = db.prepare(`
    SELECT * FROM sessions
    WHERE id = ? AND user_id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(payload.sid, payload.sub, sha256(token), nowIso());
  if (!session) return null;
  const user = db.prepare('SELECT id, email, name, role, is_active, is_default_admin FROM users WHERE id = ?').get(payload.sub);
  if (!user || !user.is_active) return null;
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), session.id);
  return { user: normalizeUser(user), session, csrfToken: session.csrf_token };
}

export function normalizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: Boolean(user.is_active),
    isDefaultAdmin: Boolean(user.is_default_admin)
  };
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path || '/'}`);
  if (options.httpOnly) segments.push('HttpOnly');
  if (options.sameSite) segments.push(`SameSite=${options.sameSite}`);
  if (options.secure) segments.push('Secure');
  if (options.maxAge != null) segments.push(`Max-Age=${options.maxAge}`);
  if (options.expires) segments.push(`Expires=${options.expires.toUTCString()}`);
  return segments.join('; ');
}

export function timingSafeEqual(left, right) {
  const leftBytes = encoder.encode(String(left));
  const rightBytes = encoder.encode(String(right));
  if (leftBytes.length !== rightBytes.length) return false;
  return crypto.timingSafeEqual(leftBytes, rightBytes);
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
