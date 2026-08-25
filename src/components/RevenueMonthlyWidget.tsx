import { Fragment, useCallback, useEffect, useState } from 'react';
import { DollarSign, Download, RefreshCw } from 'lucide-react';

type Receipt = {
  id: string;
  date: string;
  amount: number;
  source: 'tenant_payment' | 'booking_receipt' | 'tax_ledger';
  label: string;
  guestName?: string;
  site?: string;
  method?: string;
};

type MonthRow = {
  month: string;
  label: string;
  totalRevenue: number;
  receiptCount: number;
  tenantPayments: number;
  tenantPaymentCount: number;
  bookingReceipts: number;
  bookingReceiptCount: number;
  taxLedgerStays: number;
  taxLedgerCount: number;
  receipts: Receipt[];
};

type YearReport = {
  year: number;
  months: MonthRow[];
  summary: {
    totalRevenue: number;
    receiptCount: number;
    tenantPayments: number;
    tenantPaymentCount: number;
    bookingReceipts: number;
    bookingReceiptCount: number;
    taxLedgerStays: number;
    taxLedgerCount: number;
  };
  byTenant: Array<{
    tenantId: string;
    name: string;
    site?: string;
    totalPaid: number;
  }>;
  allReceipts: Receipt[];
};

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}

function sourceLabel(s: Receipt['source']) {
  if (s === 'tenant_payment') return 'Tenant receipt';
  if (s === 'booking_receipt') return 'Booking receipt';
  return 'Stay ledger';
}

