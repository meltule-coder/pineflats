import fs from 'fs';
import path from 'path';
import { ParkContact } from '../types';
import { DEFAULT_CONTACT } from '../contactDefaults';
import { atomicWriteJson } from './persist';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

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
  atomicWriteJson(CONFIG_FILE, config);
}

export function getContactInfo(): ParkContact {
  const config = loadConfig();
  const stored = config.contact as Partial<ParkContact> | undefined;
  return { ...DEFAULT_CONTACT, ...stored };
}

export function updateContactInfo(updates: Partial<ParkContact>): ParkContact {
  const current = getContactInfo();
  const next: ParkContact = {
    phone: (updates.phone ?? current.phone).trim(),
    email: (updates.email ?? current.email).trim(),
    contactName: (updates.contactName ?? current.contactName).trim(),
    address: (updates.address ?? current.address ?? '').trim(),
    tagline: (updates.tagline ?? current.tagline).trim(),
    businessName: (updates.businessName ?? current.businessName ?? DEFAULT_CONTACT.businessName ?? '').trim(),
    logoUrl: (updates.logoUrl ?? current.logoUrl ?? DEFAULT_CONTACT.logoUrl ?? '/logo.png').trim() || '/logo.png',
    about: (updates.about ?? current.about ?? DEFAULT_CONTACT.about ?? '').trim(),
  };
  const config = loadConfig();
  config.contact = next;
  saveConfig(config);
  return next;
}