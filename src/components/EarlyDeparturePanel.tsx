import { useMemo, useState } from 'react';
import { Calendar, Gauge, DollarSign, Loader2, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../lib/api';

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export interface EarlyDepartureBreakdown {
  departureDate: string;
  rentalType: string;
  rentBefore: number;
  rentAfter: number;
  unusedRent: number;
  meterReading: number;
  previousReading: number;
  kwhUsage: number;
  electricCharge: number;
  kwhRate: number;
  balanceDue: number;
  refundOwed: number;
  closingBill: number;
  periodPaid: number;
}

interface EarlyDeparturePanelProps {
  tenantId: string;
  tenantName?: string;
  defaultPreviousReading?: number;
  defaultDepartureDate?: string;
  compact?: boolean;
  onApplied?: () => void;
}

export function EarlyDeparturePanel({
  tenantId,
  tenantName,
  defaultPreviousReading = 0,
  defaultDepartureDate,
  compact = false,
  onApplied,
}: EarlyDeparturePanelProps) {
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [departureDate, setDepartureDate] = useState(defaultDepartureDate || today);
  const [meterReading, setMeterReading] = useState('');
  const [previousReading, setPreviousReading] = useState(String(defaultPreviousReading || 0));
  const [note, setNote] = useState('');
  const [issueRefund, setIssueRefund] = useState(false);
  const [refundMethod, setRefundMethod] = useState('Refund');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [breakdown, setBreakdown] = useState<EarlyDepartureBreakdown | null>(null);

  const run = async (preview: boolean) => {
    setError('');
    setSuccess('');
    const reading = parseFloat(meterReading);
    if (!departureDate) {
      setError('Choose a departure date.');
      return;
    }
    if (Number.isNaN(reading) || reading < 0) {
      setError('Enter a valid final meter reading.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(`/api/tenants/${tenantId}/payments/early-departure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departureDate,
          meterReading: reading,
          previousReading: parseFloat(previousReading) || 0,
          note: note.trim() || undefined,
          issueRefund: preview ? false : issueRefund,
          refundMethod,
          preview,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Early departure failed');
        return;
      }
      setBreakdown(data.breakdown as EarlyDepartureBreakdown);
      if (!preview) {
        const b = data.breakdown as EarlyDepartureBreakdown;
        const parts = [
          `Closing applied for ${tenantName || 'tenant'}.`,
          b.closingBill > 0.009 ? `Closing bill: ${formatCurrency(b.closingBill)}.` : null,
          data.refundRecorded
            ? `Refund recorded: ${formatCurrency(b.unusedRent || b.refundOwed)}.`
            : b.refundOwed > 0.009
              ? `Refund owed (not yet recorded): ${formatCurrency(b.refundOwed)}.`
              : null,
        ].filter(Boolean);
        setSuccess(parts.join(' '));
        onApplied?.();
      }
    } catch {
      setError('Network error — could not run early departure.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`rounded-[24px] border-2 border-[#C29474] bg-white shadow-sm ${
        compact ? 'p-4 space-y-3' : 'p-6 space-y-4'
      }`}
    >
      <div>
        <h3 className="text-sm font-serif text-[#3D3730] flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#C29474]" />
          Early departure — closing bill / refund
        </h3>
        <p className="text-xs text-[#5A6355] mt-1">
          Enter the leave date and final meter reading. Rent is prorated through that day; unused rent
          creates a refund if they already paid; electric usage is billed from the new reading.
        </p>
      </div>

      <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Departure date</label>
          <input
            type="date"
            value={departureDate}
            onChange={e => setDepartureDate(e.target.value)}
            className="w-full px-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355] flex items-center gap-1">
            <Gauge className="w-3 h-3" /> Previous reading
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={previousReading}
            onChange={e => setPreviousReading(e.target.value)}
            className="w-full px-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355] flex items-center gap-1">
            <Gauge className="w-3 h-3" /> Final meter reading
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={meterReading}
            onChange={e => setMeterReading(e.target.value)}
            placeholder="Required"
            className="w-full px-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Note</label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional"
            className="w-full px-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-[#3D3730] cursor-pointer">
        <input
          type="checkbox"
          checked={issueRefund}
          onChange={e => setIssueRefund(e.target.checked)}
          className="rounded border-[#E2D9D0]"
        />
        Record cash/card refund if overpaid after closing
        {issueRefund && (
          <select
            value={refundMethod}
            onChange={e => setRefundMethod(e.target.value)}
            className="ml-2 px-2 py-1 bg-[#FBF9F7] border border-[#E2D9D0] rounded-lg text-xs"
          >
            <option value="Refund">Refund</option>
            <option value="Refund — Cash">Refund — Cash</option>
            <option value="Refund — Card">Refund — Card</option>
            <option value="Refund — Check">Refund — Check</option>
          </select>
        )}
      </label>

      {breakdown && (
        <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 space-y-2 text-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#5A6355] font-semibold">Closing preview</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[#3D3730]">
            <div>
              <p className="text-[10px] text-[#5A6355]">Rent before</p>
              <p className="font-medium">{formatCurrency(breakdown.rentBefore)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#5A6355]">Rent through departure</p>
              <p className="font-medium">{formatCurrency(breakdown.rentAfter)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#5A6355]">Unused rent</p>
              <p className="font-medium text-[#3D5A3D]">−{formatCurrency(breakdown.unusedRent)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#5A6355]">kWh used</p>
              <p className="font-medium">
                {breakdown.kwhUsage.toFixed(1)} × ${breakdown.kwhRate.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#5A6355]">Electric</p>
              <p className="font-medium">{formatCurrency(breakdown.electricCharge)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#5A6355]">Paid this period</p>
              <p className="font-medium">{formatCurrency(breakdown.periodPaid)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 pt-2 border-t border-[#E2D9D0]">
            {breakdown.closingBill > 0.009 ? (
              <p className="flex items-center gap-1.5 font-semibold text-[#6B4A32]">
                <DollarSign className="w-4 h-4" />
                Closing bill due: {formatCurrency(breakdown.closingBill)}
              </p>
            ) : breakdown.refundOwed > 0.009 ? (
              <p className="flex items-center gap-1.5 font-semibold text-[#3D5A3D]">
                <DollarSign className="w-4 h-4" />
                Refund owed: {formatCurrency(breakdown.refundOwed)}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 font-semibold text-[#3D5A3D]">
                <CheckCircle2 className="w-4 h-4" />
                Settled — no closing bill or refund
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
      )}
      {success && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2">
          {success}
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() => run(true)}
          disabled={loading || !meterReading}
          className="flex-1 flex items-center justify-center gap-2 bg-white border border-[#E2D9D0] text-[#3D3730] px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] transition disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
          Preview closing
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              !window.confirm(
                `Apply early departure for ${tenantName || 'this tenant'} on ${departureDate}?\n\n` +
                  `Final meter: ${meterReading}\n` +
                  'This sets the end date, saves the meter reading, and adjusts rent.'
              )
            ) {
              return;
            }
            run(false);
          }}
          disabled={loading || !meterReading}
          className="flex-1 flex items-center justify-center gap-2 bg-[#C29474] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Apply closing
        </button>
      </div>
    </div>
  );
}
