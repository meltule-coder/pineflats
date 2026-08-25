/**
 * Server-only payment processor secrets.
 * Never returned by API (only booleans "set"). Env vars always win over file.
 *
 *   PAYMENT_PROCESSOR_SECRET_KEY
 *   PAYMENT_PROCESSOR_WEBHOOK_SECRET
 *
 * Optional admin-saved file (gitignored under data/):
 *   data/payment-processor-secrets.json
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteJson, ensureDataDir } from './persist';

const DATA_DIR = path.join(process.cwd(), 'data');
const SECRETS_FILE = path.join(DATA_DIR, 'payment-processor-secrets.json');

export interface PaymentProcessorSecrets {
  /** Clover private API / OAuth access token, Stripe secret, etc. */
  secretKey: string;
  webhookSecret: string;
}

const EMPTY: PaymentProcessorSecrets = { secretKey: '', webhookSecret: '' };

function loadFileSecrets(): PaymentProcessorSecrets {
  ensureDataDir(DATA_DIR);
  if (!fs.existsSync(SECRETS_FILE)) return { ...EMPTY };
  try {
    const raw = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf-8')) as Partial<PaymentProcessorSecrets>;
    return {
      secretKey: String(raw.secretKey || '').trim(),
      webhookSecret: String(raw.webhookSecret || '').trim(),
    };
  } catch {
    return { ...EMPTY };
  }
}

function saveFileSecrets(secrets: PaymentProcessorSecrets): void {
  ensureDataDir(DATA_DIR);
  atomicWriteJson(SECRETS_FILE, {
    secretKey: secrets.secretKey,
    webhookSecret: secrets.webhookSecret,
  });
}

/** Effective secrets: environment overrides file. */
export function getPaymentProcessorSecrets(): PaymentProcessorSecrets {
  const file = loadFileSecrets();
  return {
    secretKey: String(process.env.PAYMENT_PROCESSOR_SECRET_KEY || '').trim() || file.secretKey,
    webhookSecret:
      String(process.env.PAYMENT_PROCESSOR_WEBHOOK_SECRET || '').trim() || file.webhookSecret,
  };
}

/**
 * Update secrets from admin. Empty string fields are ignored (keep existing).
 * Pass clearSecretKey / clearWebhookSecret to wipe a value (file only; env still wins).
 */
export function updatePaymentProcessorSecrets(input: {
  secretKey?: string;
  webhookSecret?: string;
  clearSecretKey?: boolean;
  clearWebhookSecret?: boolean;
}): PaymentProcessorSecrets {
  const current = loadFileSecrets();
  const next: PaymentProcessorSecrets = { ...current };

  if (input.clearSecretKey) {
    next.secretKey = '';
  } else if (typeof input.secretKey === 'string' && input.secretKey.trim()) {
    next.secretKey = input.secretKey.trim();
  }

  if (input.clearWebhookSecret) {
    next.webhookSecret = '';
  } else if (typeof input.webhookSecret === 'string' && input.webhookSecret.trim()) {
    next.webhookSecret = input.webhookSecret.trim();
  }

  saveFileSecrets(next);
  return getPaymentProcessorSecrets();
}

export function paymentSecretsStatus(): {
  secretKeySet: boolean;
  webhookSecretSet: boolean;
  secretFromEnv: boolean;
  webhookFromEnv: boolean;
} {
  const envSecret = !!String(process.env.PAYMENT_PROCESSOR_SECRET_KEY || '').trim();
  const envWebhook = !!String(process.env.PAYMENT_PROCESSOR_WEBHOOK_SECRET || '').trim();
  const file = loadFileSecrets();
  const effective = getPaymentProcessorSecrets();
  return {
    secretKeySet: !!effective.secretKey,
    webhookSecretSet: !!effective.webhookSecret,
    secretFromEnv: envSecret,
    webhookFromEnv: envWebhook,
  };
}
