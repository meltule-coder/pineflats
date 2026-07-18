import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DEFAULT_PREVIEW_PASSWORD = 'pineflats';

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadConfig(): Record<string, unknown> {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_FILE)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

function saveConfig(config: Record<string, unknown>) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getPreviewPassword(): string {
  const fromEnv = process.env.PREVIEW_PASSWORD?.trim();
  if (fromEnv) return fromEnv;

  const config = loadConfig();
  const stored = typeof config.previewPassword === 'string' ? config.previewPassword.trim() : '';
  if (stored) return stored;

  return DEFAULT_PREVIEW_PASSWORD;
}

export function setPreviewPassword(password: string): void {
  const trimmed = password.trim();
  if (!trimmed) throw new Error('Password required');

  const config = loadConfig();
  config.previewPassword = trimmed;
  saveConfig(config);
}

export function verifyPreviewPassword(password: string): boolean {
  const attempt = password.trim();
  if (!attempt) return false;
  return attempt === getPreviewPassword();
}