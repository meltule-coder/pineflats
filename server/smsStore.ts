import fs from 'fs';
import path from 'path';
import { atomicWriteJson } from './persist';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export interface SmsConfig {
  enabled: boolean;
  /** E.164 park phone that receives alerts, e.g. +15415551212 */
  alertTo: string;
  /** Twilio Account SID */
  accountSid: string;
  /** Twilio Auth Token — never returned fully to browser */
  authToken: string;
  /** Twilio From number in E.164 */
  fromNumber: string;
}

export type SmsPublicStatus = {
  enabled: boolean;
  configured: boolean;
  alertTo: string;
  accountSid: string;
  fromNumber: string;
  hasAuthToken: boolean;
  source: 'config' | 'env' | 'none';
};

const DEFAULTS: SmsConfig = {
  enabled: true,
  alertTo: '',
  accountSid: '',
  authToken: '',
  fromNumber: '',
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig(): Record<string, unknown> {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, unknown>) {
  ensureDataDir();
  atomicWriteJson(CONFIG_FILE, config);
}

export function getSmsConfig(): SmsConfig {
  const config = loadConfig();
  const stored = (config.sms || {}) as Partial<SmsConfig>;
  return {
    enabled: stored.enabled !== false,
    alertTo: String(stored.alertTo ?? '').trim(),
    accountSid: String(stored.accountSid ?? '').trim(),
    authToken: String(stored.authToken ?? ''),
    fromNumber: String(stored.fromNumber ?? '').trim(),
  };
}

export function resolveSmsForSending(): {
  enabled: boolean;
  configured: boolean;
  alertTo: string;
  accountSid: string;
  authToken: string;
  fromNumber: string;
  source: 'config' | 'env' | 'none';
} {
  const cfg = getSmsConfig();
  if (cfg.enabled && cfg.alertTo && cfg.accountSid && cfg.authToken && cfg.fromNumber) {
    return {
      enabled: true,
      configured: true,
      alertTo: cfg.alertTo,
      accountSid: cfg.accountSid,
      authToken: cfg.authToken,
      fromNumber: cfg.fromNumber,
      source: 'config',
    };
  }

  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = (process.env.TWILIO_FROM || process.env.TWILIO_PHONE || '').trim();
  const to = (process.env.PARK_SMS_TO || process.env.SMS_ALERT_TO || '').trim();
  if (sid && token && from && to) {
    return {
      enabled: true,
      configured: true,
      alertTo: to,
      accountSid: sid,
      authToken: token,
      fromNumber: from,
      source: 'env',
    };
  }

  return {
    enabled: cfg.enabled,
    configured: false,
    alertTo: cfg.alertTo || to,
    accountSid: cfg.accountSid || sid,
    authToken: '',
    fromNumber: cfg.fromNumber || from,
    source: 'none',
  };
}

export function getSmsPublicStatus(): SmsPublicStatus {
  const resolved = resolveSmsForSending();
  const cfg = getSmsConfig();
  return {
    enabled: cfg.enabled,
    configured: resolved.configured,
    alertTo: resolved.alertTo || cfg.alertTo,
    accountSid: resolved.accountSid || cfg.accountSid,
    fromNumber: resolved.fromNumber || cfg.fromNumber,
    hasAuthToken: !!(cfg.authToken || (process.env.TWILIO_AUTH_TOKEN || '').trim()),
    source: resolved.source,
  };
}

export function updateSmsConfig(
  updates: Partial<SmsConfig> & { clearAuthToken?: boolean }
): SmsPublicStatus {
  const current = getSmsConfig();
  const next: SmsConfig = {
    enabled: updates.enabled !== undefined ? !!updates.enabled : current.enabled,
    alertTo: (updates.alertTo ?? current.alertTo).trim(),
    accountSid: (updates.accountSid ?? current.accountSid).trim(),
    authToken: current.authToken,
    fromNumber: (updates.fromNumber ?? current.fromNumber).trim(),
  };

  if (updates.clearAuthToken) {
    next.authToken = '';
  } else if (typeof updates.authToken === 'string' && updates.authToken.length > 0) {
    next.authToken = updates.authToken;
  }

  const config = loadConfig();
  config.sms = next;
  saveConfig(config);
  return getSmsPublicStatus();
}

/** Normalize US numbers to E.164 when possible */
export function toE164(phone: string): string {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  if (raw.startsWith('+')) {
    const digits = '+' + raw.slice(1).replace(/\D/g, '');
    return digits.length >= 11 ? digits : '';
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 10 ? `+${digits}` : '';
}
