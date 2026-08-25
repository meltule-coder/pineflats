import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { atomicWriteJson } from './persist';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const RECOVERY_CODE_FILE = path.join(DATA_DIR, 'admin-recovery-code.txt');
const DEFAULT_ADMIN_PASSWORD = 'pineflats';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const COOKIE_NAME = 'pineflats_admin_session';
const RECOVERY_CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_PASSWORD_LENGTH = 12;

/** scrypt parameters — balanced for interactive admin login */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const HASH_PREFIX = 'scrypt';

interface Session {
  token: string;
  expiresAt: number;
  createdAt: number;
}

const sessions = new Map<string, Session>();

// Simple login rate limit: IP → { count, resetAt }
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

// Recovery request rate limit
const recoveryAttempts = new Map<string, { count: number; resetAt: number }>();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadConfig(): Record<string, unknown> {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, unknown>) {
  ensureDataDir();
  atomicWriteJson(CONFIG_FILE, config);
}

export function getCookieName() {
  return COOKIE_NAME;
}

export function getMinPasswordLength() {
  return MIN_PASSWORD_LENGTH;
}

function isHashedPassword(value: string): boolean {
  return value.startsWith(`${HASH_PREFIX}$`);
}

/** Encode: scrypt$N$r$p$saltHex$keyHex */
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    HASH_PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('hex'),
    key.toString('hex'),
  ].join('$');
}

function verifyPasswordHash(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4];
  const keyHex = parts[5];
  if (!N || !r || !p || !saltHex || !keyHex) return false;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // Burn cycles so length mismatch is not a pure free comparison
    crypto.timingSafeEqual(Buffer.alloc(bb.length), bb);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Whether any admin password source is available (always true with default).
 * Used only for UI hints — never returns the password itself.
 */
export function isAdminPasswordConfigured(): boolean {
  const config = loadConfig();
  if (typeof config.adminPasswordHash === 'string' && config.adminPasswordHash.trim()) return true;
  if (typeof config.adminPassword === 'string' && config.adminPassword.trim()) return true;
  if (process.env.ADMIN_PASSWORD?.trim()) return true;
  if (process.env.PREVIEW_PASSWORD?.trim()) return true;
  return true; // default still works until changed
}

/**
 * @deprecated Prefer isAdminPasswordConfigured(). Never returns a usable secret when hashed.
 * Kept for callers that only check truthiness.
 */
export function getAdminPassword(): string {
  if (isAdminPasswordConfigured()) return '***';
  return '';
}

function getEnvPasswordCandidates(): string[] {
  const out: string[] = [];
  const admin = process.env.ADMIN_PASSWORD?.trim();
  const preview = process.env.PREVIEW_PASSWORD?.trim();
  if (admin) out.push(admin);
  if (preview && preview !== admin) out.push(preview);
  return out;
}

/**
 * Persist a new admin password as a scrypt hash. Removes any legacy plain-text field.
 */
export function setAdminPassword(password: string): void {
  const trimmed = password.trim();
  if (trimmed.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const config = loadConfig();
  config.adminPasswordHash = hashPassword(trimmed);
  // Drop legacy plaintext if present
  delete config.adminPassword;
  // Clear any one-time recovery state after a successful password set
  delete config.adminRecoveryCodeHash;
  delete config.adminRecoveryCodeExpires;
  saveConfig(config);
  try {
    if (fs.existsSync(RECOVERY_CODE_FILE)) fs.unlinkSync(RECOVERY_CODE_FILE);
  } catch {
    /* ignore */
  }
}

/**
 * Verify admin password.
 * Priority: stored scrypt hash → legacy plain config (auto-migrates to hash) → env → default.
 */
export function verifyAdminPassword(password: string): boolean {
  const attempt = password.trim();
  if (!attempt) return false;

  const config = loadConfig();

  // 1) Hashed password in config (preferred)
  const storedHash =
    typeof config.adminPasswordHash === 'string' ? config.adminPasswordHash.trim() : '';
  if (storedHash && isHashedPassword(storedHash)) {
    return verifyPasswordHash(attempt, storedHash);
  }

  // 2) Legacy plain text in config → verify then migrate to hash
  const legacyPlain =
    typeof config.adminPassword === 'string' ? config.adminPassword.trim() : '';
  if (legacyPlain) {
    if (isHashedPassword(legacyPlain)) {
      // Mis-stored under old key
      const ok = verifyPasswordHash(attempt, legacyPlain);
      if (ok) {
        config.adminPasswordHash = legacyPlain;
        delete config.adminPassword;
        saveConfig(config);
      }
      return ok;
    }
    if (timingSafeStringEqual(attempt, legacyPlain)) {
      // Migrate to hash (may fail min length for very short legacy — still store hash)
      try {
        config.adminPasswordHash = hashPassword(legacyPlain);
        delete config.adminPassword;
        saveConfig(config);
      } catch {
        /* keep working even if migrate fails */
      }
      return true;
    }
    return false;
  }

  // 3) Environment secrets (not written to disk as plain)
  for (const candidate of getEnvPasswordCandidates()) {
    if (timingSafeStringEqual(attempt, candidate)) return true;
  }

  // 4) Built-in default (local/dev only — change in production)
  return timingSafeStringEqual(attempt, DEFAULT_ADMIN_PASSWORD);
}

/** Backup email used for password recovery (config → env → park contact). */
export function getAdminRecoveryEmail(): string {
  const config = loadConfig();
  const fromConfig =
    typeof config.adminRecoveryEmail === 'string' ? config.adminRecoveryEmail.trim() : '';
  if (fromConfig) return fromConfig.toLowerCase();

  const fromEnv = (process.env.ADMIN_RECOVERY_EMAIL || process.env.PARK_NOTIFY_EMAIL || '')
    .trim()
    .toLowerCase();
  if (fromEnv) return fromEnv;

  try {
    const contact = config.contact as { email?: string } | undefined;
    if (contact?.email?.trim()) return contact.email.trim().toLowerCase();
  } catch {
    /* ignore */
  }
  return 'pineflatsrvpark@hotmail.com';
}

export function setAdminRecoveryEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error('Enter a valid recovery email address');
  }
  const config = loadConfig();
  config.adminRecoveryEmail = trimmed;
  saveConfig(config);
  return trimmed;
}

