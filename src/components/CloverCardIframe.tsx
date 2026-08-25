import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { Loader2, Lock, Shield } from 'lucide-react';
import {
  createCloverInstance,
  loadCloverSdk,
  parseCloverTokenResult,
  type CloverTokenResult,
} from '../lib/clover';

export type CloverCardIframeHandle = {
  /** Tokenize card fields inside Clover iframe → clv_ token (never touches park server). */
  createToken: () => Promise<CloverTokenResult>;
};

type Props = {
  publicKey: string;
  merchantId?: string;
  testMode?: boolean;
  /** Optional note under the form */
  footnote?: string;
};

const FIELD_STYLES = {
  input: {
    fontSize: '16px',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    color: '#3D3730',
  },
};

/**
 * Clover Hosted iframe card form.
 * PAN/CVV never enter park DOM inputs or park APIs — only a clv_ token is returned.
 */
export const CloverCardIframe = forwardRef<CloverCardIframeHandle, Props>(function CloverCardIframe(
  { publicKey, merchantId, testMode = false, footnote },
  ref
) {
  const uid = useId().replace(/:/g, '');
  const ids = {
    number: `clover-card-number-${uid}`,
    date: `clover-card-date-${uid}`,
    cvv: `clover-card-cvv-${uid}`,
    postal: `clover-card-postal-${uid}`,
  };

  const cloverRef = useRef<ReturnType<typeof createCloverInstance> | null>(null);
  const elementsRef = useRef<Array<{ destroy?: () => void }>>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    setFieldErrors({});
    cloverRef.current = null;
    elementsRef.current = [];

    (async () => {
      try {
        if (!publicKey.trim()) {
          throw new Error('Clover public/PAKMS key is not configured.');
        }
        await loadCloverSdk(!!testMode);
        if (cancelled) return;

        const clover = createCloverInstance(publicKey, merchantId);
        const elements = clover.elements();

        const cardNumber = elements.create('CARD_NUMBER', FIELD_STYLES);
        const cardDate = elements.create('CARD_DATE', FIELD_STYLES);
        const cardCvv = elements.create('CARD_CVV', FIELD_STYLES);
        const cardPostal = elements.create('CARD_POSTAL_CODE', FIELD_STYLES);

        // Wait a tick so mount targets exist
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
        if (cancelled) return;

        cardNumber.mount(`#${ids.number}`);
        cardDate.mount(`#${ids.date}`);
        cardCvv.mount(`#${ids.cvv}`);
        cardPostal.mount(`#${ids.postal}`);

        const wire = (el: { addEventListener?: (e: string, h: (ev: unknown) => void) => void }, key: string) => {
          el.addEventListener?.('change', (event) => {
            const e = event as { error?: string; CARD_NUMBER?: { error?: string }; CARD_DATE?: { error?: string }; CARD_CVV?: { error?: string }; CARD_POSTAL_CODE?: { error?: string } };
            // Clover may send flat or nested shapes
            const msg =
              e?.error ||
              e?.[key as 'CARD_NUMBER']?.error ||
              '';
            setFieldErrors((prev) => {
              const next = { ...prev };
              if (msg) next[key] = String(msg);
              else delete next[key];
              return next;
            });
          });
        };
        wire(cardNumber, 'CARD_NUMBER');
        wire(cardDate, 'CARD_DATE');
        wire(cardCvv, 'CARD_CVV');
        wire(cardPostal, 'CARD_POSTAL_CODE');

        elementsRef.current = [cardNumber, cardDate, cardCvv, cardPostal];
        cloverRef.current = clover;
        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setError(e instanceof Error ? e.message : 'Could not load secure card form');
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const el of elementsRef.current) {
        try {
          el.destroy?.();
        } catch {
          /* ignore */
        }
      }
      elementsRef.current = [];
      cloverRef.current = null;
    };
    // ids are stable per component instance (uid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, merchantId, testMode]);

  useImperativeHandle(ref, () => ({
    async createToken() {
      if (!cloverRef.current) {
        throw new Error('Secure card form is not ready yet. Wait a moment and try again.');
      }
      const result = await cloverRef.current.createToken();
      return parseCloverTokenResult(result);
    },
  }));

  const fieldBox =
    'min-h-[48px] px-3 py-2 bg-white border border-[#E2D9D0] rounded-2xl focus-within:ring-1 focus-within:ring-[#5A6355]';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-[#5A6355]">
          <Lock className="w-3.5 h-3.5" />
          <span className="font-semibold uppercase tracking-widest">
            Secured by Clover
          </span>
        </div>
        {testMode && (
          <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
            Test mode
          </span>
        )}
      </div>

      {status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-[#5A6355] py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading secure card fields…
        </div>
      )}

      {status === 'error' && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          {error || 'Secure card form failed to load.'}
        </p>
      )}

      <div className={status === 'ready' ? 'space-y-3' : 'space-y-3 opacity-40 pointer-events-none'}>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355] font-medium">
            Card number *
          </label>
          <div id={ids.number} className={fieldBox} />
          {fieldErrors.CARD_NUMBER && (
            <p className="text-xs text-red-600">{fieldErrors.CARD_NUMBER}</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-[#5A6355] font-medium">
              Exp. date *
            </label>
            <div id={ids.date} className={fieldBox} />
            {fieldErrors.CARD_DATE && (
              <p className="text-xs text-red-600">{fieldErrors.CARD_DATE}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-[#5A6355] font-medium">
              CVV *
            </label>
            <div id={ids.cvv} className={fieldBox} />
            {fieldErrors.CARD_CVV && (
              <p className="text-xs text-red-600">{fieldErrors.CARD_CVV}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-[#5A6355] font-medium">
              Billing ZIP *
            </label>
            <div id={ids.postal} className={fieldBox} />
            {fieldErrors.CARD_POSTAL_CODE && (
              <p className="text-xs text-red-600">{fieldErrors.CARD_POSTAL_CODE}</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 text-[11px] text-[#5A6355] bg-white border border-[#E2D9D0] rounded-xl px-3 py-2.5">
        <Shield className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>
          {footnote ||
            'Card numbers are entered in Clover’s secure form and never sent to or stored on the park website. Only a one-time payment token is used to complete the charge.'}
        </p>
      </div>
    </div>
  );
});
