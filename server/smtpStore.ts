import fs from 'fs';
import path from 'path';
import { atomicWriteJson } from './persist';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** App password / SMTP password — never returned to the browser in full */
  pass: string;
  from: string;
  parkNotifyEmail: string;
  enabled: boolean;
}

export type SmtpPublicStatus = {
  enabled: boolean;
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  parkNotifyEmail: string;
  /** true when a password is stored (value not exposed) */
  hasPassword: boolean;
  source: 'config' | 'env' | 'none';
};

const DEFAULTS: SmtpConfig = {
  host: '',
  port: 587,
  secure: false,
  user: '',
  pass: '',
  from: '',
  parkNotifyEmail: '',
  enabled: false,
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

export function getSmtpConfig(): SmtpConfig {
  const config = loadConfig();
  const stored = (config.smtp || {}) as Partial<SmtpConfig>;
  return {
    host: String(stored.host ?? DEFAULTS.host).trim(),
    port: Number(stored.port) > 0 ? Number(stored.port) : DEFAULTS.port,
    secure: stored.secure === true || Number(stored.port) === 465,
    user: String(stored.user ?? '').trim(),
    pass: String(stored.pass ?? ''),
    from: String(stored.from ?? '').trim(),
    parkNotifyEmail: String(stored.parkNotifyEmail ?? '').trim(),
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULTS.enabled,
  };
}

/** Disable and wipe SMTP (e.g. remove Hotmail login). */
export function clearSmtpConfig(): SmtpPublicStatus {
  const config = loadConfig();
  config.smtp = {
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: '',
    parkNotifyEmail: '',
    enabled: false,
  };
  saveConfig(config);
  return getSmtpPublicStatus();
}

/** Env vars override only when config is incomplete — config is preferred once set. */
export function resolveSmtpForSending(): {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  parkNotifyEmail: string;
  configured: boolean;
  source: 'config' | 'env' | 'none';
} {
  const cfg = getSmtpConfig();
  if (cfg.enabled && cfg.host && cfg.user && cfg.pass) {
    return {
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure || cfg.port === 465,
      user: cfg.user,
      pass: cfg.pass,
      from: cfg.from || `Pine Flats RV Park <${cfg.user}>`,
      parkNotifyEmail: cfg.parkNotifyEmail,
      configured: true,
      source: 'config',
    };
  }

  const envHost = (process.env.SMTP_HOST || '').trim();
  const envUser = (process.env.SMTP_USER || '').trim();
  const envPass = (process.env.SMTP_PASS || '').trim();
  if (envHost && envUser && envPass) {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure =
      process.env.SMTP_SECURE === 'true' ||
      process.env.SMTP_SECURE === '1' ||
      port === 465;
    return {
      host: envHost,
      port,
      secure,
      user: envUser,
      pass: envPass,
      from: (process.env.SMTP_FROM || '').trim() || `Pine Flats RV Park <${envUser}>`,
      parkNotifyEmail: (
        process.env.PARK_NOTIFY_EMAIL ||
        process.env.PARK_EMAIL ||
        ''
      ).trim(),
      configured: true,
      source: 'env',
    };
  }

  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    pass: '',
    from: cfg.from,
    parkNotifyEmail: cfg.parkNotifyEmail,
    configured: false,
    source: 'none',
  };
}

export function getSmtpPublicStatus(): SmtpPublicStatus {
  const resolved = resolveSmtpForSending();
  const cfg = getSmtpConfig();
  return {
    enabled: cfg.enabled,
    configured: resolved.configured,
    host: resolved.host || cfg.host,
    port: resolved.port || cfg.port,
    secure: resolved.secure,
    user: resolved.user || cfg.user,
    from: resolved.from || cfg.from,
    parkNotifyEmail: resolved.parkNotifyEmail || cfg.parkNotifyEmail,
    hasPassword: !!(cfg.pass || (process.env.SMTP_PASS || '').trim()),
    source: resolved.source,
  };
}

export function updateSmtpConfig(updates: Partial<SmtpConfig> & { clearPassword?: boolean }): SmtpPublicStatus {
  const current = getSmtpConfig();
  const next: SmtpConfig = {
    host: (updates.host ?? current.host).trim() || DEFAULTS.host,
    port: Number(updates.port ?? current.port) || 587,
    secure: updates.secure !== undefined ? !!updates.secure : current.secure,
    user: (updates.user ?? current.user).trim(),
    pass: current.pass,
    from: (updates.from ?? current.from).trim(),
    parkNotifyEmail: (updates.parkNotifyEmail ?? current.parkNotifyEmail).trim(),
    enabled: updates.enabled !== undefined ? !!updates.enabled : current.enabled,
  };

  if (updates.clearPassword) {
    next.pass = '';
  } else if (typeof updates.pass === 'string' && updates.pass.length > 0) {
    // Only replace password when a new non-empty value is provided
    next.pass = updates.pass;
  }

  if (next.port === 465) next.secure = true;

  const config = loadConfig();
  config.smtp = next;
  saveConfig(config);
  return getSmtpPublicStatus();
}
