import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

/**
 * Sensitive card fields sealed as one ciphertext blob.
 * Full PAN and CVV must never appear here.
 */
export interface CardSensitivePayload {
  cardholderName: string;
  last4: string;
  expMonth: string;
  expYear: string;
  billingZip?: string;
  label?: string;
  notes?: string;
}

function getKey(): Buffer {
  const secret =
    process.env.CARD_DATA_KEY?.trim()
    || process.env.PAYMENT_CARD_KEY?.trim()
    || '';
  if (!secret) {
    // Dev fallback — set CARD_DATA_KEY in production
    console.warn(
      '[cardSecurity] CARD_DATA_KEY is not set; using a derived dev key. Set CARD_DATA_KEY in .env for production.'
    );
  }
  const material = secret || 'pineflats-dev-only-card-key-change-me';
  return crypto.createHash('sha256').update(material, 'utf8').digest();
}

export function encryptSensitive(payload: CardSensitivePayload): string {
  const plain = JSON.stringify(payload);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX
    + [
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.')
  );
}

export function decryptSensitive(sealed: string): CardSensitivePayload | null {
  if (!sealed) return null;

  // Legacy plaintext migration path (pre-encryption cards)
  if (!sealed.startsWith(PREFIX)) {
    try {
      const legacy = JSON.parse(sealed) as CardSensitivePayload;
      if (legacy?.last4 && legacy?.cardholderName) return legacy;
    } catch {
      // ignore
    }
    return null;
  }

  try {
    const body = sealed.slice(PREFIX.length);
    const [ivB64, tagB64, dataB64] = body.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain) as CardSensitivePayload;
    if (!parsed?.last4 || !parsed?.cardholderName) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Digits only; reject empty. */
export function extractDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Only last 4 digits are allowed for storage.
 * Full PAN (13–19 digits) is reduced to last 4; never returned or logged.
 */
export function sanitizeToLast4(cardNumberOrLast4: string): string | null {
  const digits = extractDigits(cardNumberOrLast4);
  if (digits.length < 4) return null;
  // Explicitly drop any longer sequence (full card number)
  return digits.slice(-4);
}

export function detectCardBrandFromLast4Only(_last4: string, brandHint?: string): string {
  const hint = (brandHint || '').trim();
  if (hint) return hint;
  return 'Card';
}

export function isEncryptionConfigured(): boolean {
  return !!(process.env.CARD_DATA_KEY?.trim() || process.env.PAYMENT_CARD_KEY?.trim());
}
