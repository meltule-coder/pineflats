import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Printer, MapPin, Phone, Mail, Truck, User, FileText,
  CreditCard, Calendar, CheckCircle2, DollarSign, Pencil, Save, X, Trash2
} from 'lucide-react';
import { ParkContact, PaymentRecord, Tenant, TenantPayment } from '../../types';

const KWH_RATE = 0.24;
const PAYMENT_METHODS = ['Cash', 'Check', 'Card', 'Venmo', 'Zelle', 'Bank Transfer'];

interface TenantReceiptPageProps {
  tenant: Tenant;
  onBack: () => void;
  /** Prefer showing this payment first when opening after a transaction */
  highlightPaymentId?: string | null;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(value?: string) {
  if (!value) return '—';
  // Keep free-text dates as-is; format ISO-like dates
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value + (value.length === 10 ? 'T12:00:00' : ''));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
  }
  return value;
}

function receiptNumber(tenant: Tenant, payment: PaymentRecord) {
  const site = String(tenant.site).padStart(2, '0');
  const shortId = payment.id.replace(/\D/g, '').slice(-6) || payment.id.slice(-6);
  return `PF-${site}-${shortId}`;
}

export function TenantReceiptPage({ tenant, onBack, highlightPaymentId }: TenantReceiptPageProps) {
  const [payment, setPayment] = useState<TenantPayment | null>(null);
  const [park, setPark] = useState<ParkContact | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(highlightPaymentId ?? null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ amount: '', date: '', method: 'Cash', note: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  const loadPaymentData = async (preferId?: string | null) => {
    const [payRes, contactRes] = await Promise.all([
      fetch(`/api/tenants/${tenant.id}/payments`),
      fetch('/api/contact'),
    ]);
    if (payRes.ok) {
      const data: TenantPayment = await payRes.json();
      setPayment(data);
      const preferred =
        preferId && data.records.some((r) => r.id === preferId)
          ? preferId
          : highlightPaymentId && data.records.some((r) => r.id === highlightPaymentId)
            ? highlightPaymentId
            : data.records[0]?.id ?? null;
      setSelectedPaymentId(preferred);
    }
    if (contactRes.ok) setPark(await contactRes.json());
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadPaymentData(highlightPaymentId);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenant.id, highlightPaymentId]);

  const rent = payment?.rentAmount ?? 0;
  const usage = payment?.currentReadingTotal ?? 0;
  const baseline = payment?.baselineCredit ?? 0;
  const netKwh = Math.max(0, usage - baseline);
  const electric = netKwh * KWH_RATE;
  const carriedBalance = payment?.carriedBalance ?? 0;
  const periodKey =
    payment?.billingPeriod && /^\d{4}-\d{2}$/.test(payment.billingPeriod)
      ? payment.billingPeriod
      : '';
  const extraChargesTotal =
    payment?.extraCharges?.reduce((s, c) => s + (Number(c.amount) || 0), 0) ?? 0;
  // Period charges = rent + utilities + extra charges only (no carried)
  const chargesTotal = rent + electric + extraChargesTotal;
  const totalPaidAll = payment?.records.reduce((s, r) => s + r.amount, 0) ?? 0;
  const totalPaid = periodKey
    ? (payment?.records
        ?.filter((r) => (r.date || '').startsWith(periodKey))
        .reduce((s, r) => s + r.amount, 0) ?? 0)
    : Math.max(0, totalPaidAll - (payment?.paymentBaseline ?? 0));
  const balanceDue = Math.max(0, carriedBalance + chargesTotal - totalPaid);

  const selectedPayment: PaymentRecord | null = useMemo(() => {
    if (!payment?.records.length) return null;
    return payment.records.find((r) => r.id === selectedPaymentId) ?? payment.records[0] ?? null;
  }, [payment, selectedPaymentId]);

  const startEdit = () => {
    if (!selectedPayment) return;
    setEditForm({
      amount: String(selectedPayment.amount),
      date: selectedPayment.date || new Date().toISOString().split('T')[0],
      method: selectedPayment.method || 'Cash',
      note: selectedPayment.note || '',
    });
    setSaveError('');
    setSaved(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaveError('');
    setSaved(false);
  };

  const handleSavePayment = async () => {
    if (!selectedPayment) return;
    const amount = parseFloat(editForm.amount);
    if (!amount || amount <= 0) {
      setSaveError('Enter a valid payment amount greater than zero.');
      return;
    }
    if (!editForm.date) {
      setSaveError('Payment date is required.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/payments/record/${selectedPayment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          date: editForm.date,
          method: editForm.method,
          note: editForm.note.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || 'Failed to update payment');
        return;
      }
      const data: TenantPayment = await res.json();
      setPayment(data);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setSaveError('Network error — could not save payment.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePayment = async () => {
    if (!selectedPayment) return;
    if (!window.confirm('Delete this payment from the receipt? Balance due will be recalculated.')) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/payments/record/${selectedPayment.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || 'Failed to delete payment');
        return;
      }
      const data: TenantPayment = await res.json();
      setPayment(data);
      setSelectedPaymentId(data.records[0]?.id ?? null);
      setEditing(false);
    } catch {
      setSaveError('Network error — could not delete payment.');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-sm text-[#5A6355]">Loading receipt…</div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[#5A6355] hover:text-[#3D3730] transition text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition"
        >
          <Printer className="w-4 h-4" />
          Print Receipt
        </button>
      </div>

      {/* Printable receipt document */}
      <div
        id="tenant-receipt"
        className="bg-white rounded-[32px] border border-[#E2D9D0] shadow-sm overflow-hidden print:rounded-none print:border-0 print:shadow-none"
      >
        {/* Park header */}
        <div className="bg-[#5A6355] text-white px-6 md:px-10 py-8 print:bg-[#5A6355]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <img
                src="/logo.svg"
                alt="Pine Flats"
                className="h-14 w-14 rounded-xl bg-white p-1 border border-white/30"
              />
              <div>
                <h1 className="text-2xl md:text-3xl font-serif italic font-bold">Pine Flats RV Park</h1>
                <p className="text-sm text-white/80 mt-1">{park?.tagline || 'Property Management'}</p>
              </div>
            </div>
            <div className="text-sm text-white/90 space-y-1 text-right">
              {park?.contactName && <p className="font-medium">{park.contactName}</p>}
              {park?.address && <p>{park.address}</p>}
              {park?.phone && (
                <p className="flex items-center justify-end gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> {park.phone}
                </p>
              )}
              {park?.email && (
                <p className="flex items-center justify-end gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> {park.email}
                </p>
              )}
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-white/20 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-white/70">Official Receipt</p>
              <p className="text-lg font-serif mt-1">
                {selectedPayment
                  ? `Receipt ${receiptNumber(tenant, selectedPayment)}`
                  : `Account Summary — Space ${tenant.site}`}
              </p>
            </div>
            <p className="text-sm text-white/80">
              Issued {formatDate(new Date().toISOString().split('T')[0])}
            </p>
          </div>
        </div>

        <div className="p-6 md:p-10 space-y-8">
          {/* Tenant information — all current fields */}
          <section>
            <h2 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4">
              Tenant Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <InfoRow icon={User} label="Name" value={tenant.name} />
              <InfoRow icon={MapPin} label="Space" value={`Space ${tenant.site}`} />
              <InfoRow icon={CheckCircle2} label="Status" value={tenant.status} />
              <InfoRow icon={FileText} label="Rental Type" value={tenant.rentalType ? capitalize(tenant.rentalType) : '—'} />
              <InfoRow icon={Calendar} label="Start Date" value={formatDate(tenant.startDate)} />
              <InfoRow icon={Calendar} label="End Date" value={formatDate(tenant.endDate) || 'ongoing'} />
              <InfoRow icon={Phone} label="Phone" value={tenant.phone || '—'} />
              <InfoRow icon={Mail} label="Email" value={tenant.email || '—'} />
              <InfoRow icon={User} label="Emergency Contact" value={tenant.emergencyContact || '—'} />
              <InfoRow icon={Truck} label="RV Type" value={tenant.rvType || '—'} />
              <InfoRow icon={CreditCard} label="License Plate" value={tenant.licensePlate || '—'} />
              <InfoRow
                icon={FileText}
                label="Notes"
                value={tenant.notes || tenant.description || '—'}
                className="sm:col-span-2 lg:col-span-3"
              />
            </div>
          </section>

          {/* Account / charges summary */}
          <section>
            <h2 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4">
              Account Summary
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard label="Rent" value={formatCurrency(rent)} />
              <SummaryCard label="Utilities" value={formatCurrency(electric)} sub={`${netKwh.toLocaleString()} kWh × $${KWH_RATE}`} />
              <SummaryCard
                label="Extra Charges"
                value={formatCurrency(extraChargesTotal)}
                sub={payment?.extraCharges?.length ? `${payment.extraCharges.length} item(s)` : 'None'}
              />
              <SummaryCard label="Paid This Period" value={formatCurrency(totalPaid)} accent="green" />
            </div>
            <div className={`mt-4 rounded-2xl border px-5 py-4 space-y-2 ${
              balanceDue <= 0
                ? 'bg-[#E8F0E8] border-[#A8B2A6]'
                : 'bg-[#F5E6DC] border-[#C29474]'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-[#3D3730]">
                  <DollarSign className="w-4 h-4" />
                  Period Charges
                </div>
                <p className="text-xl font-serif text-[#3D3730]">{formatCurrency(chargesTotal)}</p>
              </div>
              <p className="text-xs text-[#5A6355]">
                {formatCurrency(rent)} rent + {formatCurrency(electric)} util + {formatCurrency(extraChargesTotal)} extras
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-black/10">
                <span className="text-sm font-medium text-[#3D3730]">Amount Due</span>
                <p className={`text-2xl font-serif ${balanceDue <= 0 ? 'text-[#3D5A3D]' : 'text-[#C29474]'}`}>
                  {formatCurrency(balanceDue)}
                </p>
              </div>
              <p className="text-xs text-[#5A6355]">
                {formatCurrency(chargesTotal)} period charges
                {carriedBalance > 0.009 && <> + {formatCurrency(carriedBalance)} carried</>}
                {' − '}
                {formatCurrency(totalPaid)} payments
                {' = '}
                {formatCurrency(balanceDue)} due
              </p>
            </div>
          </section>

          {/* Extra charges line items */}
          <section>
            <h2 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4">
              Extra Charges
            </h2>
            {payment?.extraCharges && payment.extraCharges.length > 0 ? (
              <div className="border border-[#E2D9D0] rounded-[24px] overflow-hidden bg-[#FBF9F7]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white border-b border-[#E2D9D0] text-left text-xs uppercase tracking-widest text-[#5A6355]">
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Description</th>
                      <th className="px-5 py-3 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payment.extraCharges.map((charge) => (
                      <tr key={charge.id} className="border-b border-[#E2D9D0] last:border-0">
                        <td className="px-5 py-3 text-[#5A6355] whitespace-nowrap">
                          {formatDate(charge.date)}
                        </td>
                        <td className="px-5 py-3 text-[#3D3730]">
                          <span className="font-medium">{charge.description}</span>
                          {charge.note ? (
                            <span className="block text-xs text-[#5A6355] italic mt-0.5">{charge.note}</span>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-[#3D3730] whitespace-nowrap">
                          {formatCurrency(charge.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-white border-t border-[#E2D9D0]">
                      <td className="px-5 py-3 font-serif text-[#3D3730]" colSpan={2}>
                        Total Extra Charges
                      </td>
                      <td className="px-5 py-3 text-right text-lg font-serif text-[#3D3730]">
                        {formatCurrency(extraChargesTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-[#E2D9D0] px-6 py-8 text-center text-sm text-[#5A6355]">
                No extra charges on this account.
              </div>
            )}
          </section>

          {/* Transaction receipt */}
          <section>
            <h2 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4">
              Transaction Receipt
            </h2>

            {selectedPayment ? (
              <div className="border border-[#E2D9D0] rounded-[24px] overflow-hidden bg-[#FBF9F7]">
                <div className="px-5 py-4 bg-white border-b border-[#E2D9D0] flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-[#5A6355]">Payment Received</p>
                    <p className="text-lg font-serif text-[#3D3730] mt-0.5">
                      {receiptNumber(tenant, selectedPayment)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E8F0E8] border border-[#A8B2A6] text-xs font-semibold text-[#3D5A3D]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {saved ? 'Updated' : 'Paid'}
                    </span>
                    {!editing ? (
                      <button
                        type="button"
                        onClick={startEdit}
                        className="print:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#5A6355] text-white text-xs font-semibold hover:bg-[#3D3730] transition"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit Payment
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="print:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E2D9D0] text-[#5A6355] text-xs font-semibold hover:bg-[#FBF9F7] transition"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-5 md:p-6 space-y-4">
                  {editing ? (
                    <div className="print:hidden space-y-4 bg-white border border-[#E2D9D0] rounded-2xl p-4 md:p-5">
                      <h3 className="text-sm font-serif text-[#3D3730]">Edit Payment Details</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest text-[#5A6355]">Amount ($)</label>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={editForm.amount}
                            onChange={(e) => setEditForm((p) => ({ ...p, amount: e.target.value }))}
                            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest text-[#5A6355]">Payment Date</label>
                          <input
                            type="date"
                            value={editForm.date}
                            onChange={(e) => setEditForm((p) => ({ ...p, date: e.target.value }))}
                            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest text-[#5A6355]">Payment Method</label>
                          <select
                            value={editForm.method}
                            onChange={(e) => setEditForm((p) => ({ ...p, method: e.target.value }))}
                            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                          >
                            {PAYMENT_METHODS.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                            {!PAYMENT_METHODS.includes(editForm.method) && editForm.method && (
                              <option value={editForm.method}>{editForm.method}</option>
                            )}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-widest text-[#5A6355]">Note / Description</label>
                          <input
                            type="text"
                            value={editForm.note}
                            onChange={(e) => setEditForm((p) => ({ ...p, note: e.target.value }))}
                            placeholder="e.g. March rent"
                            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                          />
                        </div>
                      </div>
                      {saveError && (
                        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                          {saveError}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSavePayment}
                          disabled={saving}
                          className="flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition disabled:opacity-50"
                        >
                          <Save className="w-4 h-4" />
                          {saving ? 'Saving…' : 'Save Payment'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={saving}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm border border-[#E2D9D0] hover:bg-[#FBF9F7] transition"
                        >
                          <X className="w-4 h-4" />
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleDeletePayment}
                          disabled={saving}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm border border-red-300 text-red-700 hover:bg-red-50 transition ml-auto"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete Payment
                        </button>
                      </div>
                      <p className="text-xs text-[#5A6355]">
                        Saving updates this receipt and recalculates amount due (charges − all payments).
                      </p>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-[#5A6355] mb-1">Received From</p>
                      <p className="font-medium text-[#3D3730]">{tenant.name}</p>
                      <p className="text-[#5A6355]">Space {tenant.site}</p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-xs uppercase tracking-widest text-[#5A6355] mb-1">Payment Date</p>
                      <p className="font-medium text-[#3D3730]">{formatDate(selectedPayment.date)}</p>
                      <p className="text-[#5A6355]">{selectedPayment.method}</p>
                    </div>
                  </div>

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E2D9D0] text-left text-xs uppercase tracking-widest text-[#5A6355]">
                        <th className="py-2 font-medium">Description</th>
                        <th className="py-2 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[#E2D9D0]/">
                        <td className="py-3 text-[#3D3730]">
                          Payment toward account balance
                          {selectedPayment.note ? (
                            <span className="block text-xs text-[#5A6355] mt-0.5 italic">{selectedPayment.note}</span>
                          ) : null}
                        </td>
                        <td className="py-3 text-right font-medium text-[#3D3730]">
                          {formatCurrency(selectedPayment.amount)}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="pt-4 font-serif text-[#3D3730]">Amount Paid</td>
                        <td className="pt-4 text-right text-xl font-serif text-[#3D5A3D]">
                          {formatCurrency(selectedPayment.amount)}
                        </td>
                      </tr>
                      <tr>
                        <td className="pt-1 text-xs text-[#5A6355]">Remaining balance after this payment*</td>
                        <td className="pt-1 text-right text-sm font-medium text-[#3D3730]">
                          {formatCurrency(
                            Math.max(
                              0,
                              balanceDue
                            )
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  <p className="text-[11px] text-[#5A6355]">
                    * Remaining balance reflects current account charges minus all recorded payments.
                  </p>

                  <div className="pt-4 border-t border-[#E2D9D0] text-xs text-[#5A6355] space-y-1">
                    <p>Thank you for your payment. Please keep this receipt for your records.</p>
                    <p>
                      Tenant: <strong className="text-[#3D3730]">{tenant.name}</strong>
                      {' · '}
                      Space <strong className="text-[#3D3730]">{tenant.site}</strong>
                      {' · '}
                      Method <strong className="text-[#3D3730]">{selectedPayment.method}</strong>
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-[#E2D9D0] px-6 py-10 text-center text-sm text-[#5A6355]">
                No payments recorded yet. Record a payment on the Payments page to generate a transaction receipt.
              </div>
            )}
          </section>

          {/* All payment history as mini-receipts list */}
          {payment && payment.records.length > 0 && (
            <section className="print:break-before-page">
              <h2 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4">
                Payment History
              </h2>
              <div className="space-y-2">
                {payment.records.map((record) => {
                  const active = record.id === selectedPayment?.id;
                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => {
                        setSelectedPaymentId(record.id);
                        setEditing(false);
                        setSaveError('');
                      }}
                      className={`w-full text-left flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl border transition print:cursor-default ${
                        active
                          ? 'bg-[#EDE7E1] border-[#5A6355]'
                          : 'bg-[#FBF9F7] border-[#E2D9D0] hover:border-[#5A6355]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-white border border-[#E2D9D0] flex items-center justify-center shrink-0">
                          <CreditCard className="w-4 h-4 text-[#5A6355]" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#3D3730]">{formatCurrency(record.amount)}</p>
                          <p className="text-xs text-[#5A6355] truncate">
                            {formatDate(record.date)} · {record.method}
                            {record.note ? ` · ${record.note}` : ''}
                          </p>
                          <p className="text-[11px] font-mono text-[#5A6355] mt-0.5">
                            {receiptNumber(tenant, record)}
                          </p>
                        </div>
                      </div>
                      {active && (
                        <span className="text-xs font-semibold text-[#5A6355] print:hidden">Showing above</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <footer className="pt-4 border-t border-[#E2D9D0] text-center text-xs text-[#5A6355]">
            Pine Flats RV Park · Space {tenant.site} · {tenant.name}
            {park?.phone ? ` · ${park.phone}` : ''}
            {park?.email ? ` · ${park.email}` : ''}
          </footer>
        </div>
      </div>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function InfoRow({
  icon: Icon,
  label,
  value,
  className = '',
}: {
  icon: typeof User;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`flex gap-3 ${className}`}>
      <div className="w-8 h-8 rounded-xl bg-[#EDE7E1] flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-[#5A6355]" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">{label}</p>
        <p className="text-[#3D3730] font-medium break-words">{value}</p>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'green';
}) {
  return (
    <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">{label}</p>
      <p className={`text-lg font-serif mt-1 ${accent === 'green' ? 'text-[#3D5A3D]' : 'text-[#3D3730]'}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-[#5A6355] mt-0.5">{sub}</p>}
    </div>
  );
}
