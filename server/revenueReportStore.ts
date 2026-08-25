import fs from 'fs';
import path from 'path';
import { TenantPayment } from '../types';
import { getTenants } from './tenantsStore';
import { getTotalPaidForTenant } from './paymentsStore';
import { listTaxLedgerYears, loadLedgerEntries } from './taxLedgerStore';

const DATA_DIR = path.join(process.cwd(), 'data');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const EMAIL_LOG_FILE = path.join(DATA_DIR, 'email-log.json');

/** One money-in event used for revenue (a “receipt”). */
export interface RevenueReceipt {
  id: string;
  /** YYYY-MM-DD when money was received */
  date: string;
  amount: number;
  /** tenant_payment | booking_receipt | tax_ledger */
  source: 'tenant_payment' | 'booking_receipt' | 'tax_ledger';
  label: string;
  guestName?: string;
  site?: string;
  method?: string;
  tenantId?: string;
  receiptId?: string;
}

export interface MonthlyRevenueRow {
  month: string;
  label: string;
  /** All receipts in this month (primary total) */
  totalRevenue: number;
  receiptCount: number;
  /** Breakdown */
  tenantPayments: number;
  tenantPaymentCount: number;
  bookingReceipts: number;
  bookingReceiptCount: number;
  taxLedgerStays: number;
  taxLedgerCount: number;
  receipts: RevenueReceipt[];
}

