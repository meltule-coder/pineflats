/**
 * Payment processor connection layer.
 *
 * Manual cash/check/etc. recording stays as-is. Card charges go through the
 * selected processor (Clover Ecommerce API is implemented).
 *
 * Secrets: env vars win; otherwise data/payment-processor-secrets.json
 *   PAYMENT_PROCESSOR_SECRET_KEY      — Clover private API / OAuth access_token
 *   PAYMENT_PROCESSOR_WEBHOOK_SECRET
 *   PAYMENT_PROCESSOR_PROVIDER        — optional override: clover | stripe | …
 */

import crypto from 'crypto';
import {
  getPaymentProcessorConfig,
  type PaymentProcessorConfig,
  type PaymentProviderId,
} from './paymentProcessorStore';
import {
  getPaymentProcessorSecrets,
  paymentSecretsStatus,
} from './paymentProcessorSecrets';

export type PaymentChargeStatus =
  | 'succeeded'
  | 'pending'
  | 'requires_action'
  | 'failed'
  | 'not_configured';

export interface PaymentChargeRequest {
  amountCents: number;
  currency?: string;
  description?: string;
  /** Guest or tenant reference for the processor dashboard. */
  customerEmail?: string;
  customerName?: string;
  /** Idempotency / correlation id for your records. */
  referenceId?: string;
  metadata?: Record<string, string>;
  /**
   * Clover card source token (clv_…) from Ecommerce tokenization / iframe.
   * Required for live Clover charges.
   */
  paymentMethodToken?: string;
  /**
   * Who entered card data for Clover ecomind:
   * - ecom = customer entered (public booking)
   * - moto = merchant entered (admin back office / phone)
   */
  ecomind?: 'ecom' | 'moto';
  /** Client IP for Clover fraud checks (x-forwarded-for). */
  clientIp?: string;
}

export interface PaymentChargeResult {
  ok: boolean;
  status: PaymentChargeStatus;
  /** Processor charge / payment intent id when live. */
  processorPaymentId?: string;
  clientSecret?: string;
  message: string;
  provider: PaymentProviderId;
  testMode: boolean;
  raw?: unknown;
}

export interface PaymentProcessorStatus {
  connected: boolean;
  ready: boolean;
  provider: PaymentProviderId;
  enabled: boolean;
  testMode: boolean;
  displayName: string;
  publicKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  merchantId: string;
  notes: string;
  updatedAt?: string;
  /** Safe message for admin UI. */
  message: string;
  /** Providers selectable in Settings. */
  availableProviders: Array<{ id: PaymentProviderId; label: string; ready: boolean }>;
  /** Where the secret was loaded from (for admin hints). */
  secretFromEnv?: boolean;
  webhookFromEnv?: boolean;
}

export interface ProcessorTestResult {
  ok: boolean;
  provider: PaymentProviderId;
  testMode: boolean;
  message: string;
  merchantName?: string;
  detail?: string;
}

function envProviderOverride(): PaymentProviderId | null {
  const v = String(process.env.PAYMENT_PROCESSOR_PROVIDER || '').trim().toLowerCase();
  if (v === 'clover' || v === 'stripe' || v === 'square' || v === 'other' || v === 'none') {
    return v;
  }
  return null;
}

function effectiveConfig(): PaymentProcessorConfig {
  const cfg = getPaymentProcessorConfig();
  const override = envProviderOverride();
  if (override && override !== 'none') {
    return { ...cfg, provider: override };
  }
  return cfg;
}

function secretKey(): string {
  return getPaymentProcessorSecrets().secretKey;
}

function webhookSecret(): string {
  return getPaymentProcessorSecrets().webhookSecret;
}

/** Clover Ecommerce (SCL) base for charges. */
export function cloverEcommerceBase(testMode: boolean): string {
  return testMode
    ? 'https://scl-sandbox.dev.clover.com'
    : 'https://scl.clover.com';
}

/** Clover REST API base (merchant lookup). */
export function cloverApiBase(testMode: boolean): string {
  return testMode
    ? 'https://apisandbox.dev.clover.com'
    : 'https://api.clover.com';
}

/** Clover card token endpoint (client-side / server tokenize). */
export function cloverTokenBase(testMode: boolean): string {
  return testMode
    ? 'https://token-sandbox.dev.clover.com'
    : 'https://token.clover.com';
}

