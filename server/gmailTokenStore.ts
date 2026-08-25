import fs from 'fs';
import path from 'path';
import { atomicWriteJson } from './persist';

const DATA_DIR = path.join(process.cwd(), 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'gmail-token.json');

export type StoredGmailToken = {
  accessToken: string;
  email: string;
  /** Unix ms when token is considered expired (default ~55 min after save). */
  expiresAt: number;
  updatedAt: string;
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function getGmailToken(): StoredGmailToken | null {
  ensureDataDir();
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8')) as Partial<StoredGmailToken>;
    if (!raw.accessToken || !raw.email) return null;
    return {
      accessToken: String(raw.accessToken),
      email: String(raw.email).trim().toLowerCase(),
      expiresAt: Number(raw.expiresAt) || 0,
      updatedAt: String(raw.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

/** True when we have a non-expired access token for Gmail send. */
export function isGmailTokenReady(): boolean {
  const t = getGmailToken();
  if (!t?.accessToken) return false;
  // small buffer so we don't use a token that expires mid-send
  return t.expiresAt > Date.now() + 30_000;
}

export function getGmailPublicStatus() {
  const t = getGmailToken();
  const ready = isGmailTokenReady();
  return {
    connected: !!t?.accessToken,
    ready,
    email: t?.email || '',
    expiresAt: t?.expiresAt || null,
    expiresInSec: t?.expiresAt ? Math.max(0, Math.round((t.expiresAt - Date.now()) / 1000)) : 0,
  };
}

/**
 * Save browser OAuth access token for server-side Gmail API sends.
 * GIS tokens last ~1 hour; expiresInSec defaults to 3300 (55 min).
 */
export function saveGmailToken(opts: {
  accessToken: string;
  email: string;
  expiresInSec?: number;
}): StoredGmailToken {
  const accessToken = String(opts.accessToken || '').trim();
  const email = String(opts.email || '').trim().toLowerCase();
  if (!accessToken) throw new Error('Missing Google access token');
  if (!email || !email.includes('@')) throw new Error('Missing Google account email');

  const ttl = Math.min(
    Math.max(Number(opts.expiresInSec) || 3300, 60),
    3600
  );
  const next: StoredGmailToken = {
    accessToken,
    email,
    expiresAt: Date.now() + ttl * 1000,
    updatedAt: new Date().toISOString(),
  };
  ensureDataDir();
  atomicWriteJson(TOKEN_FILE, next);
  return next;
}

export function clearGmailToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      fs.unlinkSync(TOKEN_FILE);
    } catch {
      // ignore
    }
  }
}
