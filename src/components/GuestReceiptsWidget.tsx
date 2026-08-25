import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Calculator,
  Download,
  FileText,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';

type GuestReceipt = {
  id: string;
  receiptNumber?: string;
  bookedAt: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rentalType: 'daily' | 'weekly';
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  siteLabel: string;
  paymentMethod?: string;
  rentSubtotal: number;
  stateTax: number;
  countyTax: number;
  totalTax: number;
  grandTotal: number;
  status: string;
  source: string;
};

type FormState = {
  id?: string;
  bookedAt: string;
  checkIn: string;
  checkOut: string;
  rentalType: 'daily' | 'weekly';
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  siteLabel: string;
  paymentMethod: string;
  rentSubtotal: string;
  stateTax: string;
  countyTax: string;
  grandTotal: string;
};

const PAYMENT_PRESETS = ['Cash', 'Card', 'Check', 'Venmo', 'Zelle', 'Bank Transfer'];

const EMPTY_FORM = (): FormState => ({
  bookedAt: new Date().toISOString().slice(0, 10),
  checkIn: new Date().toISOString().slice(0, 10),
  checkOut: new Date().toISOString().slice(0, 10),
  rentalType: 'daily',
  guestName: '',
  guestEmail: '',
  guestPhone: '',
  siteLabel: '',
  paymentMethod: 'Cash',
  rentSubtotal: '',
  stateTax: '0',
  countyTax: '0',
  grandTotal: '',
});

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}

function receiptToForm(r: GuestReceipt): FormState {
  return {
    id: r.id,
    bookedAt: r.bookedAt || '',
    checkIn: r.checkIn || '',
    checkOut: r.checkOut || '',
    rentalType: r.rentalType,
    guestName: r.guestName || '',
    guestEmail: r.guestEmail || '',
    guestPhone: r.guestPhone || '',
    siteLabel: r.siteLabel || '',
    paymentMethod: r.paymentMethod || 'Cash',
    rentSubtotal: String(r.rentSubtotal ?? ''),
    stateTax: String(r.stateTax ?? 0),
    countyTax: String(r.countyTax ?? 0),
    grandTotal: String(r.grandTotal ?? ''),
  };
}

function isLedgerId(id?: string) {
  return !!id && id.startsWith('tax_') && !id.startsWith('tax_slot_');
}