function isProviderImplemented(id: PaymentProviderId): boolean {
  return id === 'clover';
}

export function getPaymentProcessorStatus(): PaymentProcessorStatus {
  const cfg = effectiveConfig();
  const secretsMeta = paymentSecretsStatus();
  const hasSecret = secretsMeta.secretKeySet;
  const hasWebhook = secretsMeta.webhookSecretSet;
  const publicKeyConfigured = !!cfg.publicKey;
  const hasMerchant = !!cfg.merchantId;
  const hasProvider = cfg.provider !== 'none';
  const implemented = isProviderImplemented(cfg.provider);

  // Connected = operator chose a provider and stored at least one credential piece.
  const connected =
    hasProvider && (publicKeyConfigured || hasSecret || hasMerchant || cfg.enabled);

  // Ready for live charges: Clover needs private key + merchant + enabled.
  // Public/PAKMS key is recommended for browser tokenization but server can charge a clv_ token without it.
  const ready =
    implemented &&
    cfg.enabled &&
    hasProvider &&
    hasSecret &&
    hasMerchant;

  let message: string;
  if (!hasProvider) {
    message =
      'No payment processor selected. Choose Clover (or another provider) so card vaulting and charges stay off the park admin site.';
  } else if (!implemented) {
    message = `${labelFor(cfg.provider)} is listed but not wired yet. Select Clover for live card charges, or keep recording payments manually.`;
  } else if (!cfg.enabled) {
    message = `${labelFor(cfg.provider)} is selected but not enabled. Turn on “Enable” after you enter Merchant ID and private API token.`;
  } else if (!hasSecret || !hasMerchant) {
    const missing: string[] = [];
    if (!hasMerchant) missing.push('Merchant ID');
    if (!hasSecret) missing.push('private API token');
    message = `Clover is selected. Still need: ${missing.join(' and ')}. Public/PAKMS key is optional until you use browser card entry.`;
  } else if (!publicKeyConfigured) {
    message =
      'Clover is ready for server charges with a card token (clv_…). Add the Public/PAKMS key when you enable online card entry on booking pages.';
  } else {
    message =
      cfg.testMode
        ? 'Clover sandbox is ready. Test charges use sandbox keys; turn off Test mode for live cards.'
        : 'Clover is live. Charges go to your Clover merchant; park admin only stores method “Card” and optional type + last 4.';
  }

  return {
    connected,
    ready,
    provider: cfg.provider,
    enabled: cfg.enabled,
    testMode: cfg.testMode,
    displayName: cfg.displayName,
    publicKeyConfigured,
    secretKeyConfigured: hasSecret,
    webhookSecretConfigured: hasWebhook,
    merchantId: cfg.merchantId,
    notes: cfg.notes,
    updatedAt: cfg.updatedAt,
    message,
    availableProviders: [
      { id: 'none', label: 'None (manual payments only)', ready: true },
      { id: 'clover', label: 'Clover', ready: true },
      { id: 'stripe', label: 'Stripe (coming soon)', ready: false },
      { id: 'square', label: 'Square (coming soon)', ready: false },
      { id: 'other', label: 'Other / custom (coming soon)', ready: false },
    ],
    secretFromEnv: secretsMeta.secretFromEnv,
    webhookFromEnv: secretsMeta.webhookFromEnv,
  };
}

function labelFor(id: PaymentProviderId): string {
  switch (id) {
    case 'clover':
      return 'Clover';
    case 'stripe':
      return 'Stripe';
    case 'square':
      return 'Square';
    case 'other':
      return 'Custom processor';
    default:
      return 'No processor';
  }
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function cloverErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const o = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.message === 'string' && o.message.trim()) parts.push(o.message.trim());
  if (typeof o.code === 'string' && o.code.trim()) parts.push(`code: ${o.code}`);
  if (typeof o.decline_code === 'string' && o.decline_code.trim()) {
    parts.push(`decline: ${o.decline_code}`);
  }
  if (typeof o.param === 'string' && o.param.trim()) parts.push(`param: ${o.param}`);
  if (typeof o.type === 'string' && o.type.trim() && !parts.length) parts.push(o.type);
  if (typeof o.error === 'string' && o.error.trim()) parts.push(o.error.trim());
  if (o.error && typeof o.error === 'object') {
    const e = o.error as Record<string, unknown>;
    if (typeof e.message === 'string') parts.push(e.message);
  }
  if (Array.isArray(o.errors) && o.errors.length) {
    const first = o.errors[0];
    if (typeof first === 'string') parts.push(first);
    if (first && typeof first === 'object' && typeof (first as { message?: string }).message === 'string') {
      parts.push((first as { message: string }).message);
    }
  }
  if (parts.length) return parts.join(' · ');
  return fallback;
}