export function RevenueMonthlyWidget() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [years, setYears] = useState<number[]>([now.getFullYear(), now.getFullYear() - 1]);
  const [report, setReport] = useState<YearReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmptyMonths, setShowEmptyMonths] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [yRes, rRes] = await Promise.all([
        fetch('/api/revenue/years', { credentials: 'include' }),
        fetch(`/api/revenue/monthly?year=${year}`, { credentials: 'include' }),
      ]);
      if (yRes.status === 401 || rRes.status === 401) {
        setError('Admin session expired. Sign in again.');
        return;
      }
      if (yRes.ok) {
        const yData = await yRes.json();
        if (Array.isArray(yData.years) && yData.years.length) setYears(yData.years);
      }
      if (!rRes.ok) {
        const data = await rRes.json().catch(() => ({}));
        setError(data.error || `Could not load revenue report (${rRes.status})`);
        return;
      }
      setReport(await rRes.json());
    } catch {
      setError('Network error loading revenue report.');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleMonths =
    report?.months.filter(m => showEmptyMonths || m.totalRevenue > 0) ?? [];

  const maxRev = Math.max(1, ...(report?.months.map(m => m.totalRevenue) ?? [1]));

  const exportCsv = () => {
    if (!report) return;
    const headers = [
      'Date',
      'Source',
      'Guest',
      'Site',
      'Label',
      'Method',
      'Amount',
      'Month',
    ];
    const rows = report.allReceipts.map(r => [
      r.date,
      sourceLabel(r.source),
      r.guestName || '',
      r.site || '',
      r.label,
      r.method || '',
      r.amount.toFixed(2),
      r.date.slice(0, 7),
    ]);
    const summary = [
      [],
      ['YEAR SUMMARY', String(report.year)],
      ['All receipts total', report.summary.totalRevenue.toFixed(2)],
      ['Receipt count', report.summary.receiptCount],
      ['Tenant payment receipts', report.summary.tenantPayments.toFixed(2)],
      ['Booking receipts', report.summary.bookingReceipts.toFixed(2)],
      ['Tax ledger stays (extra)', report.summary.taxLedgerStays.toFixed(2)],
    ];
    const csv = [headers, ...rows, ...summary]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pineflats-revenue-receipts-${report.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">Revenue by month</h3>
            <p className="text-xs text-[#5A6355] mt-1 max-w-2xl">
              Built from <strong>all receipts</strong>: tenant payment receipts, website booking
              receipts, and taxable daily/weekly stays (when not already on a booking receipt).
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
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Load report
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!report || report.summary.receiptCount === 0}
          className="flex items-center gap-2 border border-[#E2D9D0] text-[#5A6355] bg-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          Export all receipts CSV
        </button>
        <label className="flex items-center gap-2 text-xs text-[#5A6355] cursor-pointer select-none pb-2.5">
          <input
            type="checkbox"
            checked={showEmptyMonths}
            onChange={e => setShowEmptyMonths(e.target.checked)}
            className="rounded border-[#E2D9D0]"
          />
          Show empty months
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
      )}

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Year total (all receipts)" value={money(report.summary.totalRevenue)} accent />
            <Stat label="Receipt count" value={String(report.summary.receiptCount)} />
            <Stat
              label="Tenant payment receipts"
              value={`${money(report.summary.tenantPayments)} (${report.summary.tenantPaymentCount})`}
            />
            <Stat
              label="Booking receipts"
              value={`${money(report.summary.bookingReceipts)} (${report.summary.bookingReceiptCount})`}
            />
          </div>

          <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-[#5A6355] mb-2">
              Total receipt revenue by month
            </p>
            {report.months.map(m => {
              if (!showEmptyMonths && m.totalRevenue <= 0) return null;
              const pct = Math.max(2, (m.totalRevenue / maxRev) * 100);
              return (
                <div key={m.month} className="flex items-center gap-3 text-xs">
                  <span className="w-24 shrink-0 text-[#5A6355] truncate" title={m.label}>
                    {m.label.replace(` ${report.year}`, '')}
                  </span>
                  <div className="flex-1 h-6 bg-white rounded-lg border border-[#E2D9D0] overflow-hidden">
                    <div
                      className="h-full bg-[#5A6355]/85 rounded-lg transition-all"
                      style={{ width: m.totalRevenue > 0 ? `${pct}%` : '0%' }}
                    />
                  </div>
                  <span className="w-20 text-right font-medium text-[#3D3730] tabular-nums">
                    {money(m.totalRevenue)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#E2D9D0]">
            <table className="w-full text-left text-xs min-w-[700px]">
              <thead className="bg-[#FBF9F7] text-[#5A6355] uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Month</th>
                  <th className="px-3 py-2.5 font-semibold text-right">All receipts</th>
                  <th className="px-3 py-2.5 font-semibold text-right">#</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Tenant</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Booking</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Other stays</th>
                  <th className="px-3 py-2.5 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EBE6]">
                {visibleMonths.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[#5A6355]">
                      No receipts for {report.year} yet.
                    </td>
                  </tr>
                ) : (
                  visibleMonths.map(m => (
                    <Fragment key={m.month}>
                      <tr className="hover:bg-[#FBF9F7]/80">
                        <td className="px-3 py-2.5 font-medium text-[#3D3730]">{m.label}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-[#C29474]">
                          {money(m.totalRevenue)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[#5A6355]">{m.receiptCount}</td>
                        <td className="px-3 py-2.5 text-right">{money(m.tenantPayments)}</td>
                        <td className="px-3 py-2.5 text-right">{money(m.bookingReceipts)}</td>
                        <td className="px-3 py-2.5 text-right">{money(m.taxLedgerStays)}</td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedMonth(expandedMonth === m.month ? null : m.month)
                            }
                            className="text-[11px] font-semibold text-[#5A6355] underline hover:text-[#3D3730]"
                          >
                            {expandedMonth === m.month ? 'Hide' : 'Show'} receipts
                          </button>
                        </td>
                      </tr>
                      {expandedMonth === m.month && (
                        <tr>
                          <td colSpan={7} className="px-3 py-3 bg-[#FBF9F7]">
                            <div className="space-y-1.5 max-h-56 overflow-y-auto">
                              {m.receipts.map(r => (
                                <div
                                  key={r.id}
                                  className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-white border border-[#E2D9D0] rounded-xl px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <span className="font-medium text-[#3D3730]">{r.date}</span>
                                    <span className="mx-1.5 text-[#A8B2A6]">·</span>
                                    <span className="text-[#5A6355]">{sourceLabel(r.source)}</span>
                                    {r.guestName && (
                                      <>
                                        <span className="mx-1.5 text-[#A8B2A6]">·</span>
                                        <span>{r.guestName}</span>
                                      </>
                                    )}
                                    {r.site && (
                                      <>
                                        <span className="mx-1.5 text-[#A8B2A6]">·</span>
                                        <span>{r.site}</span>
                                      </>
                                    )}
                                    {r.method && (
                                      <span className="text-[#A8B2A6]"> ({r.method})</span>
                                    )}
                                  </div>
                                  <span className="font-semibold text-[#3D3730] tabular-nums">
                                    {money(r.amount)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
              {visibleMonths.length > 0 && (
                <tfoot className="bg-[#FBF9F7] font-semibold text-[#3D3730]">
                  <tr>
                    <td className="px-3 py-2.5">Year total</td>
                    <td className="px-3 py-2.5 text-right text-[#C29474]">
                      {money(report.summary.totalRevenue)}
                    </td>
                    <td className="px-3 py-2.5 text-right">{report.summary.receiptCount}</td>
                    <td className="px-3 py-2.5 text-right">{money(report.summary.tenantPayments)}</td>
                    <td className="px-3 py-2.5 text-right">{money(report.summary.bookingReceipts)}</td>
                    <td className="px-3 py-2.5 text-right">{money(report.summary.taxLedgerStays)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {report.byTenant.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">
                Lifetime paid by tenant (from payment receipts)
              </p>
              <div className="overflow-x-auto rounded-2xl border border-[#E2D9D0] max-h-56 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FBF9F7] text-[#5A6355] uppercase tracking-wider text-[10px] sticky top-0">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Tenant</th>
                      <th className="px-3 py-2 font-semibold">Site</th>
                      <th className="px-3 py-2 font-semibold text-right">Total paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EBE6]">
                    {report.byTenant.slice(0, 50).map(t => (
                      <tr key={t.tenantId}>
                        <td className="px-3 py-2 font-medium text-[#3D3730]">{t.name}</td>
                        <td className="px-3 py-2 text-[#5A6355]">{t.site || '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold">{money(t.totalPaid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">{label}</p>
      <p className={`text-lg font-serif font-semibold mt-1 ${accent ? 'text-[#C29474]' : 'text-[#3D3730]'}`}>
        {value}
      </p>
    </div>
  );
}
