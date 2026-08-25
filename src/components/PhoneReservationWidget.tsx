import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, CreditCard, Lock, Phone, RefreshCw, Save, Shield, Users } from 'lucide-react';
import { PaymentCardRef, Slot, StoredCustomer, Tenant } from '../../types';
import {
  DEFAULT_RENTAL_RATES,
  calculateStayBreakdown,
  calculateStayNights,
  formatDailyRateDescription,
  parseDateKey,
  type RentalRatesConfig,
} from '../../rentUtils';
import { fetchActiveRates } from '../lib/activeRates';
import { apiFetch } from '../lib/api';

type ReturningGuest = {
  key: string;
  kind: 'tenant' | 'customer';
  label: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  rvType: string;
  licensePlate: string;
  emergency: string;
  notes: string;
  site?: string;
};

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}

const today = () => new Date().toISOString().slice(0, 10);

function digitsOnly(value: string) {
  return value.replace(/\D/g, '');
}

function formatCardNumber(value: string) {
  const d = digitsOnly(value).slice(0, 19);
  if (/^3[47]/.test(d)) {
    return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
  }
  return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function detectBrand(number: string): string {
  const d = digitsOnly(number);
  if (/^4/.test(d)) return 'Visa';
  if (/^3[47]/.test(d)) return 'Amex';
  if (/^5[1-5]/.test(d) || /^2(2[2-9]|[3-6]\d|7[01]|720)/.test(d)) return 'Mastercard';
  if (/^6(011|5)/.test(d)) return 'Discover';
  return 'Card';
}

function luhnValid(number: string): boolean {
  const d = digitsOnly(number);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = parseInt(d[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function expiryValid(month: string, year: string): boolean {
  const m = parseInt(month, 10);
  if (!m || m < 1 || m > 12) return false;
  let y = parseInt(year, 10);
  if (!y) return false;
  if (y < 100) y += 2000;
  const expEnd = new Date(y, m, 0, 23, 59, 59);
  return expEnd >= new Date();
}

export function PhoneReservationWidget() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [rates, setRates] = useState<RentalRatesConfig>({ ...DEFAULT_RENTAL_RATES });
  const [returningGuests, setReturningGuests] = useState<ReturningGuest[]>([]);
  const [vaultCards, setVaultCards] = useState<PaymentCardRef[]>([]);
  const [returningKey, setReturningKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [slotId, setSlotId] = useState('');
  const [rentalType, setRentalType] = useState<'daily' | 'weekly'>('daily');
  const [checkIn, setCheckIn] = useState(today());
  const [checkOut, setCheckOut] = useState(today());
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestAddress, setGuestAddress] = useState('');
  const [guestRvType, setGuestRvType] = useState('');
  const [guestLicensePlate, setGuestLicensePlate] = useState('');
  const [guestEmergency, setGuestEmergency] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paid, setPaid] = useState(true);
  const [notes, setNotes] = useState('');
  const [rentOverride, setRentOverride] = useState('');
  const [stateTaxOverride, setStateTaxOverride] = useState('');
  const [countyTaxOverride, setCountyTaxOverride] = useState('');
  const [selectedVaultCardId, setSelectedVaultCardId] = useState('');
  const [savedCardBrand, setSavedCardBrand] = useState('');
  const [savedCardLast4, setSavedCardLast4] = useState('');

  // Card on file (metadata only — full PAN/CVV never sent to server)
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [cvv, setCvv] = useState('');
  const [billingZip, setBillingZip] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [slotsRes, active, tenantsRes, customersRes, cardsRes] = await Promise.all([
        apiFetch('/api/slots'),
        fetchActiveRates({ force: true }),
        apiFetch('/api/tenants'),
        apiFetch('/api/customers'),
        apiFetch('/api/card-refs'),
      ]);
      if (slotsRes.ok) {
        const data = await slotsRes.json();
        const list: Slot[] = Array.isArray(data) ? data : data.slots || [];
        setSlots(list);
      }
      setRates(active);

      const guests: ReturningGuest[] = [];
      if (tenantsRes.ok) {
        const tenants: Tenant[] = await tenantsRes.json();
        for (const t of Array.isArray(tenants) ? tenants : []) {
          guests.push({
            key: `tenant:${t.id}`,
            kind: 'tenant',
            label: `Tenant · Site ${t.site} · ${t.name}`,
            name: t.name || '',
            phone: t.phone || '',
            email: t.email || '',
            address: t.address || '',
            rvType: t.rvType || '',
            licensePlate: t.licensePlate || '',
            emergency: t.emergencyContact || '',
            notes: t.notes || t.description || '',
            site: String(t.site),
          });
        }
      }
      if (customersRes.ok) {
        const customers: StoredCustomer[] = await customersRes.json();
        for (const c of Array.isArray(customers) ? customers : []) {
          // Skip if same name already listed as tenant
          const nameKey = c.name.trim().toLowerCase();
          if (guests.some(g => g.name.trim().toLowerCase() === nameKey)) continue;
          guests.push({
            key: `customer:${c.id}`,
            kind: 'customer',
            label: `Customer · ${c.name}${c.phone ? ` · ${c.phone}` : ''}`,
            name: c.name || '',
            phone: c.phone || '',
            email: c.email || '',
            address: '',
            rvType: c.rvType || '',
            licensePlate: c.licensePlate || '',
            emergency: c.emergencyContact || '',
            notes: c.notes || '',
          });
        }
      }
      guests.sort((a, b) => a.name.localeCompare(b.name));
      setReturningGuests(guests);

      if (cardsRes.ok) {
        const data = await cardsRes.json();
        setVaultCards(Array.isArray(data.cards) ? data.cards : []);
      }

      // default check-out +1 day for daily
      const d = new Date();
      d.setDate(d.getDate() + 1);
      setCheckOut(d.toISOString().slice(0, 10));
    } catch {
      setError('Could not load sites, returning guests, or rates.');
    } finally {
      setLoading(false);
    }
  };

  const applyReturningGuest = (key: string) => {
    setReturningKey(key);
    setError(null);
    if (!key) return;
    const g = returningGuests.find(x => x.key === key);
    if (!g) return;
    setGuestName(g.name);
    setGuestPhone(g.phone);
    setGuestEmail(g.email);
    setGuestAddress(g.address);
    setGuestRvType(g.rvType);
    setGuestLicensePlate(g.licensePlate);
    setGuestEmergency(g.emergency);
    setNotes(g.notes);
    setCardholderName(g.name);

    // Auto-pick matching card vault entry (type + last 4 only)
    const nameKey = g.name.trim().toLowerCase();
    const emailKey = g.email.trim().toLowerCase();
    const match =
      vaultCards.find(
        c =>
          (emailKey && (c.guestEmail || '').toLowerCase() === emailKey) ||
          (nameKey && c.guestName.trim().toLowerCase() === nameKey)
      ) || null;
    // Clear full card entry fields (keep vault brand/last4 if we match below)
    setCardNumber('');
    setExpMonth('');
    setExpYear('');
    setCvv('');
    setBillingZip('');

    if (match) {
      setSelectedVaultCardId(match.id);
      setSavedCardBrand(match.brand);
      setSavedCardLast4(match.last4);
      setPaymentMethod('Card');
      setCardholderName(g.name);
    } else {
      setSelectedVaultCardId('');
      setSavedCardBrand('');
      setSavedCardLast4('');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const availableSlots = useMemo(
    () =>
      slots
        .filter(s => s.status === 'available')
        .sort((a, b) => a.number - b.number),
    [slots]
  );

  const breakdown = useMemo(() => {
    try {
      if (!checkIn || !checkOut) return null;
      const ci = parseDateKey(checkIn);
      const co = parseDateKey(checkOut);
      if (co <= ci) return null;
      return calculateStayBreakdown(rentalType, ci, co, rates);
    } catch {
      return null;
    }
  }, [checkIn, checkOut, rentalType, rates]);

  const nights = useMemo(() => {
    try {
      if (!checkIn || !checkOut) return 0;
      return calculateStayNights(parseDateKey(checkIn), parseDateKey(checkOut));
    } catch {
      return 0;
    }
  }, [checkIn, checkOut]);

  // Prefer overrides when admin typed amounts; else auto from rates
  const rent = rentOverride !== '' ? parseFloat(rentOverride) || 0 : breakdown?.subtotal ?? 0;
  const stateTax =
    stateTaxOverride !== '' ? parseFloat(stateTaxOverride) || 0 : breakdown?.stateTax ?? 0;
  const countyTax =
    countyTaxOverride !== '' ? parseFloat(countyTaxOverride) || 0 : breakdown?.countyTax ?? 0;
  const grandTotal = Math.round((rent + stateTax + countyTax) * 100) / 100;

  // When type/dates change, clear overrides so auto rates apply
  useEffect(() => {
    setRentOverride('');
    setStateTaxOverride('');
    setCountyTaxOverride('');
  }, [rentalType, checkIn, checkOut]);

  const isCard = paymentMethod === 'Card';
  const brand = useMemo(() => detectBrand(cardNumber), [cardNumber]);
  const last4 = digitsOnly(cardNumber).slice(-4);
  const isAmex = brand === 'Amex';
  const cvvLen = isAmex ? 4 : 3;

  const usingSavedCard = savedCardLast4.length === 4 && !!savedCardBrand;

  const validateCard = (): string | null => {
    if (!cardholderName.trim() && !guestName.trim()) return 'Cardholder name is required.';
    // Returning guest: type + last 4 already on file — no full PAN required
    if (usingSavedCard) return null;
    const name = cardholderName.trim() || guestName.trim();
    if (!name) return 'Cardholder name is required.';
    const num = digitsOnly(cardNumber);
    if (num.length < 13) return 'Enter a complete card number.';
    if (!luhnValid(num)) return 'Card number looks invalid. Check and try again.';
    if (!expiryValid(expMonth, expYear)) return 'Enter a valid expiration date (MM / YY).';
    if (digitsOnly(cvv).length !== cvvLen) {
      return isAmex ? 'Enter the 4-digit CVV.' : 'Enter the 3-digit CVV.';
    }
    if (digitsOnly(billingZip).length < 5) return 'Enter a billing ZIP / postal code.';
    return null;
  };

  const clearCardFields = () => {
    setCardholderName('');
    setCardNumber('');
    setExpMonth('');
    setExpYear('');
    setCvv('');
    setBillingZip('');
    setSelectedVaultCardId('');
    setSavedCardBrand('');
    setSavedCardLast4('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!slotId) {
      setError('Select a site.');
      return;
    }
    if (!guestName.trim()) {
      setError('Guest name is required.');
      return;
    }
    if (!checkIn || !checkOut || nights <= 0) {
      setError('Check-out must be after check-in.');
      return;
    }
    if (isCard) {
      const cardErr = validateCard();
      if (cardErr) {
        setError(cardErr);
        return;
      }
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // Card digits are never sent to park storage — only method "Card" is recorded.
      // Full card data stays with the payment processor when that integration is live.
      const cardBrand = usingSavedCard
        ? savedCardBrand
        : isCard && last4.length === 4
          ? brand
          : undefined;
      const cardLast4 = usingSavedCard
        ? savedCardLast4
        : isCard && last4.length === 4
          ? last4
          : undefined;

      const res = await apiFetch('/api/bookings/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId,
          rentalType,
          checkIn,
          checkOut,
          contactName: guestName.trim(),
          contactPhone: guestPhone.trim(),
          contactEmail: guestEmail.trim(),
          contactAddress: guestAddress.trim(),
          contactRvType: guestRvType.trim(),
          contactLicensePlate: guestLicensePlate.trim(),
          contactEmergency: guestEmergency.trim(),
          contactNotes: notes.trim(),
          paymentMethod: isCard ? 'Card' : paymentMethod,
          paid,
          rentSubtotal: rent,
          stateTax,
          countyTax,
          grandTotal,
          cardBrand,
          cardLast4,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not save reservation (${res.status})`);
        return;
      }

      setSuccess(
        paid
          ? `Saved phone reservation for ${guestName} on ${data.siteLabel || 'site'} · total ${money(data.total ?? grandTotal)}${isCard ? ' · paid by Card' : ''}. Card numbers are not stored on this admin site. Site off public website for ${checkIn}–${checkOut}.`
          : `Reservation held for ${guestName} (payment pending). Site off public website for ${checkIn}–${checkOut}.`
      );
      setGuestName('');
      setGuestPhone('');
      setGuestEmail('');
      setGuestAddress('');
      setGuestRvType('');
      setGuestLicensePlate('');
      setGuestEmergency('');
      setNotes('');
      setSlotId('');
      setReturningKey('');
      clearCardFields();
      await load();
    } catch {
      setError('Network error — could not save phone reservation.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]';

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center shrink-0">
            <Phone className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">Phone / walk-in reservation</h3>
            <p className="text-xs text-[#5A6355] mt-1 max-w-2xl">
              Record a daily or weekly booking taken by phone. Pick a returning tenant or customer to
              auto-fill all contact info. Marks the site reserved and saves a guest receipt.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-xs font-semibold text-[#5A6355] border border-[#E2D9D0] px-3 py-2 rounded-xl hover:bg-[#FBF9F7]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
      )}
      {success && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{success}</span>
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-2xl border border-[#C29474]/40 bg-[#FBF9F7] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#5A6355]" />
            <p className="text-sm font-medium text-[#3D3730]">Returning tenant or customer</p>
          </div>
          <p className="text-[11px] text-[#5A6355]">
            Select a name to auto-fill phone, email, address, RV, emergency contact, notes, and any
            saved card reference (type + last 4 only).
          </p>
          <select
            value={returningKey}
            onChange={e => {
              const key = e.target.value;
              if (!key) {
                setReturningKey('');
                return;
              }
              applyReturningGuest(key);
            }}
            className={inputCls}
          >
            <option value="">New guest — type details below…</option>
            {returningGuests.map(g => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
          {returningKey && (
            <p className="text-[11px] text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2">
              Filled from {returningKey.startsWith('tenant:') ? 'tenant' : 'customer'} record. You can
              still edit any field before saving.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="Site *">
            <select
              value={slotId}
              onChange={e => setSlotId(e.target.value)}
              className={inputCls}
              required
            >
              <option value="">Select available site…</option>
              {availableSlots.map(s => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {availableSlots.length === 0 && (
              <p className="text-[10px] text-[#C29474] mt-1">No available sites right now.</p>
            )}
          </Field>

          <Field label="Stay type *">
            <select
              value={rentalType}
              onChange={e => setRentalType(e.target.value as 'daily' | 'weekly')}
              className={inputCls}
            >
              <option value="daily">Daily / overnight + tax</option>
              <option value="weekly">Weekly + tax</option>
            </select>
            <p className="text-[10px] text-[#5A6355] mt-1">
              {rentalType === 'daily'
                ? formatDailyRateDescription(rates)
                : `${money(rates.weekly)} / week`}
            </p>
          </Field>

          <Field label="Payment method">
            <select
              value={paymentMethod}
              onChange={e => {
                setPaymentMethod(e.target.value);
                setError(null);
                if (e.target.value !== 'Card') clearCardFields();
              }}
              className={inputCls}
            >
              {['Cash', 'Card', 'Check', 'Venmo', 'Zelle', 'Bank Transfer'].map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Guest name *">
            <input
              value={guestName}
              onChange={e => {
                setGuestName(e.target.value);
                setReturningKey('');
              }}
              className={inputCls}
              required
              placeholder="Full name"
            />
          </Field>
          <Field label="Phone">
            <input
              value={guestPhone}
              onChange={e => setGuestPhone(e.target.value)}
              className={inputCls}
              placeholder="(555) 123-4567"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={guestEmail}
              onChange={e => setGuestEmail(e.target.value)}
              className={inputCls}
              placeholder="optional"
            />
          </Field>
          <Field label="Address">
            <input
              value={guestAddress}
              onChange={e => setGuestAddress(e.target.value)}
              className={inputCls}
              placeholder="Street, city, state, ZIP"
            />
          </Field>
          <Field label="RV type">
            <input
              value={guestRvType}
              onChange={e => setGuestRvType(e.target.value)}
              className={inputCls}
              placeholder="e.g. Travel trailer"
            />
          </Field>
          <Field label="License plate">
            <input
              value={guestLicensePlate}
              onChange={e => setGuestLicensePlate(e.target.value)}
              className={inputCls}
              placeholder="optional"
            />
          </Field>
          <Field label="Emergency contact">
            <input
              value={guestEmergency}
              onChange={e => setGuestEmergency(e.target.value)}
              className={inputCls}
              placeholder="optional"
            />
          </Field>

          <Field label="Check-in *">
            <input
              type="date"
              value={checkIn}
              onChange={e => setCheckIn(e.target.value)}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Check-out *">
            <input
              type="date"
              value={checkOut}
              onChange={e => setCheckOut(e.target.value)}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Nights">
            <div className="px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm text-[#3D3730]">
              {nights > 0 ? nights : '—'}
            </div>
          </Field>

          <Field label="Rent ($)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={rentOverride !== '' ? rentOverride : rent ? String(rent) : ''}
              onChange={e => setRentOverride(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="State tax ($)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={stateTaxOverride !== '' ? stateTaxOverride : String(stateTax)}
              onChange={e => setStateTaxOverride(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="County tax ($)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={countyTaxOverride !== '' ? countyTaxOverride : String(countyTax)}
              onChange={e => setCountyTaxOverride(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="Notes">
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className={inputCls}
              placeholder="Optional notes"
            />
          </Field>
        </div>

        {isCard && (
          <div className="rounded-2xl border border-[#C29474]/40 bg-[#FBF9F7] p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-white border border-[#E2D9D0] flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-[#5A6355]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#3D3730]">Credit / debit card</p>
                  <p className="text-[11px] text-[#5A6355]">
                    {usingSavedCard
                      ? `Using saved card on file: ${savedCardBrand} •••• ${savedCardLast4}`
                      : `Enter card for this phone / walk-in · only type + last 4 kept on park records${
                          brand !== 'Card' ? ` · ${brand}` : ''
                        }`}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#5A6355] font-semibold">
                <Lock className="w-3 h-3" />
                Secure entry
              </span>
            </div>

            {usingSavedCard && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium text-[#3D3730] bg-white border border-[#E2D9D0] rounded-xl px-3 py-2">
                  {savedCardBrand} •••• {savedCardLast4}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedVaultCardId('');
                    setSavedCardBrand('');
                    setSavedCardLast4('');
                  }}
                  className="text-xs font-semibold text-[#5A6355] border border-[#E2D9D0] bg-white px-3 py-2 rounded-xl hover:bg-[#F0EBE6]"
                >
                  Enter a different card
                </button>
              </div>
            )}

            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${usingSavedCard ? 'opacity-50 pointer-events-none' : ''}`}>
              <Field label="Name on card *">
                <input
                  value={cardholderName}
                  onChange={e => setCardholderName(e.target.value)}
                  placeholder={guestName.trim() || 'Name as shown on card'}
                  autoComplete="cc-name"
                  className={inputCls}
                />
              </Field>
              <Field label="Billing ZIP *">
                <input
                  value={billingZip}
                  onChange={e => setBillingZip(e.target.value.slice(0, 12))}
                  placeholder="12345"
                  autoComplete="billing postal-code"
                  className={inputCls}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Card number *">
                  <div className="relative">
                    <input
                      value={cardNumber}
                      onChange={e => setCardNumber(formatCardNumber(e.target.value))}
                      placeholder="ACCT-000035"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      className={`${inputCls} font-mono tracking-wider pr-16`}
                    />
                    {digitsOnly(cardNumber).length >= 4 && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[#C29474] uppercase">
                        {brand}
                      </span>
                    )}
                  </div>
                </Field>
              </div>
              <Field label="Exp. month *">
                <input
                  value={expMonth}
                  onChange={e => setExpMonth(digitsOnly(e.target.value).slice(0, 2))}
                  placeholder="MM"
                  inputMode="numeric"
                  autoComplete="cc-exp-month"
                  maxLength={2}
                  className={inputCls}
                />
              </Field>
              <Field label="Exp. year *">
                <input
                  value={expYear}
                  onChange={e => setExpYear(digitsOnly(e.target.value).slice(0, 4))}
                  placeholder="YY"
                  inputMode="numeric"
                  autoComplete="cc-exp-year"
                  maxLength={4}
                  className={inputCls}
                />
              </Field>
              <Field label="CVV *">
                <input
                  value={cvv}
                  onChange={e => setCvv(digitsOnly(e.target.value).slice(0, cvvLen))}
                  placeholder={isAmex ? '1234' : '123'}
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  maxLength={cvvLen}
                  className={`${inputCls} font-mono tracking-widest`}
                />
              </Field>
            </div>

            <div className="flex items-start gap-2 text-[11px] text-[#5A6355] bg-white border border-[#E2D9D0] rounded-xl px-3 py-2.5">
              <Shield className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <p>
                Use this form to verify the card at the counter. Nothing from these fields is saved
                on the park admin site — only payment method “Card”. Vaulting and charges live with
                your payment processor (Reports → Payment processor).
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-[#3D3730] cursor-pointer">
            <input
              type="checkbox"
              checked={paid}
              onChange={e => setPaid(e.target.checked)}
              className="rounded border-[#E2D9D0]"
            />
            Payment received (create paid receipt)
          </label>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">Total</p>
            <p className="text-2xl font-serif font-semibold text-[#C29474]">{money(grandTotal)}</p>
            <p className="text-[10px] text-[#5A6355]">
              Rent {money(rent)} + tax {money(stateTax + countyTax)}
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving || availableSlots.length === 0}
          className="flex items-center gap-2 bg-[#5A6355] text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : paid ? 'Save reservation, payment & receipt' : 'Save reservation (unpaid)'}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">{label}</label>
      {children}
    </div>
  );
}
