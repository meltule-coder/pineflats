/**
 * Clover Hosted iframe helpers.
 * Card data goes browser → Clover only (never through park servers).
 * @see https://docs.clover.com/dev/docs/using-the-clover-hosted-iframe
 */

export type CloverPublicConfig = {
  ready: boolean;
  provider: string;
  testMode: boolean;
  displayName: string;
  publicKeyConfigured: boolean;
  /** PAKMS public apiAccessKey — safe for browser (not the private API token) */
  publicKey?: string;
  merchantId?: string;
  message: string;
};

export type CloverTokenResult = {
  token: string;
  last4?: string;
  brand?: string;
};

type CloverElement = {
  mount: (selector: string) => void;
  destroy?: () => void;
  addEventListener?: (event: string, handler: (e: unknown) => void) => void;
};

type CloverInstance = {
  elements: () => {
    create: (type: string, styles?: Record<string, unknown>) => CloverElement;
  };
  createToken: () => Promise<{
    token?: string;
    id?: string;
    errors?: Record<string, string> | string[];
    card?: { last4?: string; brand?: string; exp_month?: string; exp_year?: string };
  }>;
};

type CloverConstructor = new (
  publicKey: string,
  options?: { merchantId?: string; locale?: string }
) => CloverInstance;

declare global {
  interface Window {
    Clover?: CloverConstructor;
  }
}

const SDK_PROD = 'https://checkout.clover.com/sdk.js';
const SDK_SANDBOX = 'https://checkout.sandbox.dev.clover.com/sdk.js';

let loadPromise: Promise<void> | null = null;
let loadedSrc: string | null = null;

export function cloverSdkUrl(testMode: boolean): string {
  return testMode ? SDK_SANDBOX : SDK_PROD;
}

/** Load Clover iframe SDK once (sandbox or production). */
export function loadCloverSdk(testMode: boolean): Promise<void> {
  const src = cloverSdkUrl(testMode);
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Clover SDK requires a browser'));
  }
  if (window.Clover && loadedSrc === src) {
    return Promise.resolve();
  }
  // If the wrong mode SDK is already loaded, force reload
  if (loadPromise && loadedSrc === src) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    // Remove prior script if switching sandbox ↔ live
    if (loadedSrc && loadedSrc !== src) {
      document.querySelectorAll('script[data-clover-sdk]').forEach((el) => el.remove());
      // Clover attaches to window; clearing forces re-init of next script
      try {
        delete (window as { Clover?: CloverConstructor }).Clover;
      } catch {
        (window as { Clover?: CloverConstructor }).Clover = undefined;
      }
      loadPromise = null;
    }

    const existing = document.querySelector(`script[data-clover-sdk="${src}"]`);
    if (existing && window.Clover) {
      loadedSrc = src;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.cloverSdk = src;
    script.onload = () => {
      if (!window.Clover) {
        reject(new Error('Clover SDK loaded but window.Clover is missing'));
        return;
      }
      loadedSrc = src;
      resolve();
    };
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('Could not load Clover payment form SDK'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function createCloverInstance(
  publicKey: string,
  merchantId?: string
): CloverInstance {
  if (!window.Clover) {
    throw new Error('Clover SDK is not loaded');
  }
  const opts: { merchantId?: string; locale?: string } = { locale: 'en-US' };
  if (merchantId?.trim()) opts.merchantId = merchantId.trim();
  return new window.Clover(publicKey.trim(), opts);
}

export function parseCloverTokenResult(
  result: Awaited<ReturnType<CloverInstance['createToken']>>
): CloverTokenResult {
  if (result.errors) {
    const err = result.errors;
    if (Array.isArray(err)) {
      throw new Error(err.filter(Boolean).join(' ') || 'Card could not be validated.');
    }
    const msg = Object.values(err).filter(Boolean).join(' ') || 'Card could not be validated.';
    throw new Error(msg);
  }
  // Clover iframe may return token as string, or nested { id }, or top-level id
  let token = '';
  const rawTok = (result as { token?: unknown }).token;
  if (typeof rawTok === 'string') token = rawTok.trim();
  else if (rawTok && typeof rawTok === 'object' && typeof (rawTok as { id?: string }).id === 'string') {
    token = String((rawTok as { id: string }).id).trim();
  }
  if (!token && typeof result.id === 'string') token = result.id.trim();
  if (!token.startsWith('clv_')) {
    throw new Error(
      'Clover did not return a card token. Re-enter the card in the secure form and try again. If this keeps happening, check Reports → Payment processor (live vs sandbox) and the PAKMS public key.'
    );
  }
  const last4 = result.card?.last4
    ? String(result.card.last4).replace(/\D/g, '').slice(-4)
    : undefined;
  const brand = result.card?.brand ? String(result.card.brand) : undefined;
  return { token, last4, brand };
}
