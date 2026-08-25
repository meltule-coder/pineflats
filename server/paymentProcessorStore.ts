import fs from 'fs';
import path from 'path';
import { atomicWriteJson, ensureDataDir } from './persist';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'payment-processor.json');

/** Known processors. Clover is implemented; others reserved. */
export type PaymentProviderId = 'none' | 'clover' | 'stripe' | 'square' | 'other';

export interface PaymentProcessorConfig {
  /** Which processor will process card charges once keys are live. */
  provider: PaymentProviderId;
  /** When false, all processor charges are blocked (manual payment still works). */
  enabled: boolean;
  /** Use sandbox / test keys when the real integration is connected. */
  testMode: boolean;
  /** Human label shown in admin (e.g. "Park Clover account"). */
  displayName: string;
  /**
   * Publishable / public key only (safe to show in admin UI).
   * For Clover: Ecommerce PAKMS apiAccessKey (public).
   * Secret keys: env or data/payment-processor-secrets.json
   */
  publicKey: string;
  /** Merchant / location id — Clover mId (merchant UUID). */
  merchantId: string;
  /** Free-form notes for the operator. */
  notes: string;
  updatedAt?: string;
}

const DEFAULT_CONFIG: PaymentProcessorConfig = {
  provider: 'none',
  enabled: false,
  testMode: true,
  displayName: '',
  publicKey: '',
  merchantId: '',
  notes: '',
};

const ALLOWED: PaymentProviderId[] = ['none', 'clover', 'stripe', 'square', 'other'];

function loadRaw(): PaymentProcessorConfig {
  ensureDataDir(DATA_DIR);
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Partial<PaymentProcessorConfig>;
    return normalizeConfig(raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function normalizeConfig(raw: Partial<PaymentProcessorConfig> | null | undefined): PaymentProcessorConfig {
  const provider = (raw?.provider || 'none') as PaymentProviderId;
  return {
    provider: ALLOWED.includes(provider) ? provider : 'none',
    enabled: Boolean(raw?.enabled),
    testMode: raw?.testMode !== false,
    displayName: String(raw?.displayName || '').trim(),
    publicKey: String(raw?.publicKey || '').trim(),
    merchantId: String(raw?.merchantId || '').trim(),
    notes: String(raw?.notes || '').trim(),
    updatedAt: raw?.updatedAt,
  };
}

export function getPaymentProcessorConfig(): PaymentProcessorConfig {
  return loadRaw();
}

export function updatePaymentProcessorConfig(
  updates: Partial<PaymentProcessorConfig>
): PaymentProcessorConfig {
  const current = loadRaw();
  const next = normalizeConfig({
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  // Never allow enabled=true when provider is none
  if (next.provider === 'none') next.enabled = false;
  atomicWriteJson(CONFIG_FILE, next);
  return next;
}