export interface YearRevenueReport {
  year: number;
  months: MonthlyRevenueRow[];
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
  /** Flat list of all receipts for the year (newest first) */
  allReceipts: RevenueReceipt[];
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function loadPayments(): Record<string, TenantPayment> {
  if (!fs.existsSync(PAYMENTS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function loadEmailLog(): Array<Record<string, unknown>> {
  if (!fs.existsSync(EMAIL_LOG_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(EMAIL_LOG_FILE, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function monthKeyFromDate(value?: string | null): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const m = String(Number(us[1])).padStart(2, '0');
    return `${us[3]}-${m}`;
  }
  // "7/18/2026, 1:33:38 PM"
  const usTime = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usTime) {
    const m = String(Number(usTime[1])).padStart(2, '0');
    return `${usTime[3]}-${m}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return null;
}

function toIsoDate(value?: string | null): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    return `${us[3]}-${String(Number(us[1])).padStart(2, '0')}-${String(Number(us[2])).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return s.slice(0, 10);
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function emptyRow(month: string): MonthlyRevenueRow {
  return {
    month,
    label: monthLabel(month),
    totalRevenue: 0,
    receiptCount: 0,
    tenantPayments: 0,
    tenantPaymentCount: 0,
    bookingReceipts: 0,
    bookingReceiptCount: 0,
    taxLedgerStays: 0,
    taxLedgerCount: 0,
    receipts: [],
  };
}

/** Collect every receipt-like money event in the system. */
export function collectAllReceipts(): RevenueReceipt[] {
  const out: RevenueReceipt[] = [];
  const tenants = getTenants();
  const tenantById = new Map(tenants.map(t => [t.id, t]));

  // 1) Tenant payment records (= printable receipts in back office)
  const all = loadPayments();
  for (const [tenantId, payment] of Object.entries(all)) {
    const tenant = tenantById.get(tenantId);
    for (const r of payment.records ?? []) {
      const amount = Number(r.amount) || 0;
      if (amount <= 0) continue;
      out.push({
        id: `pay_${tenantId}_${r.id}`,
        date: toIsoDate(r.date),
        amount: money(amount),
        source: 'tenant_payment',
        label: r.note?.trim() || `Payment · ${r.method || 'Cash'}`,
        guestName: tenant?.name,
        site: tenant?.site,
        method: r.method,
        tenantId,
        receiptId: r.id,
      });
    }
  }

  // 2) Website booking receipts from email log (park copy only — avoid double customer copy)
  const seenBookingReceipts = new Set<string>();
  for (const entry of loadEmailLog()) {
    const kind = String(entry.kind || '');
    if (kind !== 'park_receipt' && kind !== 'customer_receipt') continue;
    // Prefer park_receipt; skip customer_receipt if same receiptId already taken
    const receiptId = String(entry.receiptId || entry.id || '');
    if (!receiptId) continue;
    if (kind === 'customer_receipt' && seenBookingReceipts.has(receiptId)) continue;
    if (kind === 'park_receipt') seenBookingReceipts.add(receiptId);
    if (kind === 'customer_receipt') seenBookingReceipts.add(receiptId);

    const text = String(entry.text || '');
    const totalMatch = text.match(/Total:\s*\$([0-9,]+\.?\d*)/i);
    const amount = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : 0;
    if (!amount || amount <= 0) continue;

    const nameMatch = text.match(/Name:\s*(.+)/i);
    const siteMatch = text.match(/Site:\s*(.+)/i);
    const methodMatch = text.match(/Method:\s*(.+)/i);
    const dateFromText = text.match(/Date:\s*([^\n]+)/i);
    const at = String(entry.at || '');
    const date = toIsoDate(dateFromText?.[1] || at);

    // Skip if we already have a tenant payment with same amount+date+name (rough dedupe)
    // Booking receipts are still included; dedupe only against tax_ledger later

    out.push({
      id: `book_${receiptId}_${kind === 'park_receipt' ? 'p' : 'c'}`,
      date,
      amount: money(amount),
      source: 'booking_receipt',
      label: String(entry.subject || 'Website booking receipt'),
      guestName: nameMatch?.[1]?.trim(),
      site: siteMatch?.[1]?.trim()?.split('·')[0]?.trim(),
      method: methodMatch?.[1]?.trim(),
      receiptId,
    });
  }

  // Keep only one row per booking receiptId (prefer park)
  const byReceiptId = new Map<string, RevenueReceipt>();
  const noId: RevenueReceipt[] = [];
  for (const r of out) {
    if (r.source === 'booking_receipt' && r.receiptId) {
      const prev = byReceiptId.get(r.receiptId);
      if (!prev || r.id.endsWith('_p')) byReceiptId.set(r.receiptId, r);
    } else {
      noId.push(r);
    }
  }
  const bookingOnly = [...byReceiptId.values()];

  // 3) Tax ledger paid entries not already covered by booking receipt (same slot/date/amount)
  let taxEntries = [];
  try {
    taxEntries = loadLedgerEntries().filter(
      e => (e.rentalType === 'daily' || e.rentalType === 'weekly') && (e.grandTotal || 0) > 0
    );
  } catch {
    taxEntries = [];
  }

  const taxReceipts: RevenueReceipt[] = [];
  for (const e of taxEntries) {
    const date = toIsoDate(e.bookedAt || e.checkIn);
    const amount = money(e.grandTotal || 0);
    // Skip if a booking receipt already has same receipt amount+day+guest
    const covered = bookingOnly.some(
      b =>
        b.date === date &&
        Math.abs(b.amount - amount) < 0.02 &&
        (b.guestName || '').toLowerCase() === (e.guestName || '').toLowerCase()
    );
    if (covered) continue;
    taxReceipts.push({
      id: `tax_${e.id}`,
      date,
      amount,
      source: 'tax_ledger',
      label: `Daily/weekly stay · ${e.siteLabel}`,
      guestName: e.guestName,
      site: e.siteLabel,
      method: e.paymentMethod,
    });
  }

  return [...noId, ...bookingOnly, ...taxReceipts].sort((a, b) =>
    b.date.localeCompare(a.date)
  );
}

export function listRevenueYears(): number[] {
  const years = new Set<number>();
  const now = new Date().getFullYear();
  years.add(now);
  years.add(now - 1);
  for (const r of collectAllReceipts()) {
    const y = Number(r.date.slice(0, 4));
    if (y >= 2020 && y <= now + 1) years.add(y);
  }
  try {
    for (const y of listTaxLedgerYears()) years.add(y);
  } catch {
    /* ignore */
  }
  return [...years].filter(y => y >= 2020 && y <= now + 1).sort((a, b) => b - a);
}

export function getYearRevenueReport(year: number): YearRevenueReport {
  const byMonth = new Map<string, MonthlyRevenueRow>();
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    byMonth.set(key, emptyRow(key));
  }

  const yearReceipts = collectAllReceipts().filter(r => r.date.startsWith(String(year)));

  for (const r of yearReceipts) {
    const mk = monthKeyFromDate(r.date);
    if (!mk) continue;
    const row = byMonth.get(mk);
    if (!row) continue;
    row.totalRevenue = money(row.totalRevenue + r.amount);
    row.receiptCount += 1;
    row.receipts.push(r);
    if (r.source === 'tenant_payment') {
      row.tenantPayments = money(row.tenantPayments + r.amount);
      row.tenantPaymentCount += 1;
    } else if (r.source === 'booking_receipt') {
      row.bookingReceipts = money(row.bookingReceipts + r.amount);
      row.bookingReceiptCount += 1;
    } else {
      row.taxLedgerStays = money(row.taxLedgerStays + r.amount);
      row.taxLedgerCount += 1;
    }
  }

  // Sort receipts within month
  for (const row of byMonth.values()) {
    row.receipts.sort((a, b) => b.date.localeCompare(a.date));
  }

  const months = [...byMonth.values()];

  const tenants = getTenants();
  const byTenant = tenants
    .map(t => ({
      tenantId: t.id,
      name: t.name,
      site: t.site,
      totalPaid: getTotalPaidForTenant(t.id),
    }))
    .filter(t => t.totalPaid > 0)
    .sort((a, b) => b.totalPaid - a.totalPaid);

  const summary = {
    totalRevenue: money(months.reduce((s, m) => s + m.totalRevenue, 0)),
    receiptCount: months.reduce((s, m) => s + m.receiptCount, 0),
    tenantPayments: money(months.reduce((s, m) => s + m.tenantPayments, 0)),
    tenantPaymentCount: months.reduce((s, m) => s + m.tenantPaymentCount, 0),
    bookingReceipts: money(months.reduce((s, m) => s + m.bookingReceipts, 0)),
    bookingReceiptCount: months.reduce((s, m) => s + m.bookingReceiptCount, 0),
    taxLedgerStays: money(months.reduce((s, m) => s + m.taxLedgerStays, 0)),
    taxLedgerCount: months.reduce((s, m) => s + m.taxLedgerCount, 0),
  };

  return {
    year,
    months,
    summary,
    byTenant,
    allReceipts: yearReceipts,
  };
}
