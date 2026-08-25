/**
 * Central list of overnight (daily) and weekly guest receipts for park records.
 * Sources: tax ledger (paid bookings), email booking receipts, current site stays.
 */
import fs from 'fs';
import path from 'path';
import { RentalType } from '../types';
import {
  loadLedgerEntries,
  syncTaxLedgerFromSlots,
  upsertTaxLedgerEntry,
  deleteTaxLedgerEntry,
  getTaxLedgerEntry,
  type TaxLedgerEntry,
} from './taxLedgerStore';
import { getActiveRentalRates } from './propertiesStore';
import { atomicWriteJson, ensureDataDir } from './persist';

const DATA_DIR = path.join(process.cwd(), 'data');
const EMAIL_LOG_FILE = path.join(DATA_DIR, 'email-log.json');
/** Ids (usually email_*) hidden after convert-to-ledger or admin delete */
const HIDDEN_FILE = path.join(DATA_DIR, 'guest-receipts-hidden.json');

export interface GuestStayReceipt {
  id: string;
  /** Receipt # when available */
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
  siteNumber?: number;
  paymentMethod?: string;
  rentSubtotal: number;
  stateTax: number;
  countyTax: number;
  totalTax: number;
  grandTotal: number;
  status: 'paid' | 'estimated' | 'logged';
  source: 'tax_ledger' | 'booking_email' | 'slot';
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
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

function loadHiddenIds(): Set<string> {
  if (!fs.existsSync(HIDDEN_FILE)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf-8'));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.ids) ? raw.ids : [];
    return new Set(list.map((x: unknown) => String(x)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function hideReceiptId(id: string): void {
  if (!id) return;
  const set = loadHiddenIds();
  if (set.has(id)) return;
  set.add(id);
  ensureDataDir(DATA_DIR);
  atomicWriteJson(HIDDEN_FILE, [...set]);
}

function toIsoDate(value?: string | null): string {
  if (!value) return '';
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

function parseEmailBooking(entry: Record<string, unknown>): GuestStayReceipt | null {
  const kind = String(entry.kind || '');
  if (kind !== 'park_receipt' && kind !== 'customer_receipt') return null;
  const text = String(entry.text || '');
  const typeMatch = text.match(/Rental type:\s*(daily|weekly|monthly)/i);
  const rentalType = (typeMatch?.[1] || '').toLowerCase() as RentalType;
  if (rentalType !== 'daily' && rentalType !== 'weekly') return null;

  const totalMatch = text.match(/Total:\s*\$([0-9,]+\.?\d*)/i);
  const grandTotal = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : 0;
  if (!grandTotal || grandTotal <= 0) return null;

  const nameMatch = text.match(/Name:\s*(.+)/i);
  const emailMatch = text.match(/Email:\s*(.+)/i);
  const phoneMatch = text.match(/Phone:\s*(.+)/i);
  const siteMatch = text.match(/Site:\s*(.+)/i);
  const checkInMatch = text.match(/Check-in:\s*(.+)/i);
  const checkOutMatch = text.match(/Check-out:\s*(.+)/i);
  const nightsMatch = text.match(/Nights:\s*(\d+)/i);
  const methodMatch = text.match(/Method:\s*(.+)/i);
  const dateMatch = text.match(/Date:\s*([^\n]+)/i);
  const receiptNumber = String(entry.receiptId || '');

  const bookedAt = toIsoDate(dateMatch?.[1] || String(entry.at || ''));
  const checkIn = toIsoDate(checkInMatch?.[1]) || bookedAt;
  const checkOut = toIsoDate(checkOutMatch?.[1]) || checkIn;
  const nights = nightsMatch ? Number(nightsMatch[1]) : 0;

  return {
    id: `email_${receiptNumber || entry.id}_${kind}`,
    receiptNumber: receiptNumber || undefined,
    bookedAt,
    checkIn,
    checkOut,
    nights,
    rentalType,
    guestName: nameMatch?.[1]?.trim() || 'Guest',
    guestEmail: emailMatch?.[1]?.trim(),
    guestPhone: phoneMatch?.[1]?.trim(),
    siteLabel: siteMatch?.[1]?.trim() || 'Site',
    paymentMethod: methodMatch?.[1]?.trim(),
    rentSubtotal: money(grandTotal), // may include tax if not broken out in email
    stateTax: 0,
    countyTax: 0,
    totalTax: 0,
    grandTotal: money(grandTotal),
    status: 'logged',
    source: 'booking_email',
  };
}

function fromLedger(e: TaxLedgerEntry): GuestStayReceipt | null {
  if (e.rentalType !== 'daily' && e.rentalType !== 'weekly') return null;
  return {
    id: e.id,
    receiptNumber: e.slotId ? `PF-${String(e.siteNumber ?? e.slotId).padStart(2, '0')}-${e.id.slice(-6)}` : undefined,
    bookedAt: e.bookedAt,
    checkIn: e.checkIn,
    checkOut: e.checkOut,
    nights: e.nights,
    rentalType: e.rentalType,
    guestName: e.guestName,
    guestEmail: e.guestEmail,
    guestPhone: e.guestPhone,
    siteLabel: e.siteLabel,
    siteNumber: e.siteNumber,
    paymentMethod: e.paymentMethod,
    rentSubtotal: e.rentSubtotal,
    stateTax: e.stateTax,
    countyTax: e.countyTax,
    totalTax: e.totalTax,
    grandTotal: e.grandTotal,
    status: e.status,
    source: e.source === 'slot' ? 'slot' : 'tax_ledger',
  };
}

function dedupeKey(r: GuestStayReceipt): string {
  return [
    r.rentalType,
    r.checkIn,
    r.checkOut,
    (r.guestName || '').toLowerCase().trim(),
    (r.siteLabel || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 24),
  ].join('|');
}

/**
 * Full list of overnight (daily) + weekly guest receipts for park records.
 */
export function listOvernightWeeklyReceipts(filters?: {
  year?: number;
  rentalType?: 'daily' | 'weekly' | 'all';
}): {
  receipts: GuestStayReceipt[];
  summary: {
    count: number;
    dailyCount: number;
    weeklyCount: number;
    rentSubtotal: number;
    totalTax: number;
    grandTotal: number;
  };
} {
  // Ensure site stays are mirrored into the ledger
  try {
    syncTaxLedgerFromSlots();
  } catch {
    /* ignore */
  }

  const map = new Map<string, GuestStayReceipt>();

  // Prefer tax ledger (has tax breakdown when from paid booking)
  for (const e of loadLedgerEntries()) {
    const row = fromLedger(e);
    if (!row) continue;
    map.set(dedupeKey(row), row);
  }

  // Add email booking receipts if not already present
  for (const entry of loadEmailLog()) {
    const row = parseEmailBooking(entry);
    if (!row) continue;
    const key = dedupeKey(row);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
    } else if (!existing.receiptNumber && row.receiptNumber) {
      existing.receiptNumber = row.receiptNumber;
    } else if (existing.source === 'slot' && row.source === 'booking_email') {
      // Prefer email logged paid booking details
      map.set(key, {
        ...row,
        stateTax: existing.stateTax,
        countyTax: existing.countyTax,
        totalTax: existing.totalTax,
        rentSubtotal: existing.rentSubtotal || row.rentSubtotal,
      });
    }
  }

  const hidden = loadHiddenIds();
  let receipts = [...map.values()].filter(r => !hidden.has(r.id));

  if (filters?.year) {
    const y = String(filters.year);
    receipts = receipts.filter(r => (r.bookedAt || r.checkIn).startsWith(y));
  }
  if (filters?.rentalType && filters.rentalType !== 'all') {
    receipts = receipts.filter(r => r.rentalType === filters.rentalType);
  }

  receipts.sort((a, b) => (b.bookedAt || b.checkIn).localeCompare(a.bookedAt || a.checkIn));

  const summary = {
    count: receipts.length,
    dailyCount: receipts.filter(r => r.rentalType === 'daily').length,
    weeklyCount: receipts.filter(r => r.rentalType === 'weekly').length,
    rentSubtotal: money(receipts.reduce((s, r) => s + (r.rentSubtotal || 0), 0)),
    totalTax: money(receipts.reduce((s, r) => s + (r.totalTax || 0), 0)),
    grandTotal: money(receipts.reduce((s, r) => s + (r.grandTotal || 0), 0)),
  };

  return { receipts, summary };
}

export type GuestReceiptInput = {
  id?: string;
  bookedAt?: string;
  checkIn: string;
  checkOut: string;
  rentalType: 'daily' | 'weekly';
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  siteLabel: string;
  siteNumber?: number;
  paymentMethod?: string;
  rentSubtotal?: number;
  stateTax?: number;
  countyTax?: number;
  grandTotal?: number;
  status?: 'paid' | 'estimated';
};

/**
 * Admin create/update: always persists to the tax ledger so edits stick.
 * If editing an email-only receipt (id starts with email_), creates a new ledger entry
 * and hides the old email row so it does not reappear as a duplicate.
 */
export function saveGuestReceipt(input: GuestReceiptInput): GuestStayReceipt {
  const originalId = input.id;
  let ledgerId = input.id;
  // Email/slot composite ids are not real ledger ids — create new ledger record
  if (ledgerId && (ledgerId.startsWith('email_') || ledgerId.startsWith('tax_slot_'))) {
    ledgerId = undefined;
  }
  if (ledgerId && !getTaxLedgerEntry(ledgerId)) {
    ledgerId = undefined;
  }

  const entry = upsertTaxLedgerEntry({
    id: ledgerId,
    bookedAt: input.bookedAt,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    rentalType: input.rentalType,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    guestPhone: input.guestPhone,
    siteLabel: input.siteLabel,
    siteNumber: input.siteNumber,
    paymentMethod: input.paymentMethod,
    rentSubtotal: input.rentSubtotal,
    stateTax: input.stateTax,
    countyTax: input.countyTax,
    grandTotal: input.grandTotal,
    status: input.status,
  });

  // Hide source row when converting email/slot synthetic ids into real ledger rows
  if (
    originalId &&
    (originalId.startsWith('email_') || originalId.startsWith('tax_slot_')) &&
    entry.id !== originalId
  ) {
    hideReceiptId(originalId);
  }

  const row = fromLedger(entry);
  if (!row) throw new Error('Could not save receipt');
  return row;
}

export function removeGuestReceipt(id: string): boolean {
  if (!id) return false;
  // Always drop matching tax ledger row (tax_slot_* and tax_* both live on the ledger)
  const deleted = deleteTaxLedgerEntry(id);
  // Email / synthetic / already-removed rows: hide so they leave receipts + tax summary lists
  if (id.startsWith('email_') || id.startsWith('tax_slot_') || !deleted) {
    hideReceiptId(id);
  }
  return true;
}

export function recomputeTaxesFromRent(
  rentalType: 'daily' | 'weekly',
  rentSubtotal: number
): { stateTax: number; countyTax: number; totalTax: number; grandTotal: number } {
  const rates = getActiveRentalRates();
  const rent = money(Math.max(0, rentSubtotal));
  const stateTax = money(rent * ((rates.stateTransientTaxPercent ?? 0) / 100));
  const countyTax = money(rent * ((rates.countyTransientTaxPercent ?? 0) / 100));
  const totalTax = money(stateTax + countyTax);
  return {
    stateTax,
    countyTax,
    totalTax,
    grandTotal: money(rent + totalTax),
  };
}


