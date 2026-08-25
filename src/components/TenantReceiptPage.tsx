import { apiFetch } from '../lib/api';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Printer, CreditCard, Pencil, Save, X, Trash2, Download,
} from 'lucide-react';
import { ParkContact, PaymentRecord, Tenant, TenantPayment } from '../../types';
import { DEFAULT_CONTACT } from '../../contactDefaults';
import { PaymentReceiptDocument, receiptNumber } from './PaymentReceiptDocument';
import { downloadReceiptPdf } from '../lib/downloadReceipt';

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
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value + (value.length === 10 ? 'T12:00:00' : ''));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
  }
  return value;
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
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

  const loadPaymentData = async (preferId?: string | null) => {
    const [payRes, contactRes] = await Promise.all([
      apiFetch(`/api/tenants/${tenant.id}/payments`),
      apiFetch('/api/contact'),
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
    if (contactRes.ok) {
      setPark({ ...DEFAULT_CONTACT, ...(await contactRes.json()) });
    } else {
      setPark(DEFAULT_CONTACT);
    }
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
    return () => {
      cancelled = true;
    };
  }, [tenant.id, highlightPaymentId]);

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
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/record/${selectedPayment.id}`, {
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
      const res = await apiFetch(`/api/tenants/${tenant.id}/payments/record/${selectedPayment.id}`, {
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

  if (loading) {
    return (
      <div className="py-16 text-center text-sm text-[#5A6355]">Generating receipt…</div>
    );
  }

  if (!payment) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-[#5A6355] hover:text-[#3D3730] transition text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <p className="text-sm text-[#5A6355]">Could not load payment data for this tenant.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-[#5A6355] hover:text-[#3D3730] transition text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {selectedPayment && !editing && (
            <button
              type="button"
              onClick={startEdit}
              className="flex items-center gap-2 border border-[#E2D9D0] bg-white text-[#5A6355] px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] transition"
            >
              <Pencil className="w-4 h-4" />
              Edit payment
            </button>
          )}
          <button
            type="button"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              setDownloadMsg(null);
              const name = selectedPayment
                ? `Pine-Flats-Receipt-${receiptNumber(tenant, selectedPayment)}`
                : `Pine-Flats-Receipt-Space-${tenant.site}-${tenant.name}`;
              const result = await downloadReceiptPdf({ filename: name });
              setDownloading(false);
              if (!result.ok) {
                setDownloadMsg(result.error);
                return;
              }
              setDownloadMsg(`Downloaded PDF: ${result.filename}`);
              setTimeout(() => setDownloadMsg(null), 4000);
            }}
            className="flex items-center gap-2 border border-[#E2D9D0] bg-white text-[#5A6355] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] transition disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {downloading ? 'Making PDF…' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition"
          >
            <Printer className="w-4 h-4" />
            Print receipt
          </button>
        </div>
      </div>

      <p className="text-sm text-[#5A6355] print:hidden">
        Compact one-page receipt. Use <strong>Download PDF</strong> for a letter-size PDF file, or{' '}
        <strong>Print</strong> for a small on-paper copy.
        {tenant.email ? (
          <>
            {' '}
            When payment is recorded, a copy can also be emailed to <strong>{tenant.email}</strong> and
            the park office if email is set up.
          </>
        ) : null}
      </p>
      {downloadMsg && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#C5D9C5] rounded-xl px-4 py-2 print:hidden">
          {downloadMsg}
        </p>
      )}

      {editing && selectedPayment && (
        <div className="print:hidden bg-white border border-[#E2D9D0] rounded-[24px] p-5 space-y-4 shadow-sm">
          <h3 className="text-sm font-serif text-[#3D3730]">Edit payment on this receipt</h3>
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
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Payment date</label>
              <input
                type="date"
                value={editForm.date}
                onChange={(e) => setEditForm((p) => ({ ...p, date: e.target.value }))}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Method</label>
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
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Note</label>
              <input
                type="text"
                value={editForm.note}
                onChange={(e) => setEditForm((p) => ({ ...p, note: e.target.value }))}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
          </div>
          {saveError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{saveError}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSavePayment}
              disabled={saving}
              className="flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save payment'}
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
              Delete
            </button>
          </div>
        </div>
      )}

      <PaymentReceiptDocument
        tenant={tenant}
        payment={payment}
        selectedPayment={selectedPayment}
        park={park}
        statusLabel={saved ? 'Updated' : 'Paid'}
      >
        {payment.records.length > 0 && (
          <section className="print:break-before-page">
            <h2 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4">
              Payment history
            </h2>
            <div className="space-y-2">
              {payment.records.map((record) => {
                const active = record.id === selectedPayment?.id;
                return (
                  <div
                    key={record.id}
                    className={`w-full flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl border transition ${
                      active
                        ? 'bg-[#EDE7E1] border-[#5A6355]'
                        : 'bg-[#FBF9F7] border-[#E2D9D0] hover:border-[#5A6355]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPaymentId(record.id);
                        setEditing(false);
                        setSaveError('');
                      }}
                      className="flex items-center gap-3 min-w-0 text-left flex-1 print:cursor-default"
                    >
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
                    </button>
                    <div className="flex items-center gap-2 print:hidden shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPaymentId(record.id);
                          setEditForm({
                            amount: String(record.amount),
                            date: record.date || new Date().toISOString().split('T')[0],
                            method: record.method || 'Cash',
                            note: record.note || '',
                          });
                          setSaveError('');
                          setSaved(false);
                          setEditing(true);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#5A6355] text-white text-xs font-semibold hover:bg-[#3D3730]"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      {active && (
                        <span className="text-xs font-semibold text-[#5A6355]">On receipt</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </PaymentReceiptDocument>
    </div>
  );
}
