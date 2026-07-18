import { useState, type ElementType } from 'react';
import { ArrowLeft, User, Phone, Mail, Truck, CreditCard, FileText, ArrowRight } from 'lucide-react';
import { BookingContactInfo, RentalType } from '../../types';
import {
  DEFAULT_RENTAL_RATES,
  calculateStayNights, calculateStayTotal, parseDateKey,
  type RentalRatesConfig,
} from '../../rentUtils';

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function Field({
  label,
  icon: Icon,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
  multiline = false,
}: {
  label: string;
  icon: ElementType;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
  multiline?: boolean;
}) {
  const inputClass = 'w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm text-[#3D3730] focus:outline-none focus:ring-1 focus:ring-[#5A6355]';
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] font-medium">
        <Icon className="w-3.5 h-3.5" />
        {label}{required && ' *'}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={`${inputClass} resize-none`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className={inputClass}
        />
      )}
    </div>
  );
}

interface BookingContactPageProps {
  slotId: string;
  siteLabel: string;
  rentalLabel: string;
  rentalType: RentalType;
  checkIn: string;
  checkOut: string;
  rates?: RentalRatesConfig;
  onBack: () => void;
  onContinue: (contact: BookingContactInfo) => void;
}

export function BookingContactPage({
  slotId,
  siteLabel,
  rentalLabel,
  rentalType,
  checkIn,
  checkOut,
  rates = DEFAULT_RENTAL_RATES,
  onBack,
  onContinue,
}: BookingContactPageProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<BookingContactInfo>({
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    contactRvType: '',
    contactLicensePlate: '',
    contactEmergency: '',
    contactNotes: '',
  });

  const checkInDate = parseDateKey(checkIn);
  const checkOutDate = parseDateKey(checkOut);
  const nights = calculateStayNights(checkInDate, checkOutDate);
  const total = calculateStayTotal(rentalType, checkInDate, checkOutDate, rates);

  const update = (key: keyof BookingContactInfo, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const canContinue = form.contactName.trim() && form.contactPhone.trim() && form.contactEmail.trim();

  const handleContinue = async () => {
    if (!canContinue) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/bookings/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId,
          rentalType,
          checkIn,
          checkOut,
          ...form,
        }),
      });
      if (res.ok) {
        onContinue(form);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not save your booking. Please try again.');
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setIsSaving(false);
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
          Back to booking
        </button>

        <div className="mb-8">
          <p className="text-xs uppercase tracking-widest text-[#5A6355] mb-2">Step 1 of 2</p>
          <h1 className="text-3xl font-serif text-[#3D3730] mb-2">Your Contact Information</h1>
          <p className="text-sm text-[#5A6355]">Tell us how to reach you about your reservation.</p>
        </div>

        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 mb-6 shadow-sm">
          <h2 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4">Reservation Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A6355] mb-1">Site</p>
              <p className="font-medium">{siteLabel}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A6355] mb-1">Stay</p>
              <p className="font-medium">{rentalLabel}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A6355] mb-1">Dates</p>
              <p className="font-medium">
                {checkInDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {checkOutDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A6355] mb-1">Estimated Total</p>
              <p className="font-medium text-[#C29474]">{formatCurrency(total)} · {nights} night{nights === 1 ? '' : 's'}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
          <Field label="Full Name" icon={User} value={form.contactName} onChange={v => update('contactName', v)} placeholder="Your full name" required />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Phone" icon={Phone} value={form.contactPhone} onChange={v => update('contactPhone', v)} placeholder="(555) 123-4567" type="tel" required />
            <Field label="Email" icon={Mail} value={form.contactEmail} onChange={v => update('contactEmail', v)} placeholder="you@email.com" type="email" required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="RV Type" icon={Truck} value={form.contactRvType} onChange={v => update('contactRvType', v)} placeholder="e.g. Travel trailer, 32 ft" />
            <Field label="License Plate" icon={CreditCard} value={form.contactLicensePlate} onChange={v => update('contactLicensePlate', v)} placeholder="License plate number" />
          </div>
          <Field label="Emergency Contact" icon={Phone} value={form.contactEmergency} onChange={v => update('contactEmergency', v)} placeholder="Name and phone number" />
          <Field label="Notes" icon={FileText} value={form.contactNotes} onChange={v => update('contactNotes', v)} placeholder="Arrival time, special requests, etc." multiline />

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleContinue}
            disabled={!canContinue || isSaving}
            className="w-full flex items-center justify-center gap-2 bg-[#C29474] text-white px-6 py-4 rounded-xl text-lg font-semibold shadow-lg hover:-translate-y-0.5 transition disabled:opacity-40 disabled:hover:translate-y-0"
          >
            {isSaving ? 'Saving…' : 'Continue to Payment'}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}