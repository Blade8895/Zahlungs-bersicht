import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from './env.js';

const rootDir = process.cwd();
loadEnvFile(rootDir);
const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

export const config = {
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir: path.join(rootDir, 'data'),
  uploadDir: path.join(rootDir, 'uploads'),
  dbPath: process.env.DB_PATH || path.join(rootDir, 'data', 'zahlungserfassung.sqlite'),
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me-before-production',
  sessionCookie: 'zahlung_session',
  csrfCookie: 'zahlung_csrf',
  maxPdfBytes: Number(process.env.MAX_PDF_BYTES || 10 * 1024 * 1024),
  sessionDays: Number(process.env.SESSION_DAYS || 1),
  rememberDays: Number(process.env.REMEMBER_DAYS || 30),
  seedMode: process.env.SEED_MODE || (isProduction ? 'none' : 'demo'),
  isProduction
};

export function ensureRuntimeDirectories() {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.uploadDir, { recursive: true });
}
