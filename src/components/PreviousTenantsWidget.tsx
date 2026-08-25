import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronUp,
  FileText,
  Mail,
  MapPin,
  Phone,
  Plus,
  Printer,
  Receipt,
  Save,
  Search,
  Trash2,
  User,
  X,
  DollarSign,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  PreviousTenantPaymentSnapshot,
  PreviousTenantRecord,
  RentalType,
} from '../../types';

function money(n?: number) {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatWhen(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDate(value?: string) {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
  }
  return value;
}

const emptyManual = {
  name: '',
  site: '',
  phone: '',
  email: '',
  address: '',
  rvType: '',
  licensePlate: '',
  emergencyContact: '',
  notes: '',
  startDate: '',
  endDate: '',
  rentalType: '' as '' | RentalType,
  archiveNote: '',
};

type DetailTab = 'profile' | 'payments';

/**
 * Searchable archive of former tenants (saved when removed, or entered manually).
 * Includes a full payment / receipt history view for later review.
 */
export function PreviousTenantsWidget() {
  const [list, setList] = useState<PreviousTenantRecord[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('profile');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyManual);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiFetch('/api/previous-tenants');
      if (res.ok) setList(await res.json());
    } catch {
      setError('Could not load previous tenants.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const t = r.tenant;
      const hay = [
        t.name,
        t.site,
        t.phone,
        t.email,
        t.address,
        t.rvType,
        t.licensePlate,
        t.notes,
        r.archiveNote,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [list, query]);

  const selected = selectedId ? list.find((r) => r.id === selectedId) ?? null : null;

  const openRecord = (id: string, tab: DetailTab = 'profile') => {
    setSelectedId(id);
    setDetailTab(tab);
    setError(null);
    setMessage(null);
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch('/api/previous-tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          rentalType: form.rentalType || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save');
        return;
      }
      setForm(emptyManual);
      setShowAdd(false);
      setMessage('Previous tenant saved.');
      await load();
      openRecord(data.id, 'profile');
    } catch {
      setError('Network error saving previous tenant.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (
      !confirm(
        `Permanently delete archived record for ${name}? This cannot be undone.`
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/previous-tenants/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not delete');
        return;
      }
      if (selectedId === id) setSelectedId(null);
      setMessage('Archived record deleted.');
      await load();
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  };

  const handlePrintHistory = () => {
    window.print();
  };

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-6 py-5 text-left hover:bg-[#FBF9F7] transition"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#FBF9F7] border border-[#E2D9D0] flex items-center justify-center shrink-0">
            <Archive className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-serif text-[#3D3730]">Previous tenants</h3>
            <p className="text-xs text-[#5A6355] mt-0.5">
              {list.length} stored · open payment history anytime for archived stays
            </p>
          </div>
        </div>
        {open ? (
          <ChevronUp className="w-5 h-5 text-[#5A6355] shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-[#5A6355] shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-4 border-t border-[#E2D9D0] pt-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5A6355]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, site, phone, plate…"
                className="w-full pl-9 pr-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setShowAdd((v) => !v);
                setError(null);
                setMessage(null);
              }}
              className="flex items-center justify-center gap-2 bg-[#5A6355] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition"
            >
              <Plus className="w-4 h-4" />
              Add previous tenant
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
          {message && (
            <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2">
              {message}
            </p>
          )}

          {showAdd && (
            <form
              onSubmit={handleAdd}
              className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 space-y-3 print:hidden"
            >
              <p className="text-xs text-[#5A6355]">
                Enter someone who already left (paper records, old guests). They will not take a site.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="Name *"
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  required
                />
                <Field
                  label="Site / space"
                  value={form.site}
                  onChange={(v) => setForm((f) => ({ ...f, site: v }))}
                />
                <Field
                  label="Phone"
                  value={form.phone}
                  onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                />
                <Field
                  label="Email"
                  value={form.email}
                  onChange={(v) => setForm((f) => ({ ...f, email: v }))}
                />
                <Field
                  label="Address"
                  value={form.address}
                  onChange={(v) => setForm((f) => ({ ...f, address: v }))}
                  className="sm:col-span-2"
                />
                <Field
                  label="RV / vehicle"
                  value={form.rvType}
                  onChange={(v) => setForm((f) => ({ ...f, rvType: v }))}
                />
                <Field
                  label="License plate"
                  value={form.licensePlate}
                  onChange={(v) => setForm((f) => ({ ...f, licensePlate: v }))}
                />
                <Field
                  label="Start date"
                  type="date"
                  value={form.startDate}
                  onChange={(v) => setForm((f) => ({ ...f, startDate: v }))}
                />
                <Field
                  label="End date"
                  type="date"
                  value={form.endDate}
                  onChange={(v) => setForm((f) => ({ ...f, endDate: v }))}
                />
                <Field
                  label="Emergency contact"
                  value={form.emergencyContact}
                  onChange={(v) => setForm((f) => ({ ...f, emergencyContact: v }))}
                  className="sm:col-span-2"
                />
                <Field
                  label="Notes"
                  value={form.notes}
                  onChange={(v) => setForm((f) => ({ ...f, notes: v }))}
                  className="sm:col-span-2"
                />
                <Field
                  label="Archive note"
                  value={form.archiveNote}
                  onChange={(v) => setForm((f) => ({ ...f, archiveNote: v }))}
                  className="sm:col-span-2"
                  placeholder="e.g. Left March 2025, paid in full"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading || !form.name.trim()}
                  className="flex items-center gap-2 bg-[#C29474] text-white px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {loading ? 'Saving…' : 'Save to archive'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium text-[#5A6355] border border-[#E2D9D0] bg-white"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1 print:hidden">
              {filtered.map((r) => {
                const payCount = r.payment?.records?.length ?? r.payment?.paymentCount ?? 0;
                const hasPay = !!r.payment && (payCount > 0 || (r.payment.totalPaid ?? 0) > 0);
                return (
                  <div
                    key={r.id}
                    className={`rounded-2xl border transition ${
                      selectedId === r.id
                        ? 'border-[#5A6355] bg-[#F0EBE6]'
                        : 'border-[#E2D9D0] bg-white hover:border-[#C29474]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openRecord(r.id, 'profile')}
                      className="w-full text-left px-4 pt-3 pb-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#3D3730]">{r.tenant.name}</p>
                          <p className="text-xs text-[#5A6355] mt-0.5">
                            Space {r.tenant.site}
                            {r.tenant.endDate ? ` · ended ${r.tenant.endDate}` : ''}
                          </p>
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-[#5A6355] bg-[#FBF9F7] border border-[#E2D9D0] px-2 py-0.5 rounded-full shrink-0">
                          {r.reason}
                        </span>
                      </div>
                      {(r.tenant.phone || r.tenant.email) && (
                        <p className="text-xs text-[#5A6355] mt-1 truncate">
                          {[r.tenant.phone, r.tenant.email].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {hasPay && (
                        <p className="text-xs text-[#6B4A32] mt-1.5 font-medium">
                          {money(r.payment?.totalPaid)} paid
                          {payCount > 0 ? ` · ${payCount} payment(s) on file` : ''}
                        </p>
                      )}
                    </button>
                    <div className="flex flex-wrap gap-2 px-4 pb-3">
                      <button
                        type="button"
                        onClick={() => openRecord(r.id, 'payments')}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#5A6355] text-white px-3 py-2 rounded-xl hover:bg-[#3D3730] transition"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        View receipt / payment history
                      </button>
                      <button
                        type="button"
                        onClick={() => openRecord(r.id, 'profile')}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold border border-[#E2D9D0] text-[#5A6355] bg-white px-3 py-2 rounded-xl hover:bg-[#FBF9F7] transition"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Profile
                      </button>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-center text-sm text-[#5A6355] py-10 border border-dashed border-[#E2D9D0] rounded-2xl">
                  {list.length === 0
                    ? 'No previous tenants yet. Remove a current tenant or add one manually.'
                    : 'No matches for that search.'}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 min-h-[200px] print:border-0 print:bg-white print:p-0">
              {!selected ? (
                <p className="text-sm text-[#5A6355] py-8 text-center print:hidden">
                  Select a previous tenant, or click <strong>View receipt / payment history</strong>.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2 print:hidden">
                    <div>
                      <h4 className="text-lg font-serif text-[#3D3730]">
                        {selected.tenant.name}
                      </h4>
                      <p className="text-xs text-[#5A6355] mt-1">
                        Archived {formatWhen(selected.archivedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="p-2 rounded-xl hover:bg-white text-[#5A6355]"
                      aria-label="Close detail"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 print:hidden">
                    <button
                      type="button"
                      onClick={() => setDetailTab('profile')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                        detailTab === 'profile'
                          ? 'bg-white border-[#5A6355] text-[#3D3730]'
                          : 'bg-transparent border-[#E2D9D0] text-[#5A6355]'
                      }`}
                    >
                      Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('payments')}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                        detailTab === 'payments'
                          ? 'bg-[#5A6355] border-[#5A6355] text-white'
                          : 'bg-transparent border-[#E2D9D0] text-[#5A6355]'
                      }`}
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      Receipt / payment history
                    </button>
                    {detailTab === 'payments' && (
                      <button
                        type="button"
                        onClick={handlePrintHistory}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-[#E2D9D0] bg-white text-[#5A6355] hover:bg-[#FBF9F7] ml-auto"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Print
                      </button>
                    )}
                  </div>

                  {detailTab === 'profile' ? (
                    <div className="space-y-3">
                      <DetailRow icon={User} label="Space" value={selected.tenant.site} />
                      <DetailRow icon={Phone} label="Phone" value={selected.tenant.phone} />
                      <DetailRow icon={Mail} label="Email" value={selected.tenant.email} />
                      <DetailRow icon={MapPin} label="Address" value={selected.tenant.address} />
                      <DetailRow label="RV / vehicle" value={selected.tenant.rvType} />
                      <DetailRow label="License plate" value={selected.tenant.licensePlate} />
                      <DetailRow label="Emergency" value={selected.tenant.emergencyContact} />
                      <DetailRow
                        label="Stay"
                        value={
                          [selected.tenant.startDate, selected.tenant.endDate]
                            .filter(Boolean)
                            .join(' → ') || undefined
                        }
                      />
                      <DetailRow label="Rental type" value={selected.tenant.rentalType} />
                      <DetailRow label="Notes" value={selected.tenant.notes} />
                      <DetailRow label="Archive note" value={selected.archiveNote} />

                      <button
                        type="button"
                        onClick={() => setDetailTab('payments')}
                        className="w-full flex items-center justify-center gap-2 bg-[#5A6355] text-white px-4 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition"
                      >
                        <Receipt className="w-4 h-4" />
                        View receipt / payment history
                      </button>

                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          handleDelete(selected.id, selected.tenant.name)
                        }
                        className="flex items-center gap-2 text-sm font-semibold text-red-700 border border-red-200 bg-white px-4 py-2.5 rounded-xl hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete permanently
                      </button>
                    </div>
                  ) : (
                    <PaymentHistoryPanel
                      name={selected.tenant.name}
                      site={selected.tenant.site}
                      stay={
                        [selected.tenant.startDate, selected.tenant.endDate]
                          .filter(Boolean)
                          .join(' → ') || undefined
                      }
                      archivedAt={selected.archivedAt}
                      payment={selected.payment}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentHistoryPanel({
  name,
  site,
  stay,
  archivedAt,
  payment,
}: {
  name: string;
  site?: string;
  stay?: string;
  archivedAt?: string;
  payment?: PreviousTenantPaymentSnapshot;
}) {
  const records = payment?.records ?? [];
  const charges = payment?.extraCharges ?? [];
  const credits = payment?.credits ?? [];
  const totalPaid = payment?.totalPaid ?? records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalCharges = charges.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const totalCredits = credits.reduce((s, c) => s + (Number(c.amount) || 0), 0);

  if (!payment && records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#E2D9D0] bg-white p-6 text-center space-y-2">
        <DollarSign className="w-8 h-8 text-[#5A6355] opacity-40 mx-auto" />
        <p className="text-sm font-medium text-[#3D3730]">No payment history on file</p>
        <p className="text-xs text-[#5A6355]">
          Payment snapshots are saved when you remove/checkout a current tenant.
          Manual archive entries usually have no payments unless you add them later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 print:space-y-3">
      <div className="rounded-xl border border-[#E2D9D0] bg-white p-4 space-y-1 print:border-black">
        <p className="text-[10px] uppercase tracking-widest text-[#5A6355] font-semibold">
          Archived payment history
        </p>
        <h5 className="text-lg font-serif text-[#3D3730]">{name}</h5>
        <p className="text-xs text-[#5A6355]">
          {site ? `Space ${site}` : 'Space —'}
          {stay ? ` · ${stay}` : ''}
        </p>
        {archivedAt && (
          <p className="text-xs text-[#5A6355]">Archived {formatWhen(archivedAt)}</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <SummaryChip label="Total paid" value={money(totalPaid)} emphasis />
        <SummaryChip label="Payments" value={String(records.length || payment?.paymentCount || 0)} />
        <SummaryChip
          label="Last rent"
          value={payment?.rentAmount != null ? money(payment.rentAmount) : '—'}
        />
      </div>

      {(payment?.billingPeriod || payment?.rentalType) && (
        <p className="text-xs text-[#5A6355]">
          {payment.rentalType ? (
            <span className="capitalize">Rental: {payment.rentalType}</span>
          ) : null}
          {payment.billingPeriod
            ? `${payment.rentalType ? ' · ' : ''}Period: ${payment.billingPeriod}`
            : null}
        </p>
      )}

      <section className="rounded-xl border border-[#E2D9D0] bg-white overflow-hidden">
        <header className="px-4 py-2.5 border-b border-[#E2D9D0] bg-[#FBF9F7] flex items-center gap-2">
          <Receipt className="w-4 h-4 text-[#5A6355]" />
          <h6 className="text-xs font-semibold uppercase tracking-widest text-[#5A6355]">
            Payments / receipts
          </h6>
        </header>
        {records.length === 0 ? (
          <p className="text-sm text-[#5A6355] px-4 py-4">No individual payment lines stored.</p>
        ) : (
          <ul className="divide-y divide-[#E2D9D0] max-h-72 overflow-y-auto print:max-h-none">
            {records.map((p) => (
              <li key={p.id} className="px-4 py-3 flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-[#3D3730]">{formatDate(p.date)}</p>
                  <p className="text-xs text-[#5A6355] mt-0.5">
                    {p.method || 'Payment'}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                <span className="font-semibold text-[#3D3730] shrink-0">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <footer className="px-4 py-2.5 border-t border-[#E2D9D0] flex justify-between text-sm font-semibold text-[#3D3730]">
          <span>Total paid</span>
          <span>{money(totalPaid)}</span>
        </footer>
      </section>

      {charges.length > 0 && (
        <section className="rounded-xl border border-[#E2D9D0] bg-white overflow-hidden">
          <header className="px-4 py-2.5 border-b border-[#E2D9D0] bg-[#FBF9F7]">
            <h6 className="text-xs font-semibold uppercase tracking-widest text-[#5A6355]">
              Extra charges
            </h6>
          </header>
          <ul className="divide-y divide-[#E2D9D0]">
            {charges.map((c) => (
              <li key={c.id} className="px-4 py-2.5 flex justify-between gap-3 text-sm">
                <div>
                  <p className="text-[#3D3730]">{c.description || 'Charge'}</p>
                  <p className="text-xs text-[#5A6355]">{formatDate(c.date)}{c.note ? ` · ${c.note}` : ''}</p>
                </div>
                <span className="font-medium">{money(c.amount)}</span>
              </li>
            ))}
          </ul>
          <footer className="px-4 py-2 border-t border-[#E2D9D0] flex justify-between text-xs font-semibold">
            <span>Charges total</span>
            <span>{money(totalCharges)}</span>
          </footer>
        </section>
      )}

      {credits.length > 0 && (
        <section className="rounded-xl border border-[#E2D9D0] bg-white overflow-hidden">
          <header className="px-4 py-2.5 border-b border-[#E2D9D0] bg-[#FBF9F7]">
            <h6 className="text-xs font-semibold uppercase tracking-widest text-[#5A6355]">
              Credits
            </h6>
          </header>
          <ul className="divide-y divide-[#E2D9D0]">
            {credits.map((c) => (
              <li key={c.id} className="px-4 py-2.5 flex justify-between gap-3 text-sm">
                <div>
                  <p className="text-[#3D3730]">{c.description || 'Credit'}</p>
                  <p className="text-xs text-[#5A6355]">{formatDate(c.date)}{c.note ? ` · ${c.note}` : ''}</p>
                </div>
                <span className="font-medium text-[#3D5A3D]">−{money(c.amount)}</span>
              </li>
            ))}
          </ul>
          <footer className="px-4 py-2 border-t border-[#E2D9D0] flex justify-between text-xs font-semibold">
            <span>Credits total</span>
            <span>−{money(totalCredits)}</span>
          </footer>
        </section>
      )}

      <p className="text-[11px] text-[#5A6355] print:hidden">
        This history is stored with the previous-tenant archive so you can look it up later.
        Use <strong>Print</strong> to save a paper or PDF copy.
      </p>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        emphasis
          ? 'border-[#C29474]/50 bg-[#FBF5F0]'
          : 'border-[#E2D9D0] bg-white'
      }`}
    >
      <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${emphasis ? 'text-[#6B4A32]' : 'text-[#3D3730]'}`}>
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = 'text',
  className = '',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  className?: string;
  placeholder?: string;
}) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-[10px] uppercase tracking-widest text-[#5A6355]">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
      />
    </label>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon?: typeof Phone;
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      {Icon ? <Icon className="w-4 h-4 text-[#5A6355] mt-0.5 shrink-0" /> : null}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">{label}</p>
        <p className="text-[#3D3730] whitespace-pre-wrap">{value}</p>
      </div>
    </div>
  );
}
