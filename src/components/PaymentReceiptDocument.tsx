import type { ReactNode } from 'react';
import { ParkContact, PaymentRecord, Tenant, TenantPayment } from '../../types';
import { DEFAULT_CONTACT } from '../../contactDefaults';

const KWH_RATE = 0.24;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function formatCurrencyPlain(amount: number) {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value?: string) {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value + (value.length === 10 ? 'T12:00:00' : ''));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }
  }
  return value;
}

function formatShortDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value || '';
  const d = new Date(value.slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

export function receiptNumber(tenant: Tenant, payment: PaymentRecord) {
  const site = String(tenant.site).padStart(2, '0');
  const shortId = payment.id.replace(/\D/g, '').slice(-6) || payment.id.slice(-6);
  return `PF-${site}-${shortId}`;
}

export type ReceiptLineItem = {
  label: string;
  amount: number | null;
  /** Credit / reduction shown in angle brackets like the paper form */
  isCredit?: boolean;
  /** Full-width note row (no amount column emphasis) */
  noteOnly?: boolean;
};

function buildLineItems(
  tenant: Tenant,
  payment: TenantPayment,
  selectedPayment: PaymentRecord | null
): { items: ReceiptLineItem[]; total: number } {
  const items: ReceiptLineItem[] = [];
  const rent = Number(payment.rentAmount) || 0;
  const baseline = Number(payment.baselineCredit) || 0;
  const usage = Number(payment.currentReadingTotal) || 0;
  const prev = Number(payment.previousMeterReading) || 0;
  const latestMeter = payment.meterRecords?.[0];
  const meterPrev = latestMeter?.previousReading ?? prev;
  const meterCurr = latestMeter?.reading ?? (prev + usage || usage);
  const meterUsage = latestMeter?.usage ?? usage;
  const overageKwh = Math.max(0, meterUsage - baseline);
  const electric = overageKwh * KWH_RATE;

  // Rent line with date range when available
  if (rent > 0) {
    const start = payment.rentChargeStart || tenant.startDate;
    const end = payment.rentChargeEnd || tenant.endDate;
    const range =
      start && end && end !== 'ongoing'
        ? `  ${formatShortDate(start)}-${formatShortDate(end)}`
        : start
          ? `  from ${formatShortDate(start)}`
          : '';
    const rentLabel =
      tenant.rentalType === 'weekly'
        ? `Rent${range}`
        : tenant.rentalType === 'daily'
          ? `Rent${range}`
          : `Space Rent${range}`;
    items.push({ label: rentLabel, amount: rent });
  }

  // Electric block (matches paper: reading, baseline, overage)
  if (meterUsage > 0 || latestMeter || usage > 0) {
    const from = meterPrev || 0;
    const to = meterCurr || from + meterUsage;
    items.push({
      label: `Electric reading ${from} - ${to} =${meterUsage}`,
      amount: null,
      noteOnly: true,
    });
    items.push({
      label: baseline > 0 ? `Base line credit ${baseline}kw` : 'Base line credit',
      amount: 0,
    });
    if (overageKwh > 0) {
      items.push({
        label: `${overageKwh} X ${KWH_RATE} kw`,
        amount: electric,
      });
    } else {
      items.push({
        label: `Under Base line Credit ${baseline || 0}kw`,
        amount: 0,
      });
    }
  }

  for (const charge of payment.extraCharges || []) {
    items.push({
      label: charge.description + (charge.note ? ` — ${charge.note}` : ''),
      amount: Number(charge.amount) || 0,
    });
  }

  for (const credit of payment.credits || []) {
    items.push({
      label:
        credit.description ||
        `Credit${credit.date ? ` from ${formatShortDate(credit.date)}` : ''}`,
      amount: Number(credit.amount) || 0,
      isCredit: true,
    });
  }

  // If no rent/electric/extras but we have a payment, show payment as the item
  if (items.length === 0 && selectedPayment) {
    items.push({
      label: selectedPayment.note?.trim() || 'Payment received',
      amount: selectedPayment.amount,
    });
  }

  const total = items.reduce((sum, row) => {
    if (row.amount == null) return sum;
    return sum + (row.isCredit ? -Math.abs(row.amount) : row.amount);
  }, 0);

  return { items, total: Math.round(total * 100) / 100 };
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-1.5 items-start text-[11px] sm:text-xs">
      <span className="text-[#3D3730] font-medium pt-1">{label}</span>
      <span className="bg-[#F0F0F0] px-2 py-1 text-[#3D3730] min-h-[1.5rem] break-words leading-snug">
        {value || '—'}
      </span>
    </div>
  );
}

export interface PaymentReceiptDocumentProps {
  tenant: Tenant;
  payment: TenantPayment;
  selectedPayment: PaymentRecord | null;
  park: ParkContact | null;
  statusLabel?: string;
  children?: ReactNode;
}