export function getAdminRecoveryEmailMasked(): string {
  const email = getAdminRecoveryEmail();
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}***@${domain}`;
}

function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase(), 'utf8').digest('hex');
}

/**
 * Create a one-time recovery code (shown via email when SMTP works;
 * also written to data/admin-recovery-code.txt for emergency SSH recovery).
 */
export function createAdminRecoveryCode(): {
  code: string;
  expiresAt: number;
  recoveryEmail: string;
} {
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = Date.now() + RECOVERY_CODE_TTL_MS;
  const config = loadConfig();
  config.adminRecoveryCodeHash = hashRecoveryCode(code);
  config.adminRecoveryCodeExpires = expiresAt;
  saveConfig(config);

  ensureDataDir();
  const email = getAdminRecoveryEmail();
  const lines = [
    `Pine Flats admin recovery code: ${code}`,
    `Email: ${email}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
    `Use this code on the admin login page → Forgot password → Reset password.`,
    `Delete this file after you sign in.`,
  ];
  fs.writeFileSync(RECOVERY_CODE_FILE, lines.join('\n'), 'utf8');

  return { code, expiresAt, recoveryEmail: email };
}

export function verifyAndConsumeRecoveryCode(code: string): boolean {
  const config = loadConfig();
  const hash = typeof config.adminRecoveryCodeHash === 'string' ? config.adminRecoveryCodeHash : '';
  const expires =
    typeof config.adminRecoveryCodeExpires === 'number' ? config.adminRecoveryCodeExpires : 0;
  if (!hash || !expires || Date.now() > expires) return false;
  const attemptHash = hashRecoveryCode(code);
  const a = Buffer.from(attemptHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  delete config.adminRecoveryCodeHash;
  delete config.adminRecoveryCodeExpires;
  saveConfig(config);
  try {
    if (fs.existsSync(RECOVERY_CODE_FILE)) fs.unlinkSync(RECOVERY_CODE_FILE);
  } catch {
    /* ignore */
  }
  return true;
}

export function checkRecoveryRateLimit(ip: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = recoveryAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    recoveryAttempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return { ok: true };
  }
  entry.count += 1;
  if (entry.count > 6) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  return { ok: true };
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (s.expiresAt <= now) sessions.delete(token);
  }
}

export function createAdminSession(): string {
  pruneSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, {
    token,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return token;
}

export function destroyAdminSession(token?: string | null) {
  if (token) sessions.delete(token);
}

export function isAdminSessionValid(token?: string | null): boolean {
  if (!token) return false;
  pruneSessions();
  const s = sessions.get(token);
  if (!s) return false;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  // sliding expiry
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

export function checkLoginRateLimit(ip: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return { ok: true };
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  return { ok: true };
}

export function clearLoginRateLimit(ip: string) {
  loginAttempts.delete(ip);
}

/** Paths that stay public (guest website + booking). */
export function isPublicApiPath(method: string, urlPath: string): boolean {
  const p = urlPath.split('?')[0];
  if (p === '/api/health') return true;
  if (p.startsWith('/api/public/')) return true;
  if (p === '/api/admin/status' || p === '/api/admin/login') return true;
  if (p === '/api/admin/logout') return true;
  if (p === '/api/admin/forgot-password' && method === 'POST') return true;
  if (p === '/api/admin/reset-password' && method === 'POST') return true;
  if (p === '/api/admin/recovery-info' && method === 'GET') return true;
  if (p === '/api/rates/active' && method === 'GET') return true;
  if (p === '/api/contact' && method === 'GET') return true;
  if (p === '/api/comments' && (method === 'GET' || method === 'POST')) return true;
  if (p === '/api/bookings' && method === 'POST') return true;
  if (p === '/api/bookings/start' && method === 'POST') return true;
  // Public checkout needs to know if Clover can charge cards online
  if (p === '/api/public/payment-processor' && method === 'GET') return true;
  // Future card-processor webhooks (verified by secret when integration is live)
  if (p === '/api/payment-processor/webhook' && method === 'POST') return true;
  return false;
}

export function parseCookieHeader(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
