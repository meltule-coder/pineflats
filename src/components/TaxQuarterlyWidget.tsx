import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';

type TaxEntry = {
  id: string;
  bookedAt: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rentalType: 'daily' | 'weekly' | 'monthly';
  guestName: string;
  siteLabel: string;
  paymentMethod?: string;
  rentSubtotal: number;
  stateTaxPercent: number;
  countyTaxPercent: number;
  stateTax: number;
  countyTax: number;
  totalTax: number;
  grandTotal: number;
  status: 'paid' | 'estimated';
};

type QuarterlyReport = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  label: string;
  startDate: string;
  endDate: string;
  taxRates: {
    stateTransientTaxPercent: number;
    countyTransientTaxPercent: number;
  };
  entries: TaxEntry[];
  summary: {
    bookingCount: number;
    dailyCount: number;
    weeklyCount: number;
    rentSubtotal: number;
    stateTax: number;
    countyTax: number;
    totalTax: number;
    grandTotal: number;
  };
};

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}

function currentQuarter(d = new Date()): 1 | 2 | 3 | 4 {
  return (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
}

export function TaxQuarterlyWidget() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(currentQuarter(now));
  const [years, setYears] = useState<number[]>([now.getFullYear(), now.getFullYear() - 1]);
  const [report, setReport] = useState<QuarterlyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [yRes, rRes] = await Promise.all([
        fetch('/api/tax/years', { credentials: 'include' }),
        fetch(`/api/tax/quarterly?year=${year}&quarter=${quarter}`, { credentials: 'include' }),
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
        setError(data.error || `Could not load tax report (${rRes.status})`);
        return;
      }
      setReport(await rRes.json());
    } catch {
      setError('Network error loading tax report.');
    } finally {
      setLoading(false);
    }
  }, [year, quarter]);

  useEffect(() => {
    load();
  }, [load]);

  // Reload when returning to Reports so cancelled reservations drop off immediately
  useEffect(() => {
    const onFocus = () => {
      void load();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const handleSync = async () => {
    setLoading(true);
    setSyncNote(null);
    setError(null);
    try {
      const res = await fetch('/api/tax/sync', { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not sync tax ledger');
        return;
      }
      const data = await res.json();
      setSyncNote(
        data.message ||
          (data.removed
            ? `Cleaned ${data.removed} row(s). Each paid stay is listed once.`
            : 'Tax summary shows each paid stay once (no estimated stays).')
      );
      await load();
    } catch {
      setError('Network error during sync.');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!report) return;
    const headers = [
      'Booked',
      'Guest',
      'Site',
      'Type',
      'Check-in',
      'Check-out',
      'Nights',
      'Rent',
      'State tax %',
      'State tax $',
      'County tax %',
      'County tax $',
      'Total tax',
      'Grand total',
      'Payment',
      'Status',
    ];
    const rows = report.entries.map(e => [
      e.bookedAt,
      e.guestName,
      e.siteLabel,
      e.rentalType,
      e.checkIn,
      e.checkOut,
      e.nights,
      e.rentSubtotal.toFixed(2),
      e.stateTaxPercent,
      e.stateTax.toFixed(2),
      e.countyTaxPercent,
      e.countyTax.toFixed(2),
      e.totalTax.toFixed(2),
      e.grandTotal.toFixed(2),
      e.paymentMethod || '',
      e.status,
    ]);
    const summary = [
      [],
      ['SUMMARY', report.label],
      ['Bookings', report.summary.bookingCount],
      ['Daily stays', report.summary.dailyCount],
      ['Weekly stays', report.summary.weeklyCount],
      ['Rent subtotal', report.summary.rentSubtotal.toFixed(2)],
      ['State tax', report.summary.stateTax.toFixed(2)],
      ['County tax', report.summary.countyTax.toFixed(2)],
      ['Total tax', report.summary.totalTax.toFixed(2)],
      ['Grand total', report.summary.grandTotal.toFixed(2)],
      [
        'Current tax rates',
        `State ${report.taxRates.stateTransientTaxPercent}% / County ${report.taxRates.countyTransientTaxPercent}%`,
      ],
    ];
    const csv = [headers, ...rows, ...summary]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pineflats-tax-${report.year}-Q${report.quarter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">Tax summary — quarterly reports</h3>
            <p className="text-xs text-[#5A6355] mt-1 max-w-2xl">
              Transient lodging tax on <strong>booked</strong> <strong>daily</strong> and{' '}
              <strong>weekly</strong> stays only (state + county). Estimated / open site holds are not
              included. Paid website and phone bookings appear automatically. Cancelled reservations
              and deleted receipts drop off this summary.
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
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Quarter</label>
          <select
            value={quarter}
            onChange={e => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}
            className="block px-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          >
            <option value={1}>Q1 · Jan–Mar</option>
            <option value={2}>Q2 · Apr–Jun</option>
            <option value={3}>Q3 · Jul–Sep</option>
            <option value={4}>Q4 · Oct–Dec</option>
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
          onClick={handleSync}
          disabled={loading}
          className="flex items-center gap-2 border border-[#E2D9D0] text-[#5A6355] bg-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] disabled:opacity-50"
        >
          Clean estimates
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!report || report.entries.length === 0}
          className="flex items-center gap-2 border border-[#E2D9D0] text-[#5A6355] bg-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
      )}
      {syncNote && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2">
          {syncNote}
        </p>
      )}

      {report && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A6355]">
            <p>
              <strong className="text-[#3D3730]">{report.label}</strong>
              {' · '}
              {report.startDate} → {report.endDate}
            </p>
            <p>
              Tax rates on file: state{' '}
              <strong>{report.taxRates.stateTransientTaxPercent}%</strong>
              {' · '}
              county <strong>{report.taxRates.countyTransientTaxPercent}%</strong>
              {' '}
              <span className="text-[#A8B2A6]">(set under Properties)</span>
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label="Bookings" value={String(report.summary.bookingCount)} />
            <SummaryCard label="Rent (before tax)" value={money(report.summary.rentSubtotal)} />
            <SummaryCard label="State tax" value={money(report.summary.stateTax)} accent />
            <SummaryCard label="County tax" value={money(report.summary.countyTax)} accent />
            <SummaryCard label="Total tax" value={money(report.summary.totalTax)} wide />
            <SummaryCard label="Grand total collected" value={money(report.summary.grandTotal)} wide />
            <SummaryCard
              label="Daily / weekly stays"
              value={`${report.summary.dailyCount} / ${report.summary.weeklyCount}`}
              wide
            />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#E2D9D0]">
            <table className="w-full text-left text-xs min-w-[720px]">
              <thead className="bg-[#FBF9F7] text-[#5A6355] uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Booked</th>
                  <th className="px-3 py-2.5 font-semibold">Guest / Site</th>
                  <th className="px-3 py-2.5 font-semibold">Type</th>
                  <th className="px-3 py-2.5 font-semibold">Stay</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Rent</th>
                  <th className="px-3 py-2.5 font-semibold text-right">State</th>
                  <th className="px-3 py-2.5 font-semibold text-right">County</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EBE6]">
                {report.entries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-[#5A6355]">
                      No paid daily/weekly bookings recorded for this quarter yet.
                      Only completed bookings (website, phone, or saved guest receipts) appear here —
                      not estimated site holds.
                    </td>
                  </tr>
                ) : (
                  report.entries.map(e => (
                    <tr key={e.id} className="hover:bg-[#FBF9F7]/80">
                      <td className="px-3 py-2.5 whitespace-nowrap text-[#5A6355]">
                        {e.bookedAt}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-[#3D3730]">{e.guestName}</span>
                        <span className="block text-[#5A6355]">{e.siteLabel}</span>
                      </td>
                      <td className="px-3 py-2.5 capitalize">{e.rentalType}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-[#5A6355]">
                        {e.checkIn} → {e.checkOut}
                        <span className="block">{e.nights} night{e.nights === 1 ? '' : 's'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{money(e.rentSubtotal)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {money(e.stateTax)}
                        <span className="block text-[9px] text-[#A8B2A6]">{e.stateTaxPercent}%</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {money(e.countyTax)}
                        <span className="block text-[9px] text-[#A8B2A6]">{e.countyTaxPercent}%</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[#3D3730]">
                        {money(e.grandTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
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
      <p className={`text-lg font-serif font-semibold mt-1 ${accent ? 'text-[#C29474]' : 'text-[#3D3730]'}`}>
        {value}
      </p>
    </div>
  );
}