/**
 * Printable receipt matching the Pine Flats paper form:
 * centered logo, Customer Details | Company Details, List of Items table, payment note, Thank you.
 */
export function PaymentReceiptDocument({
  tenant,
  payment,
  selectedPayment,
  park,
  children,
}: PaymentReceiptDocumentProps) {
  const business = { ...DEFAULT_CONTACT, ...(park || {}) };
  const logoSrc = (business.logoUrl || '/logo.png').trim() || '/logo.png';
  const businessName = (business.businessName || 'Pine Flats RV Park').trim();

  const { items, total } = buildLineItems(tenant, payment, selectedPayment);

  const customerAddress =
    tenant.address?.trim() ||
    (tenant.site ? `Space ${tenant.site}` : '—');

  const paymentNote = selectedPayment
    ? [
        `Payment from ${selectedPayment.method || 'Payment'}${
          selectedPayment.note ? ` — ${selectedPayment.note}` : ''
        } Processed ${formatDate(selectedPayment.date)}`,
        selectedPayment.id
          ? `Receipt ${receiptNumber(tenant, selectedPayment)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : null;

  return (
    <div
      id="tenant-receipt"
      className="bg-white rounded-sm border border-[#E2D9D0] shadow-sm overflow-hidden print:rounded-none print:border-0 print:shadow-none max-w-[7.5in] mx-auto print:max-w-none"
    >
      {/* Compact layout so one letter page is enough when printing / PDF */}
      <div className="px-5 sm:px-7 py-5 sm:py-6 text-[#3D3730] print:px-4 print:py-3">
        {/* Centered logo (includes Pine Flats wordmark) */}
        <div className="flex justify-center mb-4 print:mb-3">
          <img
            src={logoSrc}
            alt={businessName}
            className="h-14 sm:h-16 w-auto max-w-[160px] object-contain bg-white print:h-12 print:max-w-[140px]"
          />
        </div>

        {/* Customer | Company */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-4 print:gap-3 print:mb-3">
          <div className="space-y-1.5">
            <h2 className="text-[10px] uppercase tracking-[0.12em] text-[#8A847C] font-semibold mb-1.5">
              Customer Details
            </h2>
            <DetailField label="Name:" value={tenant.name} />
            <DetailField label="Address:" value={customerAddress} />
            <DetailField label="Phone No.:" value={tenant.phone || '—'} />
            <DetailField label="Email:" value={tenant.email || '—'} />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-[10px] uppercase tracking-[0.12em] text-[#8A847C] font-semibold mb-1.5">
              Company Details
            </h2>
            <DetailField label="Name:" value={businessName} />
            <DetailField
              label="Address:"
              value={business.address || '—'}
            />
            <DetailField label="Phone No.:" value={business.phone || '—'} />
            <DetailField label="Email:" value={business.email || '—'} />
          </div>
        </div>

        {/* List of items */}
        <table className="w-full text-[11px] sm:text-xs border-collapse mb-1">
          <thead>
            <tr className="bg-[#7A7A7A] text-white">
              <th className="text-left font-semibold tracking-wide px-2.5 py-1.5">
                LIST OF ITEMS
              </th>
              <th className="text-right font-semibold tracking-wide px-2.5 py-1.5 w-24">
                AMOUNT $
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr className="border-b border-[#D0D0D0]">
                <td className="px-2.5 py-2 text-[#5A6355]" colSpan={2}>
                  No line items yet. Record rent, electric, or a payment to fill this receipt.
                </td>
              </tr>
            ) : (
              items.map((row, i) => (
                <tr key={i} className="border-b border-[#D0D0D0]">
                  <td
                    className={`px-2.5 py-1.5 leading-snug ${
                      row.noteOnly ? 'text-[#3D3730]' : 'text-[#3D3730] pl-5'
                    }`}
                  >
                    {row.label}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap">
                    {row.amount == null
                      ? ''
                      : row.isCredit
                        ? `<$${formatCurrencyPlain(Math.abs(row.amount))}>`
                        : row.amount === 0
                          ? '$ 0.00'
                          : `$${formatCurrencyPlain(row.amount)}`}
                  </td>
                </tr>
              ))
            )}
            {items.length > 0 && (
              <tr className="border-b border-[#3D3730]">
                <td className="px-2.5 py-1.5 font-medium">Due</td>
                <td className="px-2.5 py-1.5 text-right font-semibold tabular-nums">
                  {formatCurrency(total)}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Payment processed note */}
        {paymentNote && (
          <div className="mt-3 text-[11px] sm:text-xs text-[#3D3730] whitespace-pre-line leading-snug print:mt-2">
            {paymentNote}
          </div>
        )}

        <p
          className="mt-4 print:mt-3 text-center text-base sm:text-lg text-[#3D3730]"
          style={{ fontFamily: 'Georgia, "Segoe Script", "Brush Script MT", cursive' }}
        >
          Thank you!
        </p>

        {children}
      </div>
    </div>
  );
}