function shortExternalRef(ref?: string): string | undefined {
  // Clover external_reference_id: max 12 alphanumeric (with spaces) for US
  if (!ref) return undefined;
  const cleaned = String(ref)
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
  return cleaned || undefined;
}

function newIdempotencyKey(): string {
  try {
    // Node 18+
    return crypto.randomUUID();
  } catch {
    return `pf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Verify Clover credentials.
 * 1) Ecommerce PAKMS (proves private token works; returns real merchantUuid)
 * 2) Merchant REST GET /v3/merchants/{mId}
 * Numeric “business MID” values are not Clover API merchant UUIDs — PAKMS supplies the real id.
 */
export async function testProcessorConnection(): Promise<ProcessorTestResult> {
  const cfg = effectiveConfig();
  const status = getPaymentProcessorStatus();

  if (cfg.provider === 'none') {
    return {
      ok: false,
      provider: cfg.provider,
      testMode: cfg.testMode,
      message: 'Select Clover as the provider first.',
    };
  }

  if (cfg.provider !== 'clover') {
    return {
      ok: false,
      provider: cfg.provider,
      testMode: cfg.testMode,
      message: `${labelFor(cfg.provider)} connection test is not available yet. Use Clover.`,
    };
  }

  const token = secretKey();
  let mId = cfg.merchantId.trim();
  if (!token) {
    return {
      ok: false,
      provider: 'clover',
      testMode: cfg.testMode,
      message: 'Enter Clover private API token, then save, then test.',
    };
  }

  // Prefer env matching token: try configured mode first, then the other.
  const modes = cfg.testMode ? [true, false] : [false, true];

  try {
    let pakmsOk = false;
    let workingTestMode = cfg.testMode;
    let merchantName: string | undefined;
    let discoveredUuid: string | undefined;
    let discoveredPakmsKey: string | undefined;
    let lastErr = 'Clover rejected the credentials.';

    for (const mode of modes) {
      const scl = cloverEcommerceBase(mode);
      const pakmsRes = await fetch(`${scl}/pakms/apikey`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const pakmsBody = await parseJsonSafe(pakmsRes);
      if (pakmsRes.ok && pakmsBody && typeof pakmsBody === 'object') {
        const o = pakmsBody as Record<string, unknown>;
        if (o.active === true || o.apiAccessKey || o.merchantUuid) {
          pakmsOk = true;
          workingTestMode = mode;
          if (typeof o.merchantUuid === 'string') discoveredUuid = o.merchantUuid.trim();
          if (typeof o.apiAccessKey === 'string') discoveredPakmsKey = o.apiAccessKey.trim();
          break;
        }
      }
      lastErr = cloverErrorMessage(
        pakmsBody,
        `Clover PAKMS HTTP ${pakmsRes.status} (${mode ? 'sandbox' : 'production'})`
      );
    }

    if (!pakmsOk) {
      return {
        ok: false,
        provider: 'clover',
        testMode: cfg.testMode,
        message: `${lastErr}. Check the private API token (OAuth access token) and Test mode.`,
      };
    }

    // Prefer Clover merchant UUID from PAKMS when user entered a numeric business MID
    if (discoveredUuid) {
      mId = discoveredUuid;
    }
    if (!mId) {
      return {
        ok: false,
        provider: 'clover',
        testMode: workingTestMode,
        message:
          'Token works, but no Merchant ID was found. Enter your Clover merchant UUID (not the numeric business MID).',
      };
    }

    // Persist corrected merchant UUID / public key / testMode so admin stays in sync
    try {
      const { updatePaymentProcessorConfig } = await import('./paymentProcessorStore');
      const patch: Partial<import('./paymentProcessorStore').PaymentProcessorConfig> = {
        merchantId: mId,
        testMode: workingTestMode,
      };
      if (discoveredPakmsKey && !cfg.publicKey) patch.publicKey = discoveredPakmsKey;
      // Keep numeric business id in notes if it was the only merchantId before
      if (/^\d{10,}$/.test(cfg.merchantId.trim()) && cfg.merchantId.trim() !== mId) {
        const tag = `Business merchant # ${cfg.merchantId.trim()}`;
        if (!cfg.notes.includes(tag)) {
          patch.notes = cfg.notes ? `${cfg.notes} · ${tag}` : tag;
        }
      }
      updatePaymentProcessorConfig(patch);
    } catch {
      /* non-fatal */
    }

    const apiUrl = `${cloverApiBase(workingTestMode)}/v3/merchants/${encodeURIComponent(mId)}`;
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    const body = await parseJsonSafe(res);
    if (res.ok && body && typeof body === 'object') {
      const name = (body as { name?: string }).name;
      if (typeof name === 'string') merchantName = name;
    }

    // PAKMS success is enough for Ecommerce readiness even if merchant REST lacks scopes
    return {
      ok: true,
      provider: 'clover',
      testMode: workingTestMode,
      message: merchantName
        ? `Connected to Clover merchant “${merchantName}” (${workingTestMode ? 'sandbox' : 'live'}).`
        : `Connected to Clover (${workingTestMode ? 'sandbox' : 'live'}). Merchant UUID: ${mId}.`,
      merchantName,
      detail: status.ready || cfg.enabled
        ? 'Processor credentials verified. Ready for charges with a card token (clv_…).'
        : 'Credentials work — enable the processor if you have not already.',
    };
  } catch (e) {
    return {
      ok: false,
      provider: 'clover',
      testMode: cfg.testMode,
      message: e instanceof Error ? e.message : 'Network error reaching Clover.',
    };
  }
}

