import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, CreditCard, Loader2, Lock } from 'lucide-react';
import { BookingContactInfo, RentalType } from '../../types';
import {
  DEFAULT_RENTAL_RATES,
  calculateStayNights, calculateStayBreakdown, parseDateKey,
  type RentalRatesConfig,
} from '../../rentUtils';
import { CloverCardIframe, type CloverCardIframeHandle } from './CloverCardIframe';
import type { CloverPublicConfig } from '../lib/clover';

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

const PAYMENT_METHODS = ['Card', 'Venmo', 'Zelle', 'Cash', 'Check'] as const;

interface BookingPaymentPageProps {
  slotId: string;
  siteLabel: string;
  rentalLabel: string;
  rentalType: RentalType;
  checkIn: string;
  checkOut: string;
  contact: BookingContactInfo;
  rates?: RentalRatesConfig;
  onBack: () => void;
  onComplete: (result?: { emailSent?: boolean }) => void;
}

export function BookingPaymentPage({
  slotId,
  siteLabel,
  rentalLabel,
  rentalType,
  checkIn,
  checkOut,
  contact,
  rates = DEFAULT_RENTAL_RATES,
  onBack,
  onComplete,
}: BookingPaymentPageProps) {
  const [paymentMethod, setPaymentMethod] = useState<string>('Card');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processor, setProcessor] = useState<CloverPublicConfig | null>(null);
  const cloverRef = useRef<CloverCardIframeHandle>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/public/payment-processor');
        if (!res.ok) return;
        const data = (await res.json()) as CloverPublicConfig;
        if (!cancelled) setProcessor(data);
      } catch {
        // card pay will surface error on submit
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const checkInDate = parseDateKey(checkIn);
  const checkOutDate = parseDateKey(checkOut);
  const nights = calculateStayNights(checkInDate, checkOutDate);
  const breakdown = calculateStayBreakdown(rentalType, checkInDate, checkOutDate, rates);
  const total = breakdown.grandTotal;

  const handlePay = async () => {
    setError(null);

    if (paymentMethod === 'Card') {
      if (processor && !processor.ready) {
        setError(
          processor.message ||
            'Online card payment is temporarily unavailable. Choose another method or call the park.'
        );
        return;
      }
      if (!processor?.publicKey) {
        setError('Secure card form is not configured. Please choose another payment method or call the park.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        slotId,
        rentalType,
        checkIn,
        checkOut,
        paymentMethod: paymentMethod === 'Card' ? 'Card' : paymentMethod,
        ...contact,
      };

      if (paymentMethod === 'Card') {
        // Tokenize inside Clover iframe — PAN/CVV never leave Clover / never hit park server
        const tok = await cloverRef.current!.createToken();
        payload.paymentMethodToken = tok.token;
        if (tok.last4) payload.cardLast4 = tok.last4;
        if (tok.brand) payload.cardBrand = tok.brand;
      }

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        onComplete({ emailSent: !!data.emailSent });
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Payment could not be completed. Please try again.');
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not complete payment. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F3F0] font-sans text-[#3D3730]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-[#5A6355] hover:text-[#3D3730] transition text-sm font-medium mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to contact info
        </button>

        <div className="mb-8">
          <p className="text-xs uppercase tracking-widest text-[#5A6355] mb-2">Step 2 of 2</p>
          <h1 className="text-3xl font-serif text-[#3D3730] mb-2">Payment</h1>
          <p className="text-sm text-[#5A6355]">
            Review your booking and complete payment to reserve your site.
          </p>
        </div>

        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 mb-6 shadow-sm space-y-4">
          <h2 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">
            Booking Details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A6355] mb-1">Guest</p>
              <p className="font-medium">{contact.contactName}</p>
              <p className="text-[#5A6355] text-xs mt-0.5">{contact.contactEmail}</p>
              <p className="text-[#5A6355] text-xs">{contact.contactPhone}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A6355] mb-1">
                Site & Stay
              </p>
              <p className="font-medium">
                {siteLabel} · {rentalLabel}
              </p>
              <p className="text-[#5A6355] text-xs mt-0.5">
                {checkInDate.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}{' '}
                –{' '}
                {checkOutDate.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
              <p className="text-[#5A6355] text-xs">
                {nights} night{nights === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <div className="pt-4 border-t border-[#E2D9D0] space-y-2 text-sm">
            <div className="flex justify-between gap-3 text-[#5A6355]">
              <span>
                Rent ({nights} night{nights === 1 ? '' : 's'})
              </span>
              <span>{formatCurrency(breakdown.subtotal)}</span>
            </div>
            {breakdown.taxApplies && breakdown.totalTax > 0 && (
              <>
                {breakdown.stateTax > 0 && (
                  <div className="flex justify-between gap-3 text-[#5A6355]">
                    <span>State transient tax ({breakdown.stateTaxPercent}%)</span>
                    <span>{formatCurrency(breakdown.stateTax)}</span>
                  </div>
                )}
                {breakdown.countyTax > 0 && (
                  <div className="flex justify-between gap-3 text-[#5A6355]">
                    <span>County transient tax ({breakdown.countyTaxPercent}%)</span>
                    <span>{formatCurrency(breakdown.countyTax)}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-[#E2D9D0]">
              <span className="text-sm font-medium">Total due today</span>
              <span className="text-2xl font-serif text-[#C29474]">{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
          <h2 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-[#5A6355]" />
            Payment Method
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PAYMENT_METHODS.map(method => (
              <button
                key={method}
                type="button"
                onClick={() => {
                  setPaymentMethod(method);
                  setError(null);
                }}
                className={`px-4 py-3 rounded-xl text-sm font-medium border-2 transition ${
                  paymentMethod === method
                    ? 'bg-[#C29474] border-[#C29474] text-white'
                    : 'bg-[#FBF9F7] border-[#E2D9D0] text-[#5A6355] hover:border-[#C29474]'
                }`}
              >
                {method}
              </button>
            ))}
          </div>

          {paymentMethod === 'Card' && (
            <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-white border border-[#E2D9D0] flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-[#5A6355]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#3D3730]">Credit or debit card</p>
                    <p className="text-[11px] text-[#5A6355]">
                      Visa, Mastercard, Amex, Discover · via {processor?.displayName || 'Clover'}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#5A6355] font-semibold">
                  <Lock className="w-3 h-3" />
                  PCI-compliant iframe
                </span>
              </div>

              {processor?.ready && processor.publicKey ? (
                <CloverCardIframe
                  ref={cloverRef}
                  publicKey={processor.publicKey}
                  merchantId={processor.merchantId}
                  testMode={!!processor.testMode}
                  footnote={`Your card is charged securely through ${processor.displayName || 'Clover'}. Card numbers never touch the park website — only a one-time Clover token is used.`}
                />
              ) : (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                  {processor?.message ||
                    'Online card pay is not available right now. Use another method or call the park.'}
                </p>
              )}
            </div>
          )}

          {paymentMethod === 'Venmo' && (
            <p className="text-xs text-[#5A6355] bg-[#FBF9F7] rounded-xl p-3 border border-[#E2D9D0]">
              Pay via Venmo as directed by the park. Your site will be reserved upon confirmation.
            </p>
          )}
          {paymentMethod === 'Zelle' && (
            <p className="text-xs text-[#5A6355] bg-[#FBF9F7] rounded-xl p-3 border border-[#E2D9D0]">
              Pay via Zelle as directed by the park. Your site will be reserved upon confirmation.
            </p>
          )}
          {(paymentMethod === 'Cash' || paymentMethod === 'Check') && (
            <p className="text-xs text-[#5A6355] bg-[#FBF9F7] rounded-xl p-3 border border-[#E2D9D0]">
              Select this method if you will pay by {paymentMethod.toLowerCase()} at the park. Your site will be reserved pending payment confirmation.
            </p>
          )}

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handlePay}
            disabled={isSubmitting || (paymentMethod === 'Card' && !processor?.ready)}
            className="w-full flex items-center justify-center gap-2 bg-[#C29474] text-white rounded-2xl px-6 py-4 text-sm font-semibold hover:bg-[#b08364] transition disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing…
              </>
            ) : paymentMethod === 'Card' ? (
              <>
                <Lock className="w-4 h-4" />
                Pay {formatCurrency(total)} securely
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Complete reservation · {formatCurrency(total)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
