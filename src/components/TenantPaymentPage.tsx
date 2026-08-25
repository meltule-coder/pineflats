import { apiFetch } from '../lib/api';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, DollarSign, Calendar, CreditCard, Plus, CheckCircle2, Receipt, Gauge,
  Pencil, Save, X, Trash2, Loader2, Zap, Lock
} from 'lucide-react';
import {
  Tenant, TenantPayment, MeterRecord, ExtraCharge, PaymentCredit, SavedPaymentCard, PaymentCardRef,
} from '../../types';
import {
  DEFAULT_RENTAL_RATES,
  dailyRateLabel, formatDailyRateDescription, rentAmountForType, prorateMonthlyRent,
  type RentalRatesConfig,
} from '../../rentUtils';
import { fetchActiveRates, subscribeActiveRates } from '../lib/activeRates';
import { ReceiptLink } from './ReceiptLink';
import { EarlyDeparturePanel } from './EarlyDeparturePanel';
import { CloverCardIframe, type CloverCardIframeHandle } from './CloverCardIframe';
import type { CloverPublicConfig } from '../lib/clover';

interface TenantPaymentPageProps {
  tenant: Tenant;
  onBack: () => void;
  onViewReceipt?: (paymentId?: string) => void;
}

const PAYMENT_METHODS = ['Cash', 'Check', 'Card', 'Venmo', 'Zelle', 'Bank Transfer'];
const KWH_RATE = 0.24;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function TenantPaymentPage({ tenant, onBack, onViewReceipt }: TenantPaymentPageProps) {
  const [payment, setPayment] = useState<TenantPayment | null>(null);
  const [rentAmount, setRentAmount] = useState('0');
  const [rentChargeStart, setRentChargeStart] = useState('');
  const [rentChargeEnd, setRentChargeEnd] = useState('');
  const [currentReadingTotal, setCurrentReadingTotal] = useState('0');
  const [baselineCredit, setBaselineCredit] = useState('0');
  const [previousMeterReading, setPreviousMeterReading] = useState('0');
  const [newAmount, setNewAmount] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newMethod, setNewMethod] = useState('Cash');
  const [newNote, setNewNote] = useState('');
  const [meterReading, setMeterReading] = useState('');
  const [meterDate, setMeterDate] = useState(new Date().toISOString().split('T')[0]);
  const [meterNote, setMeterNote] = useState('');
  const [customPrevious, setCustomPrevious] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingMeterId, setEditingMeterId] = useState<string | null>(null);
  const [editMeterForm, setEditMeterForm] = useState({
    reading: '',
    date: '',
    note: '',
    previousReading: '',
  });
  const [meterError, setMeterError] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDate, setChargeDate] = useState(new Date().toISOString().split('T')[0]);
  const [chargeDescription, setChargeDescription] = useState('');
  const [chargeNote, setChargeNote] = useState('');
  const [chargeError, setChargeError] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditDate, setCreditDate] = useState(new Date().toISOString().split('T')[0]);
  const [creditDescription, setCreditDescription] = useState('');
  const [creditNote, setCreditNote] = useState('');
  const [creditError, setCreditError] = useState('');
  const [editingCreditId, setEditingCreditId] = useState<string | null>(null);
  const [editCreditForm, setEditCreditForm] = useState({
    amount: '',
    date: '',
    description: '',
    note: '',
  });
  const [cardError, setCardError] = useState('');
  const [cardSuccess, setCardSuccess] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [cardNote, setCardNote] = useState('');
  const [cardDate, setCardDate] = useState(new Date().toISOString().split('T')[0]);
  /** processor = try payment processor; terminal = confirm after card run elsewhere */
  const [cardMode, setCardMode] = useState<'processor' | 'terminal'>('terminal');
  const [cardInitiating, setCardInitiating] = useState(false);
  const [processorReady, setProcessorReady] = useState(false);
  const [processorLabel, setProcessorLabel] = useState('Not connected');
  /** Public Clover PAKMS config for hosted iframe charges */
  const [cloverCheckout, setCloverCheckout] = useState<CloverPublicConfig | null>(null);
  const cloverRef = useRef<CloverCardIframeHandle>(null);
  /** Shared vault cards (brand + last4) for this guest — renewals (reference only, not chargeable tokens) */
  const [vaultCards, setVaultCards] = useState<PaymentCardRef[]>([]);
  const [selectedVaultCardId, setSelectedVaultCardId] = useState<string>('');
  // Card entry for terminal mode (last4 reference) — never sent as full PAN to charge API
  const [ccName, setCcName] = useState('');
  const [ccNumber, setCcNumber] = useState('');
  const [ccExpMonth, setCcExpMonth] = useState('');
  const [ccExpYear, setCcExpYear] = useState('');
  const [ccCvv, setCcCvv] = useState('');
  const [ccZip, setCcZip] = useState('');
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  const [editChargeForm, setEditChargeForm] = useState({
    amount: '',
    date: '',
    description: '',
    note: '',
  });
  const [rates, setRates] = useState<RentalRatesConfig>(DEFAULT_RENTAL_RATES);

  const loadPayment = async (activeRates: RentalRatesConfig = rates) => {
    const res = await apiFetch(`/api/tenants/${tenant.id}/payments`);
    if (res.ok) {
      const data: TenantPayment = await res.json();
      setPayment(data);
      const rentalType = data.rentalType ?? tenant.rentalType;
      if (rentalType === 'daily') {
        const resolvedRent = rentAmountForType('daily', new Date(), activeRates);
        setRentAmount(String(resolvedRent));
        if (resolvedRent !== data.rentAmount) {
          await apiFetch(`/api/tenants/${tenant.id}/payments`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rentAmount: resolvedRent }),
          });
        }
      } else if (rentalType === 'monthly') {
        // Editor shows full monthly rate; period rent is computed separately
        setRentAmount(String(data.baseMonthlyRate ?? activeRates.monthly));
        // Only load user-saved charge dates (not auto-computed window dates)
        setRentChargeStart(data.rentChargeStart || '');
        setRentChargeEnd(data.rentChargeEnd || '');
      } else {
        setRentAmount(String(data.rentAmount ?? 0));
        setRentChargeStart('');
        setRentChargeEnd('');
      }
      setCurrentReadingTotal(String(data.currentReadingTotal));
      setBaselineCredit(String(data.baselineCredit ?? 0));
      const autoPrevious = data.meterRecords?.[0]?.reading ?? data.previousMeterReading ?? 0;
      setPreviousMeterReading(String(autoPrevious));
    }
    // Load shared vault cards matching this guest (renewals)
    try {
      const params = new URLSearchParams({ tenantId: tenant.id });
      if (tenant.email) params.set('email', tenant.email);
      if (tenant.name) params.set('name', tenant.name);
      const vaultRes = await apiFetch(`/api/card-refs?${params.toString()}`);
      if (vaultRes.ok) {
        const vaultData = await vaultRes.json();
        setVaultCards(Array.isArray(vaultData.cards) ? vaultData.cards : []);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const activeRates = await fetchActiveRates({ force: true });
      if (cancelled) return;
      setRates(activeRates);
      await loadPayment(activeRates);
    };
    load();
    const unsub = subscribeActiveRates(() => {
      void load();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [tenant.id]);

  useEffect(() => {
    if (!meterReading) return;
    const reading = parseFloat(meterReading);
    const previous = parseFloat(previousMeterReading) || 0;
    if (Number.isNaN(reading)) {
      setCurrentReadingTotal('0');
      return;
    }
    setCurrentReadingTotal(String(Math.max(0, reading - previous)));
  }, [meterReading, previousMeterReading]);

  const netReadingTotal = Math.max(
    0,
    (parseFloat(currentReadingTotal) || 0) - (parseFloat(baselineCredit) || 0)
  );
  const netElectricCharge = netReadingTotal * KWH_RATE;
  const baseMonthlyRate = parseFloat(rentAmount) || rates.monthly;
  const rentalType = payment?.rentalType ?? tenant.rentalType;
  const billingPeriod = payment?.billingPeriod ?? '';

  // Live proration whenever dates or period can be computed
  const liveProration = rentalType === 'monthly'
    ? prorateMonthlyRent({
        monthlyRate: baseMonthlyRate,
        startDate: rentChargeStart || tenant.startDate || undefined,
        endDate: rentChargeEnd
          || (tenant.endDate && tenant.endDate !== 'ongoing' ? tenant.endDate : undefined),
        billingPeriod: billingPeriod && /^\d{4}-\d{2}$/.test(billingPeriod)
          ? billingPeriod
          : undefined,
        mode: rentChargeStart && rentChargeEnd ? 'range' : 'window',
      })
    : null;
  const rentProration = liveProration
    ? {
        fullRate: liveProration.fullRate,
        dailyRate: liveProration.dailyRate,
        daysCharged: liveProration.daysCharged,
        billableDays: liveProration.billableDays,
        extraDaysFor31DayMonth: liveProration.extraDaysFor31DayMonth,
        daysInPeriod: liveProration.daysInPeriod,
        prorated: liveProration.prorated,
        chargeStart: liveProration.chargeStart,
        chargeEnd: liveProration.chargeEnd,
      }
    : payment?.rentProration;
  // Period rent from live proration (always reflects 30-day window math)
  const rent = liveProration?.amount ?? payment?.rentAmount ?? 0;
  const carriedBalance = payment?.carriedBalance ?? 0;
  // Extra charges are always included in period charges and balance due
  const periodKey = billingPeriod && /^\d{4}-\d{2}$/.test(billingPeriod) ? billingPeriod : '';
  const extraChargesTotal =
    payment?.extraCharges?.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) ?? 0;
  const creditsTotal =
    payment?.credits?.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) ?? 0;
  // Period charges = rent + utilities + extra charges only (no carried balance)
  const periodCharges = rent + netElectricCharge + extraChargesTotal;
  const totalPaidAll = payment?.records.reduce((sum, r) => sum + r.amount, 0) ?? 0;
  // Only payments dated in this billing period reduce balance due
  const periodPaid = periodKey
    ? (payment?.records
        ?.filter((r) => (r.date || '').startsWith(periodKey))
        .reduce((sum, r) => sum + r.amount, 0) ?? 0)
    : Math.max(0, totalPaidAll - (payment?.paymentBaseline ?? 0));
  // Balance due = carried + period charges − credits − payments this period
  const balanceDue = Math.max(0, carriedBalance + periodCharges - creditsTotal - periodPaid);
  const chargesTotal = periodCharges;
  const totalPaid = periodPaid;

  // Prefill card charge amount with balance due when tenant payment data loads
  useEffect(() => {
    if (balanceDue > 0) {
      setCardAmount(prev => (prev === '' || prev === '0' ? balanceDue.toFixed(2) : prev));
    }
  }, [tenant.id, balanceDue]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch('/api/payment-processor/status').then(res => (res.ok ? res.json() : null)),
      // Public checkout info includes PAKMS key for Clover iframe (safe for browser)
      apiFetch('/api/public/payment-processor').then(res => (res.ok ? res.json() : null)),
    ])
      .then(([status, checkout]) => {
        if (cancelled) return;
        if (status) {
          setProcessorReady(Boolean(status.ready || status.connected));
          const provider = status.provider || 'none';
          const labels: Record<string, string> = {
            none: 'Not connected',
            clover: 'Clover',
            stripe: 'Stripe',
            square: 'Square',
            other: 'Custom processor',
          };
          setProcessorLabel(
            status.ready
              ? `${labels[provider] || provider} · ready`
              : status.connected
                ? `${labels[provider] || provider} · setup pending`
                : 'Not connected'
          );
          if (status.ready) setCardMode('processor');
        }
        if (checkout) {
          setCloverCheckout(checkout as CloverPublicConfig);
          if (checkout.ready) {
            setProcessorReady(true);
            setProcessorLabel(
              checkout.testMode
                ? `${checkout.displayName || 'Clover'} · sandbox ready`
                : `${checkout.displayName || 'Clover'} · ready`
            );
            setCardMode('processor');
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isFirstPayment = !(payment?.records?.length);
  const needsCardEntry = isFirstPayment || !(payment?.savedCards?.length);

  const digitsOnly = (v: string) => v.replace(/\D/g, '');
  const formatCardNumber = (value: string) => {
    const d = digitsOnly(value).slice(0, 19);
    if (/^3[47]/.test(d)) {
      return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
    }
    return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  };
  const detectBrand = (number: string): string => {
    const d = digitsOnly(number);
    if (/^4/.test(d)) return 'Visa';
    if (/^3[47]/.test(d)) return 'Amex';
    if (/^5[1-5]/.test(d) || /^2(2[2-9]|[3-6]\d|7[01]|720)/.test(d)) return 'Mastercard';
    if (/^6(011|5)/.test(d)) return 'Discover';
    return 'Card';
  };
  const luhnValid = (number: string): boolean => {
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
  };

  const clearCardEntry = () => {
    setCcName('');
    setCcNumber('');
    setCcExpMonth('');
    setCcExpYear('');
    setCcCvv('');
    setCcZip('');
  };

  const handleInitiateCardPayment = async () => {
    setCardError('');
    setCardSuccess('');
    const amount = parseFloat(cardAmount);
    if (!amount || amount <= 0) {
      setCardError('Enter a valid card payment amount.');
      return;
    }

    const vaultCard = vaultCards.find(c => c.id === selectedVaultCardId);
    // Vault only stores brand + last4 (PCI reference). It cannot charge Clover by itself.
    const usingVault = !!vaultCard && vaultCard.last4.length === 4;

    let brand = vaultCard ? vaultCard.brand : detectBrand(ccNumber);
    let last4 = vaultCard ? vaultCard.last4 : digitsOnly(ccNumber).slice(-4);
    let paymentMethodToken: string | undefined;

    if (cardMode === 'processor') {
      if (!cloverCheckout?.ready || !cloverCheckout.publicKey) {
        setCardError(
          'Clover online charging is not ready. Add the PAKMS public key under Reports → Payment processor, or use “Confirm card payment” after running the card on a Clover terminal.'
        );
        return;
      }
      // Must tokenize via Clover Hosted iframe → clv_ token (vault last4 is only a label)
      try {
        const tok = await cloverRef.current!.createToken();
        paymentMethodToken = tok.token;
        if (tok.last4) last4 = tok.last4;
        if (tok.brand) brand = tok.brand;
      } catch (e) {
        setCardError(
          e instanceof Error
            ? e.message
            : 'Enter the card in the secure Clover form to charge.'
        );
        return;
      }
    } else {
      // Terminal mode: brand+last4 reference only; optional entry for first-payment display
      const isAmex = brand === 'Amex';
      const cvvLen = isAmex ? 4 : 3;
      if (!usingVault && (needsCardEntry || digitsOnly(ccNumber).length > 0)) {
        if (!(ccName.trim() || tenant.name)) {
          setCardError('Name on card is required for this payment.');
          return;
        }
        if (digitsOnly(ccNumber).length < 13 || !luhnValid(ccNumber)) {
          setCardError('Enter a valid card number (for type + last 4 only), or pick a vault card.');
          return;
        }
        const m = parseInt(ccExpMonth, 10);
        let y = parseInt(ccExpYear, 10);
        if (!m || m < 1 || m > 12) {
          setCardError('Enter a valid expiration month (MM).');
          return;
        }
        if (!y) {
          setCardError('Enter a valid expiration year.');
          return;
        }
        if (y < 100) y += 2000;
        if (new Date(y, m, 0, 23, 59, 59) < new Date()) {
          setCardError('This card looks expired. Check the expiration date.');
          return;
        }
        if (digitsOnly(ccCvv).length !== cvvLen) {
          setCardError(isAmex ? 'Enter the 4-digit CVV.' : 'Enter the 3-digit CVV.');
          return;
        }
        if (digitsOnly(ccZip).length < 5) {
          setCardError('Enter a billing ZIP code.');
          return;
        }
      }
      if (needsCardEntry && !usingVault && digitsOnly(ccNumber).length < 13) {
        setCardError(
          'Enter a card or select a vault card (type + last 4) so the receipt can show which card was used.'
        );
        return;
      }
    }

    setCardInitiating(true);
    try {
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/initiate-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          date: cardDate,
          note:
            cardNote.trim() ||
            (usingVault
              ? `Renewal · ${brand} •••• ${last4}`
              : last4
                ? `${brand} •••• ${last4}`
                : undefined),
          mode: cardMode,
          cardBrand: last4.length === 4 ? brand : undefined,
          cardLast4: last4.length === 4 ? last4 : undefined,
          // Required for processor mode — never full PAN
          paymentMethodToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const procMsg =
          data.processor && typeof data.processor.message === 'string'
            ? data.processor.message
            : '';
        setCardError(
          [data.error, data.hint, procMsg && procMsg !== data.error ? procMsg : '']
            .filter(Boolean)
            .join(' ') || `Could not charge card (HTTP ${res.status}).`
        );
        return;
      }
      await loadPayment();
      clearCardEntry();
      const baseMsg =
        data.message ||
        (data.cardRef
          ? `Payment saved. Card on file: ${data.cardRef}`
          : cardMode === 'processor'
            ? 'Card charged via Clover and recorded.'
            : 'Card payment recorded for this tenant.');
      const emailNote = data.email?.customerSent
        ? ` Receipt emailed to ${tenant.email}.`
        : data.email?.parkSent
          ? ' Receipt emailed to the park (no tenant email on file).'
          : !tenant.email?.trim()
            ? ' Add tenant email to auto-email their receipt next time.'
            : data.email?.error
              ? ` Email: ${data.email.error}`
              : '';
      setCardSuccess(`${baseMsg}${emailNote}`);
      setCardNote('');
      if (balanceDue - amount > 0.005) {
        setCardAmount(Math.max(0, balanceDue - amount).toFixed(2));
      } else {
        setCardAmount('');
      }
      if (onViewReceipt && data.payment?.records?.[0]?.id) {
        onViewReceipt(data.payment.records[0].id);
      }
      setTimeout(() => setCardSuccess(''), 6000);
    } catch {
      setCardError('Network error — could not initiate card payment.');
    } finally {
      setCardInitiating(false);
    }
  };

  const handleSaveRates = async () => {
    setSaving(true);
    try {
      const body: Record<string, string | number | null> = {
        currentReadingTotal: parseFloat(currentReadingTotal) || 0,
        baselineCredit: parseFloat(baselineCredit) || 0,
        previousMeterReading: parseFloat(previousMeterReading) || 0,
      };
      if (rentalType === 'monthly') {
        body.baseMonthlyRate = parseFloat(rentAmount) || rates.monthly;
        body.rentChargeStart = rentChargeStart || null;
        body.rentChargeEnd = rentChargeEnd || null;
      } else {
        body.rentAmount = parseFloat(rentAmount) || 0;
      }
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await loadPayment();
      }
    } finally {
      setSaving(false);
    }
  };

  const saveMeterReading = async (replaceLatest: boolean) => {
    const reading = parseFloat(meterReading);
    if (Number.isNaN(reading) || reading < 0) {
      setMeterError('Enter a valid new meter reading (0 or greater).');
      return;
    }
    setSaving(true);
    setMeterError('');
    try {
      const body: Record<string, string | number | boolean> = {
        date: meterDate,
        reading,
        note: meterNote,
        replaceLatest,
      };
      if (customPrevious) {
        body.previousReading = parseFloat(previousMeterReading) || 0;
      }
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/meter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await loadPayment();
        setMeterReading('');
        setMeterNote('');
        setCustomPrevious(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setMeterError(data.error || 'Failed to save meter reading');
      }
    } catch {
      setMeterError('Network error — could not save meter reading.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddMeter = async () => {
    await saveMeterReading(false);
  };

  const handleSetCurrentMeter = async () => {
    await saveMeterReading(true);
  };

  const startEditMeter = (record: MeterRecord) => {
    setEditingMeterId(record.id);
    setEditMeterForm({
      reading: String(record.reading),
      date: record.date || new Date().toISOString().split('T')[0],
      note: record.note || '',
      previousReading: String(record.previousReading ?? 0),
    });
    setMeterError('');
  };

  const cancelEditMeter = () => {
    setEditingMeterId(null);
    setMeterError('');
  };

  const handleSaveMeter = async () => {
    if (!editingMeterId) return;
    const reading = parseFloat(editMeterForm.reading);
    if (Number.isNaN(reading) || reading < 0) {
      setMeterError('Enter a valid meter reading (0 or greater).');
      return;
    }
    setSaving(true);
    setMeterError('');
    try {
      const body: Record<string, unknown> = {
        reading,
        date: editMeterForm.date,
        note: editMeterForm.note.trim(),
      };
      // Only allow editing previous baseline on the oldest record
      const records = payment?.meterRecords ?? [];
      const isOldest = records.length > 0 && records[records.length - 1]?.id === editingMeterId;
      if (isOldest && editMeterForm.previousReading !== '') {
        body.previousReading = parseFloat(editMeterForm.previousReading) || 0;
      }
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/meter/${editingMeterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMeterError(data.error || 'Failed to update meter record');
        return;
      }
      await loadPayment();
      setEditingMeterId(null);
    } catch {
      setMeterError('Network error — could not save meter record.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMeter = async (recordId: string) => {
    if (!window.confirm('Delete this meter record? Usage and balance due will be recalculated.')) return;
    setSaving(true);
    setMeterError('');
    try {
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/meter/${recordId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMeterError(data.error || 'Failed to delete meter record');
        return;
      }
      if (editingMeterId === recordId) setEditingMeterId(null);
      await loadPayment();
    } catch {
      setMeterError('Network error — could not delete meter record.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCharge = async () => {
    const amount = parseFloat(chargeAmount);
    if (!amount || amount <= 0) {
      setChargeError('Enter a valid amount greater than zero.');
      return;
    }
    if (!chargeDescription.trim()) {
      setChargeError('Description is required (e.g. Pet fee, Late fee).');
      return;
    }
    setSaving(true);
    setChargeError('');
    try {
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/charges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          date: chargeDate,
          description: chargeDescription.trim(),
          note: chargeNote.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setChargeError(data.error || 'Failed to add charge');
        return;
      }
      await loadPayment();
      setChargeAmount('');
      setChargeDescription('');
      setChargeNote('');
    } catch {
      setChargeError('Network error — could not add charge.');
    } finally {
      setSaving(false);
    }
  };

  const startEditCharge = (charge: ExtraCharge) => {
    setEditingChargeId(charge.id);
    setEditChargeForm({
      amount: String(charge.amount),
      date: charge.date || new Date().toISOString().split('T')[0],
      description: charge.description || '',
      note: charge.note || '',
    });
    setChargeError('');
  };

  const cancelEditCharge = () => {
    setEditingChargeId(null);
    setChargeError('');
  };

  const handleSaveCharge = async () => {
    if (!editingChargeId) return;
    const amount = parseFloat(editChargeForm.amount);
    if (!amount || amount <= 0) {
      setChargeError('Enter a valid amount greater than zero.');
      return;
    }
    if (!editChargeForm.description.trim()) {
      setChargeError('Description is required.');
      return;
    }
    setSaving(true);
    setChargeError('');
    try {
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/charges/${editingChargeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          date: editChargeForm.date,
          description: editChargeForm.description.trim(),
          note: editChargeForm.note.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setChargeError(data.error || 'Failed to update charge');
        return;
      }
      await loadPayment();
      setEditingChargeId(null);
    } catch {
      setChargeError('Network error — could not save charge.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCharge = async (chargeId: string) => {
    if (!window.confirm('Remove this extra charge? Balance due will be updated.')) return;
    setSaving(true);
    setChargeError('');
    try {
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/charges/${chargeId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setChargeError(data.error || 'Failed to delete charge');
        return;
      }
      if (editingChargeId === chargeId) setEditingChargeId(null);
      await loadPayment();
    } catch {
      setChargeError('Network error — could not delete charge.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCredit = async () => {
    const amount = parseFloat(creditAmount);
    if (!amount || amount <= 0) {
      setCreditError('Enter a valid amount greater than zero.');
      return;
    }
    if (!creditDescription.trim()) {
      setCreditError('Description is required (e.g. Courtesy credit, Promo).');
      return;
    }
    setSaving(true);
    setCreditError('');
    try {
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          date: creditDate,
          description: creditDescription.trim(),
          note: creditNote.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCreditError(data.error || 'Failed to add credit');
        return;
      }
      await loadPayment();
      setCreditAmount('');
      setCreditDescription('');
      setCreditNote('');
    } catch {
      setCreditError('Network error — could not add credit.');
    } finally {
      setSaving(false);
    }
  };

  const startEditCredit = (credit: PaymentCredit) => {
    setEditingCreditId(credit.id);
    setEditCreditForm({
      amount: String(credit.amount),
      date: credit.date || new Date().toISOString().split('T')[0],
      description: credit.description || '',
      note: credit.note || '',
    });
    setCreditError('');
  };

  const cancelEditCredit = () => {
    setEditingCreditId(null);
    setCreditError('');
  };

  const handleSaveCredit = async () => {
    if (!editingCreditId) return;
    const amount = parseFloat(editCreditForm.amount);
    if (!amount || amount <= 0) {
      setCreditError('Enter a valid amount greater than zero.');
      return;
    }
    if (!editCreditForm.description.trim()) {
      setCreditError('Description is required.');
      return;
    }
    setSaving(true);
    setCreditError('');
    try {
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/credits/${editingCreditId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          date: editCreditForm.date,
          description: editCreditForm.description.trim(),
          note: editCreditForm.note.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCreditError(data.error || 'Failed to update credit');
        return;
      }
      await loadPayment();
      setEditingCreditId(null);
    } catch {
      setCreditError('Network error — could not save credit.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCredit = async (creditId: string) => {
    if (!window.confirm('Remove this credit? Balance due will be updated.')) return;
    setSaving(true);
    setCreditError('');
    try {
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/credits/${creditId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCreditError(data.error || 'Failed to delete credit');
        return;
      }
      if (editingCreditId === creditId) setEditingCreditId(null);
      await loadPayment();
    } catch {
      setCreditError('Network error — could not delete credit.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!window.confirm('Remove this card from the tenant’s file?')) return;
    setSaving(true);
    setCardError('');
    try {
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/cards/${cardId}`, {
        method: 'DELETE',
      });
      if (res.ok) await loadPayment();
      else {
        const data = await res.json().catch(() => ({}));
        setCardError(data.error || 'Could not delete card.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddPayment = async () => {
    const amount = parseFloat(newAmount);
    if (!amount || amount <= 0) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: newDate,
          amount,
          method: newMethod,
          note: newNote,
        }),
      });
      if (res.ok) {
        const updated = await res.json() as TenantPayment & {
          emailSent?: boolean;
          email?: { customerSent?: boolean; parkSent?: boolean; mode?: string; error?: string };
        };
        await loadPayment();
        setNewAmount('');
        setNewNote('');
        if (updated.email?.customerSent) {
          setCardSuccess(`Receipt emailed to ${tenant.email || 'customer'}.`);
        } else if (updated.email?.parkSent) {
          setCardSuccess('Payment saved. Receipt emailed to the park (tenant has no email on file).');
        } else if (!tenant.email?.trim()) {
          setCardSuccess('Payment saved. Add an email on the tenant to send them a receipt automatically.');
        } else if (updated.email?.error) {
          setCardSuccess(`Payment saved. Email issue: ${updated.email.error}`);
        } else {
          setCardSuccess('Payment saved. Receipt logged (configure SMTP on the server to send live email).');
        }
        setTimeout(() => setCardSuccess(''), 6000);
        // Open receipt for the payment just recorded
        if (onViewReceipt && updated.records?.[0]?.id) {
          onViewReceipt(updated.records[0].id);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const isCurrent = balanceDue <= 0;
  const latestMeter = payment?.meterRecords?.[0];
  const effectivePreviousReading = parseFloat(previousMeterReading) || latestMeter?.reading || payment?.previousMeterReading || 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-[#5A6355] hover:text-[#3D3730] transition text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Tenant Info
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif text-[#3D3730]">{tenant.name}</h2>
          <p className="text-sm text-[#5A6355] mt-1">Space {tenant.site} · Payments</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ReceiptLink
            spaceNumber={tenant.site}
            onViewReceipt={onViewReceipt ? () => onViewReceipt() : undefined}
          />
          <span className={`px-4 py-2 rounded-xl text-sm font-semibold ${
            isCurrent
              ? 'bg-[#E8F0E8] text-[#3D5A3D] border border-[#A8B2A6]'
              : 'bg-[#F5E6DC] text-[#6B4A32] border border-[#C29474]'
          }`}>
            {isCurrent ? 'Paid Up' : 'Balance Due'}
          </span>
        </div>
      </div>

      <EarlyDeparturePanel
        tenantId={tenant.id}
        tenantName={tenant.name}
        defaultPreviousReading={effectivePreviousReading}
        defaultDepartureDate={
          tenant.endDate && tenant.endDate !== 'ongoing'
            ? tenant.endDate
            : new Date().toISOString().split('T')[0]
        }
        onApplied={() => {
          loadPayment();
        }}
      />

      {rentalType === 'monthly' && (
        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-serif text-[#3D3730]">Monthly Rate &amp; Proration Dates</h3>
              <p className="text-xs text-[#5A6355] mt-1">
                Full month always = $750. 31-day months prorate as days × ($750 ÷ 31). 30-day months use $750 ÷ 30. Spans across two months always use 30-day math.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSaveRates}
              disabled={saving}
              className="flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Apply Dates'}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Monthly rate ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rentAmount}
                onChange={e => setRentAmount(e.target.value)}
                onBlur={handleSaveRates}
                placeholder="750.00"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Charge from</label>
              <input
                type="date"
                value={rentChargeStart}
                onChange={e => setRentChargeStart(e.target.value)}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Charge through</label>
              <input
                type="date"
                value={rentChargeEnd}
                onChange={e => setRentChargeEnd(e.target.value)}
                min={rentChargeStart || undefined}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
          </div>
          <div className="rounded-2xl bg-[#FBF9F7] border border-[#E2D9D0] px-4 py-3 text-sm text-[#5A6355]">
            {rentProration ? (
              <>
                <p>
                  Period rent:{' '}
                  <strong className="text-[#3D3730] text-lg font-serif">{formatCurrency(rent)}</strong>
                </p>
                <p className="text-xs mt-1">
                  {formatCurrency(baseMonthlyRate)} ÷ {rentProration.daysInPeriod} days ×{' '}
                  {rentProration.daysCharged} day
                  {rentProration.daysCharged === 1 ? '' : 's'} charged
                  {' = '}
                  <strong className="text-[#3D3730]">{formatCurrency(rent)}</strong>
                  {' '}({formatCurrency(rentProration.dailyRate)}/day)
                </p>
                <p className="text-xs mt-0.5">
                  {rentProration.chargeStart} → {rentProration.chargeEnd}
                  {rentProration.daysInPeriod === 31 && ' · 31-day month'}
                  {rentProration.daysInPeriod === 30 && ' · 30-day basis'}
                  {rentProration.daysInPeriod === 28 || rentProration.daysInPeriod === 29
                    ? ' · February'
                    : ''}
                  {rentProration.prorated ? ' · prorated' : ' · full month ($750)'}
                </p>
              </>
            ) : (
              <p className="text-xs">
                Select <strong>Charge from</strong> and <strong>Charge through</strong> for any dates.
                31-day months use $750 ÷ 31; 30-day months use $750 ÷ 30; two-month spans use 30-day math.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-[24px] border border-[#E2D9D0] p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] mb-2">
            <DollarSign className="w-3.5 h-3.5" />
            {rentalType === 'monthly' ? 'Period Rent' : 'Rent Due'}
          </div>
          {rentalType === 'monthly' ? (
            <>
              <p className="text-2xl font-serif text-[#3D3730]">{formatCurrency(rent)}</p>
              <p className="text-xs text-[#5A6355] mt-1">
                From dates above · full rate {formatCurrency(baseMonthlyRate)}
              </p>
            </>
          ) : (
            <input
              type="number"
              min="0"
              step="0.01"
              value={rentAmount}
              onChange={e => setRentAmount(e.target.value)}
              onBlur={handleSaveRates}
              placeholder="0.00"
              className="w-full text-2xl font-serif text-[#3D3730] bg-transparent focus:outline-none focus:ring-1 focus:ring-[#5A6355] rounded-lg px-1 -ml-1"
            />
          )}
          {rentalType === 'daily' && (
            <p className="text-xs text-[#5A6355] mt-2">
              Daily: {formatDailyRateDescription(rates)} · Today ({dailyRateLabel()}): {formatCurrency(rentAmountForType('daily', new Date(), rates))}
            </p>
          )}
        </div>
        <div className="bg-white rounded-[24px] border border-[#E2D9D0] p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] mb-2">
            <Receipt className="w-3.5 h-3.5" />
            Period Charges
          </div>
          <p className="text-2xl font-serif text-[#3D3730]">{formatCurrency(chargesTotal)}</p>
          <p className="text-xs text-[#5A6355] mt-1 leading-relaxed">
            {formatCurrency(rent)} rent
            {' + '}
            {formatCurrency(netElectricCharge)} util.
            {' + '}
            {formatCurrency(extraChargesTotal)} extras
          </p>
        </div>
        <div className="bg-white rounded-[24px] border border-[#E2D9D0] p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] mb-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Paid This Period
          </div>
          <p className="text-2xl font-serif text-[#3D3730]">{formatCurrency(totalPaid)}</p>
          <p className="text-xs text-[#5A6355] mt-1">Current billing period only</p>
        </div>
        <div className="bg-white rounded-[24px] border border-[#E2D9D0] p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] mb-2">
            <Receipt className="w-3.5 h-3.5" />
            Balance Due
          </div>
          <p className={`text-2xl font-serif ${isCurrent ? 'text-[#3D5A3D]' : 'text-[#C29474]'}`}>
            {formatCurrency(balanceDue)}
          </p>
          <p className="text-xs text-[#5A6355] mt-1">Period charges − payments</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
          <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Utilities</h3>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-[#5A6355]">Previous Meter Reading (kWh) — editable</label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={previousMeterReading}
              onChange={e => setPreviousMeterReading(e.target.value)}
              onBlur={handleSaveRates}
              placeholder="0"
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
            <p className="text-xs text-[#5A6355]">
              {latestMeter
                ? 'Usually matches the last saved meter reading. Edit and blur to save, or edit a saved record below.'
                : 'Baseline reading used for usage when no meter history exists. Saves when you leave the field.'}
            </p>
          </div>

          <div className="pt-4 border-t border-[#E2D9D0] space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="text-sm font-serif text-[#3D3730]">Set Meter Reading</h4>
              <span className="text-xs text-[#5A6355]">
                Using previous: {(customPrevious ? (parseFloat(previousMeterReading) || 0) : effectivePreviousReading).toLocaleString()} kWh
              </span>
            </div>
            <p className="text-xs text-[#5A6355]">
              Enter a new reading any time. Usage = new − previous. Use “Update latest” to correct the most recent reading without adding another history row.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">New Reading (kWh)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={meterReading}
                  onChange={e => setMeterReading(e.target.value)}
                  placeholder="e.g. 1450"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Date</label>
                <input
                  type="date"
                  value={meterDate}
                  onChange={e => setMeterDate(e.target.value)}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-xs text-[#5A6355] cursor-pointer">
              <input
                type="checkbox"
                checked={customPrevious}
                onChange={e => setCustomPrevious(e.target.checked)}
                className="mt-0.5 rounded border-[#E2D9D0]"
              />
              <span>
                Set a custom previous reading (meter replaced or new baseline). Uses the Previous Meter Reading field above.
              </span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Usage Total (kWh)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={currentReadingTotal}
                  onChange={e => setCurrentReadingTotal(e.target.value)}
                  onBlur={handleSaveRates}
                  placeholder="0"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Baseline Credit (kWh)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={baselineCredit}
                  onChange={e => setBaselineCredit(e.target.value)}
                  onBlur={handleSaveRates}
                  placeholder="0"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Net Amount (kWh)</label>
                <div className="w-full px-4 py-3 bg-[#EDE7E1] border border-[#E2D9D0] rounded-2xl text-sm font-medium text-[#3D3730]">
                  {netReadingTotal.toLocaleString()}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Utilities — Net Amount × $0.24/kWh</label>
              <div className="w-full px-4 py-3 bg-[#EDE7E1] border border-[#E2D9D0] rounded-2xl text-sm font-medium text-[#3D3730]">
                {formatCurrency(netElectricCharge)}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Balance Due — Charges − Payments</label>
              <div className="w-full px-4 py-3 bg-[#EDE7E1] border border-[#E2D9D0] rounded-2xl text-sm font-medium text-[#3D3730]">
                {formatCurrency(balanceDue)}
              </div>
              <p className="text-xs text-[#5A6355]">
                Period charges: {formatCurrency(rent)} rent
                {' + '}
                {formatCurrency(netElectricCharge)} utilities
                {' + '}
                {formatCurrency(extraChargesTotal)} extras
                {' = '}
                {formatCurrency(chargesTotal)}
                {carriedBalance > 0.009 && (
                  <> + {formatCurrency(carriedBalance)} carried</>
                )}
                {creditsTotal > 0.009 && (
                  <> − {formatCurrency(creditsTotal)} credits</>
                )}
                {totalPaid > 0 && (
                  <> − {formatCurrency(totalPaid)} paid</>
                )}
                {' = '}
                {formatCurrency(balanceDue)} due
              </p>
            </div>
            {meterReading && (
              <p className="text-xs text-[#5A6355]">
                {parseFloat(meterReading).toLocaleString()} kWh − {(parseFloat(previousMeterReading) || 0).toLocaleString()} kWh previous ={' '}
                <span className="font-medium text-[#3D3730]">{(parseFloat(currentReadingTotal) || 0).toLocaleString()} kWh</span>
              </p>
            )}
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Note (optional)</label>
              <input
                type="text"
                value={meterNote}
                onChange={e => setMeterNote(e.target.value)}
                placeholder="e.g. July electric"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleAddMeter}
                disabled={saving || !meterReading}
                className="flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50 flex-1"
              >
                <Gauge className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save New Reading'}
              </button>
              <button
                type="button"
                onClick={handleSetCurrentMeter}
                disabled={saving || !meterReading}
                className="flex items-center justify-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5C] transition disabled:opacity-50 flex-1"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving…' : latestMeter ? 'Update Latest Reading' : 'Set Current Reading'}
              </button>
              {latestMeter && (
                <button
                  type="button"
                  onClick={() => startEditMeter(latestMeter)}
                  className="flex items-center justify-center gap-2 bg-white border border-[#E2D9D0] text-[#5A6355] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] transition"
                >
                  <Pencil className="w-4 h-4" />
                  Edit in List
                </button>
              )}
            </div>
            {meterError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                {meterError}
              </p>
            )}

            <div className="pt-2 border-t border-[#E2D9D0] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-serif text-[#3D3730]">Saved Meter Readings</h4>
                <span className="text-xs text-[#5A6355]">Click Edit to change any reading</span>
              </div>
              {payment?.meterRecords?.length ? (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {payment.meterRecords.map((record, idx) => {
                    const isOldest = idx === payment.meterRecords!.length - 1;
                    const isEditing = editingMeterId === record.id;
                    return (
                      <div
                        key={record.id}
                        className={`rounded-2xl border px-4 py-3 ${
                          isEditing
                            ? 'bg-white border-[#5A6355] shadow-sm'
                            : 'bg-[#FBF9F7] border-[#E2D9D0]'
                        }`}
                      >
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-serif text-[#3D3730]">Edit Meter Reading</p>
                              <button
                                type="button"
                                onClick={cancelEditMeter}
                                className="p-1.5 rounded-lg hover:bg-[#FBF9F7]"
                                aria-label="Cancel edit"
                              >
                                <X className="w-4 h-4 text-[#5A6355]" />
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Reading (kWh)</label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  value={editMeterForm.reading}
                                  onChange={e => setEditMeterForm(p => ({ ...p, reading: e.target.value }))}
                                  className="w-full px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                                  autoFocus
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Date</label>
                                <input
                                  type="date"
                                  value={editMeterForm.date}
                                  onChange={e => setEditMeterForm(p => ({ ...p, date: e.target.value }))}
                                  className="w-full px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                                />
                              </div>
                              {isOldest && (
                                <div className="space-y-1">
                                  <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Previous / baseline (kWh)</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={editMeterForm.previousReading}
                                    onChange={e => setEditMeterForm(p => ({ ...p, previousReading: e.target.value }))}
                                    className="w-full px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                                  />
                                </div>
                              )}
                              <div className={`space-y-1 ${isOldest ? '' : 'sm:col-span-2'}`}>
                                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Note</label>
                                <input
                                  type="text"
                                  value={editMeterForm.note}
                                  onChange={e => setEditMeterForm(p => ({ ...p, note: e.target.value }))}
                                  placeholder="e.g. July electric"
                                  className="w-full px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                                />
                              </div>
                            </div>
                            <p className="text-xs text-[#5A6355]">
                              Usage:{' '}
                              <span className="font-medium text-[#3D3730]">
                                {Math.max(
                                  0,
                                  (parseFloat(editMeterForm.reading) || 0) -
                                    (isOldest
                                      ? (parseFloat(editMeterForm.previousReading) || 0)
                                      : record.previousReading)
                                ).toLocaleString()}{' '}
                                kWh
                              </span>
                              {!isOldest && ' (previous comes from earlier reading)'}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={handleSaveMeter}
                                disabled={saving}
                                className="flex items-center gap-1.5 bg-[#C29474] text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-[#A87A5E] disabled:opacity-50"
                              >
                                <Save className="w-3.5 h-3.5" />
                                {saving ? 'Saving…' : 'Save Reading'}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditMeter}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs border border-[#E2D9D0]"
                              >
                                <X className="w-3.5 h-3.5" />
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMeter(record.id)}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs border border-red-300 text-red-700 hover:bg-red-50 ml-auto"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => startEditMeter(record)}
                              className="min-w-0 text-left flex-1 hover:opacity-80"
                            >
                              <p className="text-sm font-medium text-[#3D3730]">
                                {record.reading.toLocaleString()} kWh
                                {idx === 0 && (
                                  <span className="ml-2 text-[10px] uppercase tracking-widest text-[#5A6355] font-normal">Latest</span>
                                )}
                              </p>
                              <p className="text-xs text-[#5A6355]">
                                {record.date} · {record.previousReading.toLocaleString()} → {record.reading.toLocaleString()} · {record.usage.toLocaleString()} kWh used
                              </p>
                              {record.note && (
                                <p className="text-xs text-[#5A6355] italic mt-0.5">{record.note}</p>
                              )}
                            </button>
                            <div className="flex gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => startEditMeter(record)}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#5A6355] text-white hover:bg-[#3D3730]"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMeter(record.id)}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-red-300 text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[#5A6355] text-center py-4 bg-[#FBF9F7] rounded-2xl border border-dashed border-[#E2D9D0]">
                  No saved meter readings yet. Enter a new reading above and click Add Meter Record.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2D9D0] pb-2">
              <h3 className="text-sm font-serif text-[#3D3730]">Extra Charges</h3>
              {extraChargesTotal > 0.009 && (
                <span className="text-xs font-semibold text-[#C29474]">
                  +{formatCurrency(extraChargesTotal)} on balance
                </span>
              )}
            </div>
            <p className="text-xs text-[#5A6355]">
              Add fees such as pet, late, propane, or dump — they increase period charges and balance due.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Description *</label>
                <input
                  type="text"
                  value={chargeDescription}
                  onChange={e => setChargeDescription(e.target.value)}
                  placeholder="e.g. Pet fee, Late fee, Propane"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Amount ($) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={chargeAmount}
                  onChange={e => setChargeAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Date</label>
                <input
                  type="date"
                  value={chargeDate}
                  onChange={e => setChargeDate(e.target.value)}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Note (optional)</label>
                <input
                  type="text"
                  value={chargeNote}
                  onChange={e => setChargeNote(e.target.value)}
                  placeholder="Optional details"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
            </div>
            {chargeError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                {chargeError}
              </p>
            )}
            <button
              type="button"
              onClick={handleAddCharge}
              disabled={saving || !chargeAmount || !chargeDescription.trim()}
              className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50 w-full justify-center"
            >
              <Plus className="w-4 h-4" />
              Add Extra Charge
            </button>
            {payment?.extraCharges?.length ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {payment.extraCharges.map((charge) => {
                  const isEditing = editingChargeId === charge.id;
                  return (
                    <div
                      key={charge.id}
                      className={`rounded-2xl border px-4 py-3 ${
                        isEditing ? 'bg-white border-[#5A6355]' : 'bg-[#FBF9F7] border-[#E2D9D0]'
                      }`}
                    >
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              value={editChargeForm.description}
                              onChange={e => setEditChargeForm(p => ({ ...p, description: e.target.value }))}
                              placeholder="Description"
                              className="px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm"
                            />
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={editChargeForm.amount}
                              onChange={e => setEditChargeForm(p => ({ ...p, amount: e.target.value }))}
                              placeholder="Amount"
                              className="px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm"
                            />
                            <input
                              type="date"
                              value={editChargeForm.date}
                              onChange={e => setEditChargeForm(p => ({ ...p, date: e.target.value }))}
                              className="px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm"
                            />
                            <input
                              value={editChargeForm.note}
                              onChange={e => setEditChargeForm(p => ({ ...p, note: e.target.value }))}
                              placeholder="Note"
                              className="px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleSaveCharge}
                              disabled={saving}
                              className="flex items-center gap-1.5 bg-[#C29474] text-white px-3 py-2 rounded-xl text-xs font-semibold"
                            >
                              <Save className="w-3.5 h-3.5" /> Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditCharge}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border border-[#E2D9D0]"
                            >
                              <X className="w-3.5 h-3.5" /> Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCharge(charge.id)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border border-red-300 text-red-700 ml-auto"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#3D3730]">
                              {charge.description} · {formatCurrency(charge.amount)}
                            </p>
                            <p className="text-xs text-[#5A6355]">
                              {charge.date}
                              {charge.note ? ` · ${charge.note}` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditCharge(charge)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#5A6355] text-white"
                            >
                              <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCharge(charge.id)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-red-300 text-red-700"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-[#5A6355] text-center py-3 bg-[#FBF9F7] rounded-2xl border border-dashed border-[#E2D9D0]">
                No extra charges yet.
              </p>
            )}
          </div>

          <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2D9D0] pb-2">
              <h3 className="text-sm font-serif text-[#3D3730]">Credits</h3>
              {creditsTotal > 0.009 && (
                <span className="text-xs font-semibold text-[#3D5A3D]">
                  −{formatCurrency(creditsTotal)} off balance
                </span>
              )}
            </div>
            <p className="text-xs text-[#5A6355]">
              Apply account credits (courtesy, promo, adjustment). Credits reduce balance due for this period.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Description *</label>
                <input
                  type="text"
                  value={creditDescription}
                  onChange={e => setCreditDescription(e.target.value)}
                  placeholder="e.g. Courtesy credit, Promo, Adjustment"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Amount ($) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={creditAmount}
                  onChange={e => setCreditAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Date</label>
                <input
                  type="date"
                  value={creditDate}
                  onChange={e => setCreditDate(e.target.value)}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Note (optional)</label>
                <input
                  type="text"
                  value={creditNote}
                  onChange={e => setCreditNote(e.target.value)}
                  placeholder="Optional details"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
            </div>
            {creditError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                {creditError}
              </p>
            )}
            <button
              type="button"
              onClick={handleAddCredit}
              disabled={saving || !creditAmount || !creditDescription.trim()}
              className="flex items-center gap-2 bg-[#3D5A3D] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#2d4430] transition disabled:opacity-50 w-full justify-center"
            >
              <Plus className="w-4 h-4" />
              Add Credit
            </button>
            {payment?.credits?.length ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {payment.credits.map((credit) => {
                  const isEditing = editingCreditId === credit.id;
                  return (
                    <div
                      key={credit.id}
                      className={`rounded-2xl border px-4 py-3 ${
                        isEditing ? 'bg-white border-[#3D5A3D]' : 'bg-[#E8F0E8]/50 border-[#A8B2A6]/50'
                      }`}
                    >
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              value={editCreditForm.description}
                              onChange={e => setEditCreditForm(p => ({ ...p, description: e.target.value }))}
                              placeholder="Description"
                              className="px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm"
                            />
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={editCreditForm.amount}
                              onChange={e => setEditCreditForm(p => ({ ...p, amount: e.target.value }))}
                              placeholder="Amount"
                              className="px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm"
                            />
                            <input
                              type="date"
                              value={editCreditForm.date}
                              onChange={e => setEditCreditForm(p => ({ ...p, date: e.target.value }))}
                              className="px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm"
                            />
                            <input
                              value={editCreditForm.note}
                              onChange={e => setEditCreditForm(p => ({ ...p, note: e.target.value }))}
                              placeholder="Note"
                              className="px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleSaveCredit}
                              disabled={saving}
                              className="flex items-center gap-1.5 bg-[#3D5A3D] text-white px-3 py-2 rounded-xl text-xs font-semibold"
                            >
                              <Save className="w-3.5 h-3.5" /> Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditCredit}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border border-[#E2D9D0]"
                            >
                              <X className="w-3.5 h-3.5" /> Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCredit(credit.id)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border border-red-300 text-red-700 ml-auto"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#3D5A3D]">
                              {credit.description} · −{formatCurrency(credit.amount)}
                            </p>
                            <p className="text-xs text-[#5A6355]">
                              {credit.date}
                              {credit.note ? ` · ${credit.note}` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditCredit(credit)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#3D5A3D] text-white"
                            >
                              <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCredit(credit.id)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-red-300 text-red-700"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-[#5A6355] text-center py-3 bg-[#FBF9F7] rounded-2xl border border-dashed border-[#E2D9D0]">
                No credits yet.
              </p>
            )}
          </div>

          <div className="bg-white rounded-[32px] border border-[#C29474]/40 p-6 shadow-sm space-y-4">
            <div className="border-b border-[#E2D9D0] pb-2 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-serif text-[#3D3730] flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#C29474]" />
                  {isFirstPayment ? 'First payment · credit card' : 'Initiate card payment'}
                </h3>
                <p className="text-xs text-[#5A6355] mt-1 max-w-lg">
                  {cardMode === 'processor'
                    ? 'Charge online through Clover’s secure form (card data never touches park servers). Vault cards are brand + last 4 only — use them as a label, then enter the card in Clover to charge.'
                    : isFirstPayment
                      ? 'After you run the card on a Clover terminal, record the payment here. Only type + last 4 are kept on park records.'
                      : 'Confirm a card payment after running it on a terminal. Vault entries are brand + last 4 only (not reusable charge tokens).'}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {isFirstPayment && (
                  <span className="text-[10px] uppercase tracking-widest font-semibold px-2.5 py-1 rounded-full border border-[#C29474] bg-[#FBF9F7] text-[#C29474]">
                    First payment
                  </span>
                )}
                <span className="text-[10px] uppercase tracking-widest font-semibold px-2.5 py-1 rounded-full border border-[#E2D9D0] bg-[#FBF9F7] text-[#5A6355]">
                  {processorLabel}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Amount ($)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={cardAmount}
                  onChange={e => setCardAmount(e.target.value)}
                  placeholder={balanceDue > 0 ? balanceDue.toFixed(2) : '0.00'}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
                {balanceDue > 0 && (
                  <button
                    type="button"
                    onClick={() => setCardAmount(balanceDue.toFixed(2))}
                    className="text-[11px] font-semibold text-[#C29474] hover:underline"
                  >
                    Use balance due ({formatCurrency(balanceDue)})
                  </button>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Date</label>
                <input
                  type="date"
                  value={cardDate}
                  onChange={e => setCardDate(e.target.value)}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Note (optional)</label>
              <input
                value={cardNote}
                onChange={e => setCardNote(e.target.value)}
                placeholder="e.g. March rent · first payment"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>

            {/* Saved cards — brand + last 4 only (not Clover charge tokens) */}
            {vaultCards.length > 0 && (
              <div className="rounded-2xl border border-[#C29474]/40 bg-[#FBF9F7] p-4 space-y-3">
                <p className="text-sm font-medium text-[#3D3730]">Cards on file (reference)</p>
                <p className="text-[11px] text-[#5A6355]">
                  These are <strong>type + last 4 only</strong> for staff notes. They cannot charge Clover by themselves.
                  {cardMode === 'processor'
                    ? ' Pick one to label the receipt, then enter the card in the secure Clover form below.'
                    : ' Pick one for the receipt after you run the card on your terminal.'}
                </p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="vault-card"
                      checked={!selectedVaultCardId}
                      onChange={() => setSelectedVaultCardId('')}
                    />
                    <span className="text-[#5A6355]">Enter a new card below</span>
                  </label>
                  {vaultCards.map(c => (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 text-sm cursor-pointer rounded-xl border px-3 py-2 ${
                        selectedVaultCardId === c.id
                          ? 'border-[#C29474] bg-white'
                          : 'border-[#E2D9D0] bg-white/60'
                      }`}
                    >
                      <input
                        type="radio"
                        name="vault-card"
                        checked={selectedVaultCardId === c.id}
                        onChange={() => setSelectedVaultCardId(c.id)}
                      />
                      <span className="font-mono font-medium text-[#3D3730]">
                        {c.brand} •••• {c.last4}
                      </span>
                      {c.guestName && c.guestName !== tenant.name && (
                        <span className="text-[11px] text-[#5A6355]">({c.guestName})</span>
                      )}
                    </label>
                  ))}
                </div>
                {selectedVaultCardId && (
                  <button
                    type="button"
                    onClick={async () => {
                      setCardError('');
                      setCardSuccess('');
                      const res = await apiFetch(
                        `/api/card-refs/${encodeURIComponent(selectedVaultCardId)}/apply`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ tenantId: tenant.id }),
                        }
                      );
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setCardError(data.error || 'Could not apply card.');
                        return;
                      }
                      setCardSuccess(data.message || 'Card applied for renewals on this tenant.');
                      await loadPayment();
                    }}
                    className="text-xs font-semibold text-[#5A6355] border border-[#E2D9D0] bg-white px-3 py-2 rounded-xl hover:bg-[#F0EBE6]"
                  >
                    Attach selected card to this tenant
                  </button>
                )}
              </div>
            )}

            {/* Processor mode: Clover Hosted iframe (required for live charge) */}
            {cardMode === 'processor' ? (
              <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#5A6355]" />
                  <p className="text-sm font-medium text-[#3D3730]">
                    Secure card entry (Clover) *
                  </p>
                </div>
                {selectedVaultCardId && (
                  <p className="text-xs text-[#6B4A32] bg-white border border-[#C29474]/30 rounded-xl px-3 py-2">
                    Vault shows which card you expect (••••{vaultCards.find(c => c.id === selectedVaultCardId)?.last4}).
                    Still enter that card in Clover below — the vault cannot charge by last 4 alone.
                  </p>
                )}
                {cloverCheckout?.ready && cloverCheckout.publicKey ? (
                  <CloverCardIframe
                    ref={cloverRef}
                    publicKey={cloverCheckout.publicKey}
                    merchantId={cloverCheckout.merchantId}
                    testMode={!!cloverCheckout.testMode}
                    footnote="Card numbers go only to Clover. Park records keep amount, Card, and optional type + last 4."
                  />
                ) : (
                  <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                    {cloverCheckout?.message ||
                      'Clover public/PAKMS key missing. Open Reports → Payment processor, run Test connection, then try again. Or use “Confirm card payment” after a terminal charge.'}
                  </p>
                )}
              </div>
            ) : (
              /* Terminal mode: optional type+last4 entry for records */
              <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-[#5A6355]" />
                  <p className="text-sm font-medium text-[#3D3730]">
                    Credit / debit card
                    {needsCardEntry && !selectedVaultCardId ? ' *' : selectedVaultCardId ? ' (using vault card)' : ' (optional)'}
                  </p>
                </div>
                {selectedVaultCardId ? (
                  <p className="text-xs text-[#5A6355]">
                    Using vault card for the receipt label. Run the physical card on your Clover terminal,
                    then confirm below. Park records show type + last 4 only.
                  </p>
                ) : null}
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${selectedVaultCardId ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Name on card *</label>
                    <input
                      value={ccName}
                      onChange={e => setCcName(e.target.value)}
                      placeholder={tenant.name || 'Name as shown on card'}
                      autoComplete="cc-name"
                      className="w-full px-4 py-3 bg-white border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Card number *</label>
                    <div className="relative">
                      <input
                        value={ccNumber}
                        onChange={e => setCcNumber(formatCardNumber(e.target.value))}
                        placeholder="ACCT-000035"
                        inputMode="numeric"
                        autoComplete="cc-number"
                        className="w-full px-4 py-3 bg-white border border-[#E2D9D0] rounded-2xl text-sm font-mono tracking-wider focus:outline-none focus:ring-1 focus:ring-[#5A6355] pr-16"
                      />
                      {digitsOnly(ccNumber).length >= 4 && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[#C29474] uppercase">
                          {detectBrand(ccNumber)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Exp. month *</label>
                    <input
                      value={ccExpMonth}
                      onChange={e => setCcExpMonth(digitsOnly(e.target.value).slice(0, 2))}
                      placeholder="MM"
                      inputMode="numeric"
                      maxLength={2}
                      autoComplete="cc-exp-month"
                      className="w-full px-4 py-3 bg-white border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Exp. year *</label>
                    <input
                      value={ccExpYear}
                      onChange={e => setCcExpYear(digitsOnly(e.target.value).slice(0, 4))}
                      placeholder="YY"
                      inputMode="numeric"
                      maxLength={4}
                      autoComplete="cc-exp-year"
                      className="w-full px-4 py-3 bg-white border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">CVV *</label>
                    <input
                      value={ccCvv}
                      onChange={e =>
                        setCcCvv(
                          digitsOnly(e.target.value).slice(0, detectBrand(ccNumber) === 'Amex' ? 4 : 3)
                        )
                      }
                      placeholder={detectBrand(ccNumber) === 'Amex' ? '1234' : '123'}
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      className="w-full px-4 py-3 bg-white border border-[#E2D9D0] rounded-2xl text-sm font-mono tracking-widest focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Billing ZIP *</label>
                    <input
                      value={ccZip}
                      onChange={e => setCcZip(e.target.value.slice(0, 12))}
                      placeholder="12345"
                      autoComplete="billing postal-code"
                      className="w-full px-4 py-3 bg-white border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-[#5A6355]">
                  After save you will see only type + last 4. Full number and CVV are not kept on this server.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCardMode('terminal')}
                className={`text-left px-4 py-3 rounded-2xl border-2 text-sm transition ${
                  cardMode === 'terminal'
                    ? 'border-[#C29474] bg-[#FBF9F7] text-[#3D3730]'
                    : 'border-[#E2D9D0] text-[#5A6355] hover:border-[#C29474]/50'
                }`}
              >
                <span className="font-semibold block">Confirm card payment</span>
                <span className="text-[11px] opacity-80">
                  Card run on terminal / processor — record payment here
                </span>
              </button>
              <button
                type="button"
                onClick={() => setCardMode('processor')}
                className={`text-left px-4 py-3 rounded-2xl border-2 text-sm transition ${
                  cardMode === 'processor'
                    ? 'border-[#C29474] bg-[#FBF9F7] text-[#3D3730]'
                    : 'border-[#E2D9D0] text-[#5A6355] hover:border-[#C29474]/50'
                }`}
              >
                <span className="font-semibold block">Charge via processor</span>
                <span className="text-[11px] opacity-80">
                  {processorReady
                    ? 'Send charge through connected processor'
                    : 'Requires Settings → Payment processor'}
                </span>
              </button>
            </div>

            {cardError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                {cardError}
              </p>
            )}
            {cardSuccess && (
              <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-2xl px-4 py-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {cardSuccess}
              </p>
            )}

            <button
              type="button"
              onClick={handleInitiateCardPayment}
              disabled={cardInitiating || !cardAmount}
              className="w-full flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
            >
              {cardInitiating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  {isFirstPayment
                    ? `Save first payment${cardAmount ? ` · ${formatCurrency(parseFloat(cardAmount) || 0)}` : ''}`
                    : cardMode === 'processor'
                      ? `Charge ${cardAmount ? formatCurrency(parseFloat(cardAmount) || 0) : ''} by card`
                      : `Record card payment${cardAmount ? ` · ${formatCurrency(parseFloat(cardAmount) || 0)}` : ''}`}
                </>
              )}
            </button>

            {payment?.savedCards && payment.savedCards.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-[#E2D9D0]">
                <p className="text-[11px] text-[#5A6355]">Card on file (type + last 4 only)</p>
                {payment.savedCards.map((card: SavedPaymentCard) => (
                  <div
                    key={card.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2D9D0] bg-white px-4 py-3"
                  >
                    <p className="text-sm font-medium text-[#3D3730] font-mono tracking-wide">
                      {card.brand} •••• {card.last4}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleDeleteCard(card.id)}
                      disabled={saving}
                      className="text-xs font-semibold text-red-700 hover:bg-red-50 px-3 py-2 rounded-xl border border-red-200"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
            <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Record Payment</h3>
            <p className="text-xs text-[#5A6355] bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl px-4 py-3">
              Choose method <strong className="text-[#3D3730]">Card</strong> when the guest paid by card.
              Do not enter card numbers here — those stay with the payment processor.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Amount ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newAmount}
                  onChange={e => setNewAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Date</label>
                <input
                  type="date"
                  value={newDate}
                  onChange={e => setNewDate(e.target.value)}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Payment Method</label>
              <select
                value={newMethod}
                onChange={e => setNewMethod(e.target.value)}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              >
                {PAYMENT_METHODS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Note (optional)</label>
              <input
                type="text"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="e.g. March rent"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            {parseFloat(newAmount) > 0 && (
              <p className="text-xs text-[#5A6355] bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl px-4 py-3">
                After this payment:{' '}
                <span className="font-medium text-[#3D3730]">
                  {formatCurrency(Math.max(0, balanceDue - (parseFloat(newAmount) || 0)))}
                </span>{' '}
                remaining due
                {' '}({formatCurrency(balanceDue)} − {formatCurrency(parseFloat(newAmount) || 0)})
              </p>
            )}
            <button
              onClick={handleAddPayment}
              disabled={saving || !newAmount}
              className="flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition disabled:opacity-50 w-full justify-center"
            >
              <Plus className="w-4 h-4" />
              Add Payment
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[32px] border border-[#E2D9D0] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2D9D0] flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-serif text-[#3D3730]">Payment History</h3>
          <p className="text-xs text-[#5A6355]">
            Running total:{' '}
            <strong className="text-[#3D3730] font-serif text-sm">{formatCurrency(totalPaidAll)}</strong>
          </p>
        </div>
        {payment?.records.length ? (
          <div className="divide-y divide-[#E2D9D0]">
            {(() => {
              // Oldest first for cumulative totals, then reverse for display (newest first)
              const chronological = [...payment.records].sort((a, b) => {
                const byDate = a.date.localeCompare(b.date);
                if (byDate !== 0) return byDate;
                return a.id.localeCompare(b.id);
              });
              let running = 0;
              const withRunning = chronological.map(record => {
                running += Number(record.amount) || 0;
                return { record, runningTotal: Math.round(running * 100) / 100 };
              });
              return [...withRunning].reverse().map(({ record, runningTotal }) => (
              <div key={record.id} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FBF9F7] transition">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#EDE7E1] flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-[#5A6355]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#3D3730]">{formatCurrency(record.amount)}</p>
                    <p className="text-xs text-[#5A6355] flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {record.date} · {record.method}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">Running total</p>
                    <p className="text-sm font-serif font-medium text-[#3D3730]">{formatCurrency(runningTotal)}</p>
                  </div>
                  {record.note && (
                    <p className="text-xs text-[#5A6355] italic max-w-[10rem] truncate">{record.note}</p>
                  )}
                  {onViewReceipt && (
                    <button
                      type="button"
                      onClick={() => onViewReceipt(record.id)}
                      className="text-xs font-semibold text-[#C29474] hover:text-[#A87A5E] flex items-center gap-1"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      Receipt
                    </button>
                  )}
                </div>
              </div>
              ));
            })()}
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-sm text-[#5A6355]">
            No payments recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}