async function chargeWithClover(req: PaymentChargeRequest): Promise<PaymentChargeResult> {
  const cfg = effectiveConfig();
  const token = secretKey();
  const amount = Math.round(Number(req.amountCents));
  const currency = (req.currency || 'usd').toLowerCase();
  const source = String(req.paymentMethodToken || '').trim();

  if (!token || !cfg.merchantId) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'Clover is not fully configured (need Merchant ID + private API token).',
      provider: 'clover',
      testMode: cfg.testMode,
    };
  }

  if (!Number.isFinite(amount) || amount < 1) {
    return {
      ok: false,
      status: 'failed',
      message: 'Charge amount must be at least 1 cent.',
      provider: 'clover',
      testMode: cfg.testMode,
    };
  }

  if (!source || !source.startsWith('clv_')) {
    return {
      ok: false,
      status: 'failed',
      message:
        'Clover charge needs a card source token (clv_…). Tokenize the card with your PAKMS public key, or run the card on a Clover terminal and record payment manually.',
      provider: 'clover',
      testMode: cfg.testMode,
    };
  }

  const url = `${cloverEcommerceBase(cfg.testMode)}/v1/charges`;
  const payload: Record<string, unknown> = {
    amount,
    currency,
    source,
    capture: true,
    // Admin/back-office card entry is MOTO; public booking is ecom
    ecomind: req.ecomind === 'ecom' ? 'ecom' : 'moto',
  };
  if (req.description) payload.description = String(req.description).slice(0, 255);
  const extRef = shortExternalRef(req.referenceId);
  if (extRef) payload.external_reference_id = extRef;
  if (req.metadata && Object.keys(req.metadata).length) {
    // Clover metadata total length limit ~500 chars
    const meta: Record<string, string> = {};
    let len = 0;
    for (const [k, v] of Object.entries(req.metadata)) {
      const val = String(v).slice(0, 80);
      if (len + k.length + val.length > 480) break;
      meta[k] = val;
      len += k.length + val.length;
    }
    if (Object.keys(meta).length) payload.metadata = meta;
  }
  // ecom receipt email when available
  if (req.customerEmail) {
    payload.receipt_email = String(req.customerEmail).slice(0, 254);
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      // Required for safe retries; also reduces intermittent 400s
      'idempotency-key': newIdempotencyKey(),
    };
    if (req.clientIp) {
      headers['x-forwarded-for'] = req.clientIp;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const body = await parseJsonSafe(res);
    if (!res.ok) {
      const msg = cloverErrorMessage(body, `Clover charge failed (HTTP ${res.status}).`);
      console.error('[clover charge]', res.status, msg, body);
      return {
        ok: false,
        status: 'failed',
        message: msg,
        provider: 'clover',
        testMode: cfg.testMode,
        raw: body,
      };
    }

    const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : undefined;
    const paid = o.paid === true || o.status === 'succeeded' || o.status === 'paid';
    const statusStr = String(o.status || '').toLowerCase();

    if (paid || statusStr === 'succeeded') {
      return {
        ok: true,
        status: 'succeeded',
        processorPaymentId: id,
        message: `Clover charge succeeded${id ? ` (${id})` : ''}.`,
        provider: 'clover',
        testMode: cfg.testMode,
        raw: body,
      };
    }

    if (statusStr === 'pending' || statusStr === 'requires_capture') {
      return {
        ok: true,
        status: 'pending',
        processorPaymentId: id,
        message: 'Clover charge is pending.',
        provider: 'clover',
        testMode: cfg.testMode,
        raw: body,
      };
    }

    return {
      ok: false,
      status: 'failed',
      processorPaymentId: id,
      message: cloverErrorMessage(body, `Clover charge status: ${statusStr || 'unknown'}`),
      provider: 'clover',
      testMode: cfg.testMode,
      raw: body,
    };
  } catch (e) {
    return {
      ok: false,
      status: 'failed',
      message: e instanceof Error ? e.message : 'Network error charging via Clover.',
      provider: 'clover',
      testMode: cfg.testMode,
    };
  }
}