export function GuestReceiptsWidget() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [typeFilter, setTypeFilter] = useState<'all' | 'daily' | 'weekly'>('all');
  const [search, setSearch] = useState('');
  const [receipts, setReceipts] = useState<GuestReceipt[]>([]);
  const [summary, setSummary] = useState({
    count: 0,
    dailyCount: 0,
    weeklyCount: 0,
    rentSubtotal: 0,
    totalTax: 0,
    grandTotal: 0,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const guestNameRef = useRef<HTMLInputElement>(null);

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        year: String(year),
        type: typeFilter,
      });
      const res = await apiFetch(`/api/receipts/overnight-weekly?${q}`);
      if (res.status === 401) {
        setError('Admin session expired. Sign in again.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Could not load receipts (${res.status})`);
        return;
      }
      const data = await res.json();
      setReceipts(data.receipts || []);
      setSummary(
        data.summary || {
          count: 0,
          dailyCount: 0,
          weeklyCount: 0,
          rentSubtotal: 0,
          totalTax: 0,
          grandTotal: 0,
        }
      );
    } catch {
      setError('Network error loading guest receipts.');
    } finally {
      setLoading(false);
    }
  }, [year, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Focus first field when editor opens
  useEffect(() => {
    if (!form) return;
    const t = window.setTimeout(() => guestNameRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [form]);

  // Escape closes editor
  useEffect(() => {
    if (!form) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) setForm(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, saving]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return receipts;
    return receipts.filter(r => {
      const hay = [
        r.guestName,
        r.guestEmail,
        r.guestPhone,
        r.siteLabel,
        r.receiptNumber,
        r.paymentMethod,
        r.checkIn,
        r.checkOut,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [receipts, search]);

  const recomputeTotal = (next: FormState): FormState => {
    const rent = parseFloat(next.rentSubtotal) || 0;
    const state = parseFloat(next.stateTax) || 0;
    const county = parseFloat(next.countyTax) || 0;
    return {
      ...next,
      grandTotal: (Math.round((rent + state + county) * 100) / 100).toFixed(2),
    };
  };

  const applyTaxFromRent = () => {
    setForm(f => {
      if (!f) return f;
      // Simple local estimate: keep tax rates proportional if taxes already set, else 0
      // Server-side rates are applied when booking; here re-sum is enough for manual edits.
      // If both taxes are 0, leave them 0 and just fix grand total.
      return recomputeTotal(f);
    });
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(f => {
      if (!f) return f;
      const next = { ...f, [key]: value };
      if (key === 'rentSubtotal' || key === 'stateTax' || key === 'countyTax') {
        return recomputeTotal(next);
      }
      return next;
    });
  };

  const openNew = () => {
    setForm(EMPTY_FORM());
    setError(null);
    setMessage(null);
  };

  const openEdit = (r: GuestReceipt) => {
    setForm(receiptToForm(r));
    setError(null);
    setMessage(null);
  };

  const handleSave = async () => {
    if (!form) return;
    if (!form.guestName.trim() || !form.siteLabel.trim()) {
      setError('Guest name and site are required.');
      return;
    }
    if (!form.checkIn || !form.checkOut) {
      setError('Check-in and check-out dates are required.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body = {
        bookedAt: form.bookedAt,
        checkIn: form.checkIn,
        checkOut: form.checkOut,
        rentalType: form.rentalType,
        guestName: form.guestName.trim(),
        guestEmail: form.guestEmail.trim() || undefined,
        guestPhone: form.guestPhone.trim() || undefined,
        siteLabel: form.siteLabel.trim(),
        paymentMethod: form.paymentMethod.trim() || undefined,
        rentSubtotal: parseFloat(form.rentSubtotal) || 0,
        stateTax: parseFloat(form.stateTax) || 0,
        countyTax: parseFloat(form.countyTax) || 0,
        grandTotal: parseFloat(form.grandTotal) || 0,
        status: 'paid' as const,
      };
      // Always send id when editing so email_ rows convert + hide cleanly
      const editing = !!form.id;
      const res = await apiFetch(
        isLedgerId(form.id)
          ? `/api/receipts/overnight-weekly/${encodeURIComponent(form.id!)}`
          : '/api/receipts/overnight-weekly',
        {
          method: isLedgerId(form.id) ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing ? { ...body, id: form.id } : body),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Could not save (${res.status})`);
        return;
      }
      setForm(null);
      setMessage(editing ? 'Receipt saved.' : 'Receipt added.');
      await load();
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setError('Network error saving receipt.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: GuestReceipt) => {
    if (!window.confirm(`Delete receipt for ${r.guestName}? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/receipts/overnight-weekly/${encodeURIComponent(r.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not delete receipt');
        return;
      }
      if (form?.id === r.id) setForm(null);
      setMessage('Receipt deleted.');
      await load();
      setTimeout(() => setMessage(null), 2500);
    } catch {
      setError('Network error deleting receipt.');
    }
  };

  const exportCsv = () => {
    const headers = [
      'Receipt #',
      'Booked',
      'Guest',
      'Email',
      'Phone',
      'Site',
      'Type',
      'Check-in',
      'Check-out',
      'Nights',
      'Rent',
      'State tax',
      'County tax',
      'Total tax',
      'Grand total',
      'Payment',
      'Status',
      'Source',
    ];
    const rows = filtered.map(r => [
      r.receiptNumber || '',
      r.bookedAt,
      r.guestName,
      r.guestEmail || '',
      r.guestPhone || '',
      r.siteLabel,
      r.rentalType,
      r.checkIn,
      r.checkOut,
      r.nights,
      r.rentSubtotal.toFixed(2),
      r.stateTax.toFixed(2),
      r.countyTax.toFixed(2),
      r.totalTax.toFixed(2),
      r.grandTotal.toFixed(2),
      r.paymentMethod || '',
      r.status,
      r.source,
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pineflats-overnight-weekly-receipts-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center shrink-0">
            <Moon className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">
              Overnight &amp; weekly guest receipts
            </h3>
            <p className="text-xs text-[#5A6355] mt-1 max-w-2xl">
              Search, click a row, or press Edit to change a receipt. Saves update your permanent
              records.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Year</label>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="block px-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          >
            {years.map(y => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Stay type</label>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as 'all' | 'daily' | 'weekly')}
            className="block px-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          >
            <option value="all">All overnight &amp; weekly</option>
            <option value="daily">Daily / overnight only</option>
            <option value="weekly">Weekly only</option>
          </select>
        </div>
        <div className="space-y-1 flex-1 min-w-[180px]">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Search</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#A8B2A6]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Guest, site, receipt #…"
              className="w-full pl-9 pr-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <button
          type="button"
          onClick={openNew}
          className="flex items-center gap-2 bg-[#C29474] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5C]"
        >
          <Plus className="w-4 h-4" />
          Add receipt
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="flex items-center gap-2 border border-[#E2D9D0] text-[#5A6355] bg-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {error && !form && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
      {message && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2">
          {message}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Receipts" value={String(summary.count)} />
        <Stat label="Daily / weekly" value={`${summary.dailyCount} / ${summary.weeklyCount}`} />
        <Stat label="Rent" value={money(summary.rentSubtotal)} />
        <Stat label="Tax" value={money(summary.totalTax)} />
        <Stat label="Grand total" value={money(summary.grandTotal)} accent wide />
      </div>

      {/* Mobile-friendly cards + desktop table */}
      <div className="space-y-3 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-[#E2D9D0] px-4 py-10 text-center text-sm text-[#5A6355]">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
            No receipts match.
          </div>
        ) : (
          filtered.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => openEdit(r)}
              className="w-full text-left rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 space-y-2 hover:border-[#C29474] transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-[#3D3730]">{r.guestName}</p>
                  <p className="text-xs text-[#5A6355]">
                    {r.siteLabel} · {r.rentalType === 'daily' ? 'Overnight' : 'Weekly'}
                  </p>
                </div>
                <p className="font-serif font-semibold text-[#C29474]">{money(r.grandTotal)}</p>
              </div>
              <p className="text-xs text-[#5A6355]">
                {r.checkIn} → {r.checkOut} · {r.paymentMethod || '—'}
              </p>
              <p className="text-[11px] text-[#C29474] font-semibold flex items-center gap-1">
                <Pencil className="w-3 h-3" /> Tap to edit
              </p>
            </button>
          ))
        )}
      </div>

      <div className="hidden md:block overflow-x-auto rounded-2xl border border-[#E2D9D0]">
        <table className="w-full text-left text-xs min-w-[900px]">
          <thead className="bg-[#FBF9F7] text-[#5A6355] uppercase tracking-wider text-[10px]">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Receipt</th>
              <th className="px-3 py-2.5 font-semibold">Guest</th>
              <th className="px-3 py-2.5 font-semibold">Site</th>
              <th className="px-3 py-2.5 font-semibold">Type</th>
              <th className="px-3 py-2.5 font-semibold">Stay</th>
              <th className="px-3 py-2.5 font-semibold text-right">Rent</th>
              <th className="px-3 py-2.5 font-semibold text-right">Tax</th>
              <th className="px-3 py-2.5 font-semibold text-right">Total</th>
              <th className="px-3 py-2.5 font-semibold">Paid</th>
              <th className="px-3 py-2.5 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EBE6]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-[#5A6355]">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  {receipts.length === 0
                    ? `No overnight or weekly guest receipts for ${year} yet.`
                    : 'No receipts match your search.'}
                  <span className="block mt-1 text-[11px]">
                    Click <strong>Add receipt</strong> or clear the search box.
                  </span>
                </td>
              </tr>
            ) : (
              filtered.map(r => (
                <tr
                  key={r.id}
                  onClick={() => openEdit(r)}
                  className="hover:bg-[#FBF9F7] cursor-pointer group"
                  title="Click to edit"
                >
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="font-medium text-[#3D3730]">{r.receiptNumber || '—'}</span>
                    <span className="block text-[10px] text-[#A8B2A6]">{r.bookedAt}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-[#3D3730]">{r.guestName}</span>
                    {r.guestEmail && (
                      <span className="block text-[10px] text-[#5A6355] truncate max-w-[140px]">
                        {r.guestEmail}
                      </span>
                    )}
                    {r.guestPhone && (
                      <span className="block text-[10px] text-[#5A6355]">{r.guestPhone}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[#5A6355]">{r.siteLabel}</td>
                  <td className="px-3 py-2.5 capitalize">
                    {r.rentalType === 'daily' ? 'Overnight' : 'Weekly'}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-[#5A6355]">
                    {r.checkIn} → {r.checkOut}
                    <span className="block">
                      {r.nights} night{r.nights === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">{money(r.rentSubtotal)}</td>
                  <td className="px-3 py-2.5 text-right text-[#5A6355]">{money(r.totalTax)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-[#C29474]">
                    {money(r.grandTotal)}
                  </td>
                  <td className="px-3 py-2.5 text-[#5A6355]">
                    {r.paymentMethod || '—'}
                    <span className="block text-[9px] text-[#A8B2A6]">{r.status}</span>
                  </td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E2D9D0] text-[#5A6355] hover:bg-white text-[11px] font-semibold"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(r)}
                        className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[#5A6355] leading-relaxed">
        <strong className="text-[#3D3730]">Tip:</strong> Click any row to edit. Rent + tax auto-add
        to the grand total. Monthly tenant receipts stay on each tenant’s payment / receipt page.
      </p>

      {/* Full-screen editor modal */}
      {form && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="receipt-edit-title"
          onClick={() => !saving && setForm(null)}
        >
          <div
            className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-t-[28px] sm:rounded-[28px] border border-[#E2D9D0] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 bg-white border-b border-[#E2D9D0] px-5 py-4 flex items-center justify-between gap-3 rounded-t-[28px]">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">
                  {form.id ? 'Edit receipt' : 'New receipt'}
                </p>
                <h4 id="receipt-edit-title" className="text-base font-serif text-[#3D3730]">
                  {form.guestName.trim() || 'Guest receipt'}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => !saving && setForm(null)}
                className="p-2 rounded-xl hover:bg-[#FBF9F7] text-[#5A6355]"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {error && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Guest name *">
                  <input
                    ref={guestNameRef}
                    value={form.guestName}
                    onChange={e => setField('guestName', e.target.value)}
                    className={inputCls}
                    placeholder="Full name"
                  />
                </Field>
                <Field label="Site *">
                  <input
                    value={form.siteLabel}
                    onChange={e => setField('siteLabel', e.target.value)}
                    placeholder="e.g. Site 12"
                    className={inputCls}
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={form.guestEmail}
                    onChange={e => setField('guestEmail', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    value={form.guestPhone}
                    onChange={e => setField('guestPhone', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Stay type">
                  <select
                    value={form.rentalType}
                    onChange={e => setField('rentalType', e.target.value as 'daily' | 'weekly')}
                    className={inputCls}
                  >
                    <option value="daily">Daily / overnight</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </Field>
                <Field label="Payment method">
                  <input
                    list="receipt-payment-methods"
                    value={form.paymentMethod}
                    onChange={e => setField('paymentMethod', e.target.value)}
                    className={inputCls}
                    placeholder="Cash, Card, etc."
                  />
                  <datalist id="receipt-payment-methods">
                    {PAYMENT_PRESETS.map(m => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Booked date">
                  <input
                    type="date"
                    value={form.bookedAt}
                    onChange={e => setField('bookedAt', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Check-in *">
                  <input
                    type="date"
                    value={form.checkIn}
                    onChange={e => setField('checkIn', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Check-out *">
                  <input
                    type="date"
                    value={form.checkOut}
                    onChange={e => setField('checkOut', e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[#3D3730]">Amounts</p>
                  <button
                    type="button"
                    onClick={applyTaxFromRent}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[#5A6355] hover:text-[#3D3730]"
                    title="Recalculate total from rent + tax"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    Update total
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Field label="Rent ($)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.rentSubtotal}
                      onChange={e => setField('rentSubtotal', e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="State tax ($)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.stateTax}
                      onChange={e => setField('stateTax', e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="County tax ($)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.countyTax}
                      onChange={e => setField('countyTax', e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Grand total ($)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.grandTotal}
                      onChange={e => setField('grandTotal', e.target.value)}
                      className={`${inputCls} font-semibold text-[#C29474]`}
                    />
                  </Field>
                </div>
                <p className="text-[11px] text-[#5A6355]">
                  Changing rent or tax updates the total automatically. You can still override the
                  total if needed.
                </p>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-[#E2D9D0] px-5 py-4 flex flex-wrap gap-2 rounded-b-[28px]">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save receipt'}
              </button>
              <button
                type="button"
                onClick={() => setForm(null)}
                disabled={saving}
                className="px-4 py-3 rounded-xl text-sm font-semibold border border-[#E2D9D0] text-[#5A6355] hover:bg-[#FBF9F7]"
              >
                Cancel
              </button>
              {form.id && (
                <button
                  type="button"
                  onClick={() => {
                    const r = receipts.find(x => x.id === form.id);
                    if (r) handleDelete(r);
                  }}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold border border-red-200 text-red-700 hover:bg-red-50 ml-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">{label}</label>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
  wide = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] px-4 py-3 ${
        wide ? 'col-span-2 lg:col-span-1' : ''
      }`}
    >
      <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">{label}</p>
      <p
        className={`text-lg font-serif font-semibold mt-1 ${
          accent ? 'text-[#C29474]' : 'text-[#3D3730]'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
