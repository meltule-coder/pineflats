import { useEffect, useState } from 'react';
import {
  ArrowLeft, DollarSign, Calendar, CreditCard, Plus, CheckCircle2, Receipt, Gauge,
  Pencil, Save, X, Trash2
} from 'lucide-react';
import { Tenant, TenantPayment, MeterRecord, ExtraCharge, PaymentCredit, SavedPaymentCard } from '../../types';
import {
  DEFAULT_RENTAL_RATES,
  dailyRateLabel, formatDailyRateDescription, rentAmountForType, prorateMonthlyRent,
  type RentalRatesConfig,
} from '../../rentUtils';
import { fetchActiveRates } from '../lib/activeRates';
import { ReceiptLink } from './ReceiptLink';

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
  const [cardForm, setCardForm] = useState({
    cardholderName: '',
    last4: '',
    brand: 'Card',
    expMonth: '',
    expYear: '',
    billingZip: '',
    label: '',
    notes: '',
    isDefault: true,
  });
  const [cardError, setCardError] = useState('');
  const [cardSuccess, setCardSuccess] = useState('');
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  const [editChargeForm, setEditChargeForm] = useState({
    amount: '',
    date: '',
    description: '',
    note: '',
  });
  const [rates, setRates] = useState<RentalRatesConfig>(DEFAULT_RENTAL_RATES);

  const loadPayment = async (activeRates: RentalRatesConfig = rates) => {
    const res = await fetch(`/api/tenants/${tenant.id}/payments`);
    if (res.ok) {
      const data: TenantPayment = await res.json();
      setPayment(data);
      const rentalType = data.rentalType ?? tenant.rentalType;
      if (rentalType === 'daily') {
        const resolvedRent = rentAmountForType('daily', new Date(), activeRates);
        setRentAmount(String(resolvedRent));
        if (resolvedRent !== data.rentAmount) {
          await fetch(`/api/tenants/${tenant.id}/payments`, {
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
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const activeRates = await fetchActiveRates();
      if (cancelled) return;
      setRates(activeRates);
      await loadPayment(activeRates);
    })();
    return () => { cancelled = true; };
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments`, {
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments/meter`, {
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments/meter/${editingMeterId}`, {
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments/meter/${recordId}`, {
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments/charges`, {
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments/charges/${editingChargeId}`, {
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments/charges/${chargeId}`, {
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments/credits`, {
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments/credits/${editingCreditId}`, {
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments/credits/${creditId}`, {
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

  const handleSaveCard = async () => {
    setCardError('');
    setCardSuccess('');
    if (!cardForm.cardholderName.trim()) {
      setCardError('Cardholder name is required.');
      return;
    }
    const last4 = cardForm.last4.replace(/\D/g, '');
    if (last4.length !== 4) {
      setCardError('Enter exactly the last 4 digits of the card (full card numbers are not accepted).');
      return;
    }
    if (!cardForm.expMonth || !cardForm.expYear) {
      setCardError('Expiry month and year are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/payments/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardholderName: cardForm.cardholderName.trim(),
          last4,
          brand: cardForm.brand,
          expMonth: cardForm.expMonth,
          expYear: cardForm.expYear,
          billingZip: cardForm.billingZip || undefined,
          label: cardForm.label || undefined,
          notes: cardForm.notes || undefined,
          isDefault: cardForm.isDefault,
        }),
      });
      if (res.ok) {
        await loadPayment();
        setCardForm({
          cardholderName: '',
          last4: '',
          brand: 'Card',
          expMonth: '',
          expYear: '',
          billingZip: '',
          label: '',
          notes: '',
          isDefault: false,
        });
        setCardSuccess('Card reference saved securely (encrypted last 4 + expiry only).');
        setTimeout(() => setCardSuccess(''), 3500);
      } else {
        const data = await res.json().catch(() => ({}));
        setCardError(data.error || 'Could not save card.');
      }
    } catch {
      setCardError('Network error — could not save card.');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefaultCard = async (cardId: string) => {
    setSaving(true);
    setCardError('');
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/payments/cards/${cardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      if (res.ok) await loadPayment();
      else {
        const data = await res.json().catch(() => ({}));
        setCardError(data.error || 'Could not update card.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!window.confirm('Remove this card from the tenant’s file?')) return;
    setSaving(true);
    setCardError('');
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/payments/cards/${cardId}`, {
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
      const res = await fetch(`/api/tenants/${tenant.id}/payments/record`, {
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
        const updated: TenantPayment = await res.json();
        await loadPayment();
        setNewAmount('');
        setNewNote('');
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

          <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
            <div className="border-b border-[#E2D9D0] pb-2">
              <h3 className="text-sm font-serif text-[#3D3730]">Saved Payment Cards</h3>
              <p className="text-xs text-[#5A6355] mt-1">
                Secure card-on-file reference only: last 4 digits, name, brand, and expiry.
                Full card numbers and CVV are never accepted or stored. Data is encrypted at rest.
              </p>
            </div>
            {payment?.savedCards && payment.savedCards.length > 0 && (
              <div className="space-y-2">
                {payment.savedCards.map((card: SavedPaymentCard) => (
                  <div
                    key={card.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-[#EDE7E1] flex items-center justify-center shrink-0">
                        <CreditCard className="w-4 h-4 text-[#5A6355]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#3D3730] truncate">
                          {card.brand} •••• {card.last4}
                          {card.isDefault && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-[#3D5A3D] bg-[#E8F0E8] px-2 py-0.5 rounded-full">
                              Default
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-[#5A6355] truncate">
                          {card.cardholderName}
                          {' · '}
                          Exp {card.expMonth}/{card.expYear.slice(-2)}
                          {card.label ? ` · ${card.label}` : ''}
                          {card.billingZip ? ` · ZIP ${card.billingZip}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!card.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleSetDefaultCard(card.id)}
                          disabled={saving}
                          className="text-xs font-semibold text-[#5A6355] hover:text-[#3D3730] px-3 py-2 rounded-xl border border-[#E2D9D0] bg-white"
                        >
                          Make default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteCard(card.id)}
                        disabled={saving}
                        className="text-xs font-semibold text-red-700 hover:bg-red-50 px-3 py-2 rounded-xl border border-red-200"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Cardholder name *</label>
                <input
                  autoComplete="off"
                  value={cardForm.cardholderName}
                  onChange={e => setCardForm(p => ({ ...p, cardholderName: e.target.value }))}
                  placeholder="Name on card"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Last 4 digits *</label>
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={cardForm.last4}
                  onChange={e => setCardForm(p => ({ ...p, last4: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="1234"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355] font-mono tracking-widest"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Brand *</label>
                <select
                  value={cardForm.brand}
                  onChange={e => setCardForm(p => ({ ...p, brand: e.target.value }))}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                >
                  {['Card', 'Visa', 'Mastercard', 'Amex', 'Discover', 'Other'].map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Exp month *</label>
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  value={cardForm.expMonth}
                  onChange={e => setCardForm(p => ({ ...p, expMonth: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
                  placeholder="MM"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Exp year *</label>
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={cardForm.expYear}
                  onChange={e => setCardForm(p => ({ ...p, expYear: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="YYYY"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Billing ZIP</label>
                <input
                  value={cardForm.billingZip}
                  onChange={e => setCardForm(p => ({ ...p, billingZip: e.target.value }))}
                  placeholder="Optional"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Label</label>
                <input
                  value={cardForm.label}
                  onChange={e => setCardForm(p => ({ ...p, label: e.target.value }))}
                  placeholder="e.g. Primary, Work"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-[#5A6355] cursor-pointer">
              <input
                type="checkbox"
                checked={cardForm.isDefault}
                onChange={e => setCardForm(p => ({ ...p, isDefault: e.target.checked }))}
                className="rounded border-[#E2D9D0]"
              />
              Set as default card for this tenant
            </label>
            {cardError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{cardError}</p>
            )}
            {cardSuccess && (
              <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-2xl px-4 py-3">{cardSuccess}</p>
            )}
            <button
              type="button"
              onClick={handleSaveCard}
              disabled={saving}
              className="flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50 w-full"
            >
              <CreditCard className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save Card on File'}
            </button>
          </div>

          <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
            <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Record Payment</h3>
            {payment?.savedCards && payment.savedCards.length > 0 && (
              <p className="text-xs text-[#5A6355] bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl px-4 py-3">
                Card on file:{' '}
                <strong className="text-[#3D3730]">
                  {(payment.savedCards.find(c => c.isDefault) || payment.savedCards[0]).brand}
                  {' '}•••• {(payment.savedCards.find(c => c.isDefault) || payment.savedCards[0]).last4}
                </strong>
                {' '}— choose Card below when recording a payment with this method.
              </p>
            )}
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
                {payment?.savedCards?.map(card => (
                  <option key={card.id} value={`Card •••• ${card.last4}`}>
                    {card.brand} •••• {card.last4}
                    {card.isDefault ? ' (default)' : ''}
                  </option>
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