export type CloverTokenizeInput = {
  number: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  zip?: string;
};

export type CloverTokenizeResult =
  | { ok: true; token: string; last4: string }
  | { ok: false; message: string };

/**
 * Create a one-time Clover card token (clv_…) via PAKMS public key.
 * Card data is used only for this request — never stored.
 */
export async function tokenizeCloverCard(
  input: CloverTokenizeInput
): Promise<CloverTokenizeResult> {
  const cfg = effectiveConfig();
  if (cfg.provider !== 'clover') {
    return { ok: false, message: 'Card tokenization requires Clover as the payment processor.' };
  }
  const pakms = cfg.publicKey.trim();
  if (!pakms) {
    return {
      ok: false,
      message: 'Clover public/PAKMS key is missing. Add it under Reports → Payment processor.',
    };
  }

  const number = String(input.number || '').replace(/\D/g, '');
  if (number.length < 13 || number.length > 19) {
    return { ok: false, message: 'Enter a valid card number.' };
  }
  let expMonth = String(input.expMonth || '').replace(/\D/g, '');
  if (expMonth.length === 1) expMonth = `0${expMonth}`;
  if (!/^(0[1-9]|1[0-2])$/.test(expMonth)) {
    return { ok: false, message: 'Enter a valid expiration month (01–12).' };
  }
  let expYear = String(input.expYear || '').replace(/\D/g, '');
  if (expYear.length === 2) expYear = `20${expYear}`;
  if (expYear.length !== 4) {
    return { ok: false, message: 'Enter a valid expiration year.' };
  }
  const cvv = String(input.cvv || '').replace(/\D/g, '');
  if (cvv.length < 3 || cvv.length > 4) {
    return { ok: false, message: 'Enter a valid CVV.' };
  }
  const zip = String(input.zip || '').replace(/[^\dA-Za-z- ]/g, '').trim().slice(0, 12);

  const url = `${cloverTokenBase(cfg.testMode)}/v1/tokens`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: pakms,
      },
      body: JSON.stringify({
        card: {
          number,
          exp_month: expMonth,
          exp_year: expYear,
          cvv,
          ...(zip ? { address_zip: zip } : {}),
        },
      }),
    });
    const body = await parseJsonSafe(res);
    if (!res.ok) {
      return {
        ok: false,
        message: cloverErrorMessage(body, `Card could not be processed (HTTP ${res.status}).`),
      };
    }
    const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const token = typeof o.id === 'string' ? o.id.trim() : '';
    if (!token.startsWith('clv_')) {
      return {
        ok: false,
        message: 'Clover did not return a card token. Check the public key and try again.',
      };
    }
    return { ok: true, token, last4: number.slice(-4) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Network error contacting Clover for card tokenization.',
    };
  }
}

