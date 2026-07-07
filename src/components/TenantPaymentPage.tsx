import { useEffect, useState } from 'react';
import {
  ArrowLeft, DollarSign, Calendar, CreditCard, Plus, CheckCircle2, Receipt, Gauge
} from 'lucide-react';
import { Tenant, TenantPayment } from '../../types';
import { dailyRateLabel, formatDailyRateDescription, rentAmountForType } from '../../rentUtils';
import { ReceiptLink } from './ReceiptLink';

interface TenantPaymentPageProps {
  tenant: Tenant;
  onBack: () => void;
}

const PAYMENT_METHODS = ['Cash', 'Check', 'Card', 'Venmo', 'Zelle', 'Bank Transfer'];
const KWH_RATE = 0.24;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function TenantPaymentPage({ tenant, onBack }: TenantPaymentPageProps) {
  const [payment, setPayment] = useState<TenantPayment | null>(null);
  const [rentAmount, setRentAmount] = useState('0');
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
  const [saving, setSaving] = useState(false);

  const loadPayment = async () => {
    const res = await fetch(`/api/tenants/${tenant.id}/payments`);
    if (res.ok) {
      const data: TenantPayment = await res.json();
      setPayment(data);
      const rentalType = data.rentalType ?? tenant.rentalType;
      const resolvedRent = rentalType === 'daily'
        ? rentAmountForType('daily')
        : (data.rentAmount ?? 0);
      setRentAmount(String(resolvedRent));
      if (rentalType === 'daily' && resolvedRent !== data.rentAmount) {
        await fetch(`/api/tenants/${tenant.id}/payments`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rentAmount: resolvedRent }),
        });
      }
      setCurrentReadingTotal(String(data.currentReadingTotal));
      setBaselineCredit(String(data.baselineCredit ?? 0));
      const autoPrevious = data.meterRecords?.[0]?.reading ?? data.previousMeterReading ?? 0;
      setPreviousMeterReading(String(autoPrevious));
    }
  };

  useEffect(() => {
    loadPayment();
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
  const rent = parseFloat(rentAmount) || 0;
  const balanceDue = rent + netElectricCharge;
  const rentalType = payment?.rentalType ?? tenant.rentalType;

  const handleSaveRates = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/payments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentAmount: parseFloat(rentAmount) || 0,
          currentReadingTotal: parseFloat(currentReadingTotal) || 0,
          baselineCredit: parseFloat(baselineCredit) || 0,
          balanceDue: rent + netElectricCharge,
          previousMeterReading: parseFloat(previousMeterReading) || 0,
        }),
      });
      if (res.ok) {
        await loadPayment();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddMeter = async () => {
    const reading = parseFloat(meterReading);
    if (Number.isNaN(reading) || reading < 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/payments/meter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: meterDate,
          reading,
          note: meterNote,
        }),
      });
      if (res.ok) {
        await loadPayment();
        setMeterReading('');
        setMeterNote('');
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
        await loadPayment();
        setNewAmount('');
        setNewNote('');
      }
    } finally {
      setSaving(false);
    }
  };

  const totalPaid = payment?.records.reduce((sum, r) => sum + r.amount, 0) ?? 0;
  const isCurrent = balanceDue <= 0;
  const latestMeter = payment?.meterRecords?.[0];
  const effectivePreviousReading = parseFloat(previousMeterReading) || latestMeter?.reading || payment?.previousMeterReading || 0;

  const handleMeterReadingBlur = async () => {
    if (!meterReading) return;
    await handleSaveRates();
  };

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
          <ReceiptLink spaceNumber={tenant.site} />
          <span className={`px-4 py-2 rounded-xl text-sm font-semibold ${
            isCurrent
              ? 'bg-[#E8F0E8] text-[#3D5A3D] border border-[#A8B2A6]'
              : 'bg-[#F5E6DC] text-[#6B4A32] border border-[#C29474]'
          }`}>
            {isCurrent ? 'Paid Up' : 'Balance Due'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-[24px] border border-[#E2D9D0] p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] mb-2">
            <DollarSign className="w-3.5 h-3.5" />
            Rent Due
          </div>
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
          {rentalType === 'daily' && (
            <p className="text-xs text-[#5A6355] mt-2">
              Daily: {formatDailyRateDescription()} · Today ({dailyRateLabel()}): {formatCurrency(rentAmountForType('daily'))}
            </p>
          )}
        </div>
        <div className="bg-white rounded-[24px] border border-[#E2D9D0] p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] mb-2">
            <Receipt className="w-3.5 h-3.5" />
            Balance Due
          </div>
          <p className={`text-2xl font-serif ${isCurrent ? 'text-[#3D5A3D]' : 'text-[#C29474]'}`}>
            {formatCurrency(balanceDue)}
          </p>
        </div>
        <div className="bg-white rounded-[24px] border border-[#E2D9D0] p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] mb-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Total Paid
          </div>
          <p className="text-2xl font-serif text-[#3D3730]">{formatCurrency(totalPaid)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
          <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Utilities</h3>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-[#5A6355]">Previous Meter Reading (kWh)</label>
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
                ? 'Auto-filled from the last meter record when billing is opened.'
                : 'Baseline reading used for usage when no meter history exists.'}
            </p>
          </div>

          <div className="pt-4 border-t border-[#E2D9D0] space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-serif text-[#3D3730]">Meter Record</h4>
              <span className="text-xs text-[#5A6355]">
                Previous: {effectivePreviousReading.toLocaleString()} kWh
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Reading (kWh)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={meterReading}
                  onChange={e => setMeterReading(e.target.value)}
                  onBlur={handleMeterReadingBlur}
                  placeholder="0"
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">Total (kWh)</label>
                <div className="w-full px-4 py-3 bg-[#EDE7E1] border border-[#E2D9D0] rounded-2xl text-sm font-medium text-[#3D3730]">
                  {(parseFloat(currentReadingTotal) || 0).toLocaleString()}
                </div>
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
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Balance Due — Rent + Utilities</label>
              <div className="w-full px-4 py-3 bg-[#EDE7E1] border border-[#E2D9D0] rounded-2xl text-sm font-medium text-[#3D3730]">
                {formatCurrency(balanceDue)}
              </div>
              <p className="text-xs text-[#5A6355]">
                {formatCurrency(rent)} rent due + {formatCurrency(netElectricCharge)} utilities = {formatCurrency(balanceDue)}
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
            <button
              onClick={handleAddMeter}
              disabled={saving || !meterReading}
              className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50 w-full justify-center"
            >
              <Gauge className="w-4 h-4" />
              Add Meter Record
            </button>
            {payment?.meterRecords?.length ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {payment.meterRecords.map(record => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 bg-[#FBF9F7] rounded-2xl border border-[#E2D9D0]"
                  >
                    <div>
                      <p className="text-sm font-medium text-[#3D3730]">
                        {record.reading.toLocaleString()} kWh
                      </p>
                      <p className="text-xs text-[#5A6355]">
                        {record.date} · {record.previousReading.toLocaleString()} → {record.reading.toLocaleString()} · {record.usage.toLocaleString()} kWh used
                      </p>
                    </div>
                    {record.note && (
                      <p className="text-xs text-[#5A6355] italic">{record.note}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#5A6355] text-center py-2">No meter readings yet.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
          <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Record Payment</h3>
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

      <div className="bg-white rounded-[32px] border border-[#E2D9D0] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2D9D0]">
          <h3 className="text-sm font-serif text-[#3D3730]">Payment History</h3>
        </div>
        {payment?.records.length ? (
          <div className="divide-y divide-[#E2D9D0]">
            {payment.records.map(record => (
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
                {record.note && (
                  <p className="text-xs text-[#5A6355] italic">{record.note}</p>
                )}
              </div>
            ))}
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