import { apiFetch } from '../lib/api';
import { useEffect, useMemo, useState } from 'react';
import { FileText, Printer, RefreshCw, Sparkles, Download } from 'lucide-react';
import { ParkContact, PaymentRecord, Tenant, TenantPayment } from '../../types';
import { DEFAULT_CONTACT } from '../../contactDefaults';
import { PaymentReceiptDocument, receiptNumber } from './PaymentReceiptDocument';
import { downloadReceiptPdf } from '../lib/downloadReceipt';

/**
 * Admin place to generate printable receipts.
 * Logo + business info always come from park contact settings.
 * Customer fields fill from the selected tenant; payment fills when a payment exists.
 */
export function ReceiptGeneratorWidget() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [park, setPark] = useState<ParkContact | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [payment, setPayment] = useState<TenantPayment | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

  const loadBase = async () => {
    try {
      const [tRes, cRes] = await Promise.all([
        apiFetch('/api/tenants'),
        apiFetch('/api/contact'),
      ]);
      if (tRes.ok) {
        const list: Tenant[] = await tRes.json();
        setTenants(
          [...list].sort((a, b) => Number(a.site) - Number(b.site) || a.name.localeCompare(b.name))
        );
      }
      if (cRes.ok) setPark({ ...DEFAULT_CONTACT, ...(await cRes.json()) });
      else setPark(DEFAULT_CONTACT);
    } catch {
      setError('Could not load tenants or business info.');
    }
  };

  useEffect(() => {
    void loadBase();
  }, []);

  const selectedTenant = useMemo(
    () => tenants.find((t) => t.id === tenantId) ?? null,
    [tenants, tenantId]
  );

  const selectedPayment: PaymentRecord | null = useMemo(() => {
    if (!payment?.records.length) return null;
    return payment.records.find((r) => r.id === paymentId) ?? payment.records[0] ?? null;
  }, [payment, paymentId]);

  const loadTenantPayments = async (id: string) => {
    if (!id) {
      setPayment(null);
      setPaymentId(null);
      setGenerated(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/tenants/${id}/payments`);
      if (!res.ok) {
        setError('Could not load payments for this tenant.');
        setPayment(null);
        setPaymentId(null);
        return;
      }
      const data: TenantPayment = await res.json();
      setPayment(data);
      setPaymentId(data.records[0]?.id ?? null);
      setGenerated(true);
    } catch {
      setError('Network error loading payments.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!tenantId) {
      setError('Select a customer / tenant first.');
      return;
    }
    // Refresh business info so logo/address are current
    try {
      const cRes = await apiFetch('/api/contact');
      if (cRes.ok) setPark({ ...DEFAULT_CONTACT, ...(await cRes.json()) });
    } catch {
      /* keep previous park */
    }
    await loadTenantPayments(tenantId);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
        <div>
          <h2 className="text-xl font-serif text-[#3D3730] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#5A6355]" />
            Receipt generator
          </h2>
          <p className="text-sm text-[#5A6355] mt-1">
            Every receipt always includes the Pine Flats logo and business information.
            Customer details fill in from the tenant; payment details appear when a payment is recorded.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5 print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-[#5A6355]">Customer (tenant)</label>
            <select
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setGenerated(false);
                setPayment(null);
                setPaymentId(null);
              }}
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            >
              <option value="">Select tenant…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  Space {t.site} — {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-[#5A6355]">Payment on receipt</label>
            <select
              value={paymentId ?? ''}
              onChange={(e) => setPaymentId(e.target.value || null)}
              disabled={!payment?.records.length}
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355] disabled:opacity-50"
            >
              {!payment?.records.length ? (
                <option value="">No payments yet — record a payment first</option>
              ) : (
                payment.records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.date} · ${Number(r.amount).toFixed(2)} · {r.method}
                    {selectedTenant ? ` · ${receiptNumber(selectedTenant, r)}` : ''}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-2">{error}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading || !tenantId}
            className="flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5C] transition disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? 'Generating…' : 'Generate receipt'}
          </button>
          {generated && selectedTenant && payment && (
            <>
              <button
                type="button"
                disabled={downloading}
                onClick={async () => {
                  setDownloading(true);
                  setDownloadMsg(null);
                  const name = selectedPayment
                    ? `Pine-Flats-Receipt-${receiptNumber(selectedTenant, selectedPayment)}`
                    : `Pine-Flats-Receipt-Space-${selectedTenant.site}`;
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
                onClick={handlePrint}
                className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition"
              >
                <Printer className="w-4 h-4" />
                Print receipt
              </button>
            </>
          )}
        </div>

        {downloadMsg && (
          <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#C5D9C5] rounded-xl px-4 py-2">
            {downloadMsg}
          </p>
        )}

        <p className="text-xs text-[#5A6355]">
          Tip: Recording a payment on a tenant’s Payments page also opens this same compact receipt.
          <strong> Download PDF</strong> saves a one-page letter-size PDF; Print uses the same small layout.
        </p>
      </div>

      {generated && selectedTenant && payment && (
        <PaymentReceiptDocument
          tenant={selectedTenant}
          payment={payment}
          selectedPayment={selectedPayment}
          park={park}
        />
      )}
    </div>
  );
}