/**
 * Safe public snapshot for the booking payment page.
 * Includes PAKMS public key (apiAccessKey) for Clover Hosted iframe —
 * that key is designed for the browser; private API token is never exposed.
 */
export function getPublicCheckoutProcessorInfo() {
  const cfg = effectiveConfig();
  const status = getPaymentProcessorStatus();
  const publicKey = cfg.publicKey.trim();
  const merchantId = cfg.merchantId.trim();
  const onlineCardReady =
    status.ready &&
    cfg.provider === 'clover' &&
    !!publicKey;
  return {
    ready: onlineCardReady,
    provider: cfg.provider,
    testMode: cfg.testMode,
    displayName: cfg.displayName || (cfg.provider === 'clover' ? 'Clover' : ''),
    publicKeyConfigured: !!publicKey,
    /** Public PAKMS key for Clover iframe SDK (not the private API token). */
    publicKey: onlineCardReady ? publicKey : undefined,
    merchantId: onlineCardReady && merchantId ? merchantId : undefined,
    message: onlineCardReady
      ? cfg.testMode
        ? 'Card payments are in Clover sandbox (test) mode via secure iframe.'
        : 'Card payments are processed securely through Clover hosted fields (card data never touches the park website).'
      : status.ready
        ? 'Clover is connected but the public/PAKMS key is missing for online card entry. Run “Test connection” or add the public key under Payment processor.'
        : status.message,
  };
}

/**
 * Attempt a card charge through the configured processor.
 */
export async function chargeWithProcessor(
  req: PaymentChargeRequest
): Promise<PaymentChargeResult> {
  const cfg = effectiveConfig();
  const status = getPaymentProcessorStatus();

  if (cfg.provider === 'none') {
    return {
      ok: false,
      status: 'not_configured',
      message: 'No payment processor connected. Record the payment manually for now.',
      provider: cfg.provider,
      testMode: cfg.testMode,
    };
  }

  if (!status.ready) {
    return {
      ok: false,
      status: 'not_configured',
      message: `${labelFor(cfg.provider)} is not fully connected yet. Check Merchant ID, private API token, and Enable.`,
      provider: cfg.provider,
      testMode: cfg.testMode,
    };
  }

  if (cfg.provider === 'clover') {
    return chargeWithClover(req);
  }

  return {
    ok: false,
    status: 'not_configured',
    message: `${labelFor(cfg.provider)} adapter is not implemented yet. Use Clover or record payment manually.`,
    provider: cfg.provider,
    testMode: cfg.testMode,
  };
}

/**
 * Create a hosted checkout / payment intent for online booking (future).
 * Currently same path as charge (token required).
 */
export async function createProcessorCheckout(
  req: PaymentChargeRequest
): Promise<PaymentChargeResult> {
  return chargeWithProcessor(req);
}

/**
 * Webhook body verification + event handling (stub — Clover signature check later).
 */
export function handleProcessorWebhook(
  _headers: Record<string, string | string[] | undefined>,
  _rawBody: string | Buffer
): { ok: boolean; handled: boolean; message: string } {
  const status = getPaymentProcessorStatus();
  if (!status.webhookSecretConfigured) {
    return {
      ok: false,
      handled: false,
      message: 'Webhook secret not configured.',
    };
  }
  // Acknowledge receipt; full Clover event routing can be added when needed.
  void webhookSecret();
  return {
    ok: true,
    handled: false,
    message: 'Webhook endpoint ready. Event processing can be extended for Clover notifications.',
  };
}

/** Admin-safe config view: includes public key, never secret values. */
export function getPaymentProcessorPublicConfig() {
  const cfg = effectiveConfig();
  const status = getPaymentProcessorStatus();
  return {
    ...cfg,
    status,
    secretKeySet: status.secretKeyConfigured,
    webhookSecretSet: status.webhookSecretConfigured,
    secretFromEnv: status.secretFromEnv,
    webhookFromEnv: status.webhookFromEnv,
    /** Client helpers for Clover iframe / tokenization later */
    clover: {
      ecommerceBase: cloverEcommerceBase(cfg.testMode),
      tokenBase: cloverTokenBase(cfg.testMode),
      apiBase: cloverApiBase(cfg.testMode),
    },
  };
}
