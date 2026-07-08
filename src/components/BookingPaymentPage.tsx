import { useState } from 'react';
import { ArrowLeft, CheckCircle2, CreditCard, Loader2 } from 'lucide-react';
import { BookingContactInfo, RentalType } from '../../types';
import { calculateStayNights, calculateStayTotal, parseDateKey } from '../../rentUtils';

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
  onBack: () => void;
  onComplete: () => void;
}

export function BookingPaymentPage({
  slotId,
  siteLabel,
  rentalLabel,
  rentalType,
  checkIn,
  checkOut,
  contact,
  onBack,
  onComplete,
}: BookingPaymentPageProps) {
  const [paymentMethod, setPaymentMethod] = useState<string>('Card');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkInDate = parseDateKey(checkIn);
  const checkOutDate = parseDateKey(checkOut);
  const nights = calculateStayNights(checkInDate, checkOutDate);
  const total = calculateStayTotal(rentalType, checkInDate, checkOutDate);

  const handlePay = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId,
          rentalType,
          checkIn,
          checkOut,
          paymentMethod,
          ...contact,
        }),
      });
      if (res.ok) {
        onComplete();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Payment could not be completed. Please try again.');
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F3F0] font-sans text-[#3D3730]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[#5A6355] hover:text-[#3D3730] transition text-sm font-medium mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to contact info
        </button>

        <div className="mb-8">
          <p className="text-xs uppercase tracking-widest text-[#5A6355] mb-2">Step 2 of 2</p>
          <h1 className="text-3xl font-serif text-[#3D3730] mb-2">Payment</h1>
          <p className="text-sm text-[#5A6355]">Review your booking and complete payment to reserve your site.</p>
        </div>

        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 mb-6 shadow-sm space-y-4">
          <h2 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Booking Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A6355] mb-1">Guest</p>
              <p className="font-medium">{contact.contactName}</p>
              <p className="text-[#5A6355] text-xs mt-0.5">{contact.contactEmail}</p>
              <p className="text-[#5A6355] text-xs">{contact.contactPhone}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A6355] mb-1">Site & Stay</p>
              <p className="font-medium">{siteLabel} · {rentalLabel}</p>
              <p className="text-[#5A6355] text-xs mt-0.5">
                {checkInDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} – {checkOutDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
              <p className="text-[#5A6355] text-xs">{nights} night{nights === 1 ? '' : 's'}</p>
            </div>
          </div>
          <div className="pt-4 border-t border-[#E2D9D0] flex justify-between items-center">
            <span className="text-sm font-medium">Total due today</span>
            <span className="text-2xl font-serif text-[#C29474]">{formatCurrency(total)}</span>
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
                onClick={() => setPaymentMethod(method)}
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
            <p className="text-xs text-[#5A6355] bg-[#FBF9F7] rounded-xl p-3 border border-[#E2D9D0]">
              Card payments are processed on arrival. Your site will be reserved upon confirmation.
            </p>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handlePay}
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 bg-[#C29474] text-white px-6 py-4 rounded-xl text-lg font-semibold shadow-lg hover:-translate-y-0.5 transition disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Pay {formatCurrency(total)} & Reserve Site
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}