import fs from 'fs';
import path from 'path';
import { RentalType, Slot } from '../types';
import {
  calculateStayBreakdown,
  calculateStayNights,
  parseDateKey,
  parseFlexibleDate,
  type RentalRatesConfig,
} from '../rentUtils';
import { getActiveRentalRates } from './propertiesStore';
import { getSlots } from './slotsStore';
import { atomicWriteJson } from './persist';

const DATA_DIR = path.join(process.cwd(), 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'tax-ledger.json');

export interface TaxLedgerEntry {
  id: string;
  /** ISO date when payment/booking was recorded */
  bookedAt: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rentalType: RentalType;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  siteLabel: string;
  siteNumber?: number;
  slotId?: string;
  paymentMethod?: string;
  /** Rent before tax */
  rentSubtotal: number;
  stateTaxPercent: number;
  countyTaxPercent: number;
  stateTax: number;
  countyTax: number;
  totalTax: number;
  grandTotal: number;
  /** paid | estimated (from historical data without tax split) */
  status: 'paid' | 'estimated';
  source: 'booking' | 'slot' | 'manual';
  createdAt: string;
}

export interface QuarterlyTaxReport {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  label: string;
  startDate: string;
  endDate: string;
  taxRates: {
    stateTransientTaxPercent: number;
    countyTransientTaxPercent: number;
  };
  entries: TaxLedgerEntry[];
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
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadLedgerEntries(): TaxLedgerEntry[] {
  ensureDataDir();
  if (!fs.existsSync(LEDGER_FILE)) {
    atomicWriteJson(LEDGER_FILE, []);
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function loadLedger(): TaxLedgerEntry[] {
  return loadLedgerEntries();
}

function saveLedger(entries: TaxLedgerEntry[]) {
  ensureDataDir();
  atomicWriteJson(LEDGER_FILE, entries);
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function quarterRange(year: number, quarter: 1 | 2 | 3 | 4): { start: Date; end: Date; startDate: string; endDate: string; label: string } {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0); // last day of quarter
  const pad = (n: number) => String(n).padStart(2, '0');
  const startDate = `${year}-${pad(startMonth + 1)}-01`;
  const endDate = `${year}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
  const labels = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'];
  return { start, end, startDate, endDate, label: `${labels[quarter - 1]} ${year}` };
}

function inRange(isoDate: string, start: Date, end: Date): boolean {
  const d = parseFlexibleDate(isoDate) || (/^\d{4}-\d{2}-\d{2}/.test(isoDate) ? parseDateKey(isoDate.slice(0, 10)) : null);
  if (!d) return false;
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return t >= s && t <= e;
}

/** Record a paid daily/weekly booking for tax reporting. Monthly stays are skipped. */
export function recordPaidBookingTax(input: {
  bookedAt?: string;
  checkIn: string;
  checkOut: string;
  rentalType: RentalType;
  guestName: string;
  guestEmail?: string;
  siteLabel: string;
  siteNumber?: number;
  slotId?: string;
  paymentMethod?: string;
  rates?: RentalRatesConfig;
}): TaxLedgerEntry | null {
  if (input.rentalType !== 'daily' && input.rentalType !== 'weekly') {
    return null;
  }
  let checkInDate: Date;
  let checkOutDate: Date;
  try {
    checkInDate = parseDateKey(input.checkIn);
    checkOutDate = parseDateKey(input.checkOut);
  } catch {
    return null;
  }
  if (checkOutDate <= checkInDate) return null;

  const rates = input.rates ?? getActiveRentalRates();
  const breakdown = calculateStayBreakdown(input.rentalType, checkInDate, checkOutDate, rates);
  const nights = calculateStayNights(checkInDate, checkOutDate);
  const bookedAt = (input.bookedAt || new Date().toISOString().split('T')[0]).slice(0, 10);

  const entry: TaxLedgerEntry = {
    id: `tax_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    bookedAt,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nights,
    rentalType: input.rentalType,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    siteLabel: input.siteLabel,
    siteNumber: input.siteNumber,
    slotId: input.slotId,
    paymentMethod: input.paymentMethod,
    rentSubtotal: breakdown.subtotal,
    stateTaxPercent: breakdown.stateTaxPercent,
    countyTaxPercent: breakdown.countyTaxPercent,
    stateTax: breakdown.stateTax,
    countyTax: breakdown.countyTax,
    totalTax: breakdown.totalTax,
    grandTotal: breakdown.grandTotal,
    status: 'paid',
    source: 'booking',
    createdAt: new Date().toISOString(),
  };

  const ledger = loadLedger();
  // Same stay (site + dates + type) — update in place instead of double-counting
  const dup = findExistingStay(ledger, entry);
  if (dup) {
    const merged: TaxLedgerEntry = {
      ...dup,
      ...entry,
      id: dup.id,
      createdAt: dup.createdAt || entry.createdAt,
      // Keep paid if either is paid
      status: dup.status === 'paid' || entry.status === 'paid' ? 'paid' : entry.status,
      source:
        dup.source === 'booking' || entry.source === 'booking'
          ? 'booking'
          : entry.source || dup.source,
    };
    const idx = ledger.findIndex(e => e.id === dup.id);
    ledger[idx] = merged;
    saveLedger(ledger);
    return merged;
  }
  ledger.push(entry);
  saveLedger(ledger);
  return entry;
}

function moneySafe(n: unknown, fallback = 0): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return fallback;
  return Math.round(v * 100) / 100;
}

/** Create or replace a ledger entry (admin edit / manual entry). */
export function upsertTaxLedgerEntry(
  input: Partial<TaxLedgerEntry> & {
    guestName: string;
    siteLabel: string;
    checkIn: string;
    checkOut: string;
    rentalType: RentalType;
    guestPhone?: string;
  }
): TaxLedgerEntry {
  if (input.rentalType !== 'daily' && input.rentalType !== 'weekly') {
    throw new Error('Only daily or weekly stays can be stored here');
  }
  let checkInDate: Date;
  let checkOutDate: Date;
  try {
    checkInDate = parseDateKey(input.checkIn.slice(0, 10));
    checkOutDate = parseDateKey(input.checkOut.slice(0, 10));
  } catch {
    throw new Error('Invalid check-in or check-out date (use YYYY-MM-DD)');
  }
  if (checkOutDate <= checkInDate) {
    throw new Error('Check-out must be after check-in');
  }

  const rates = getActiveRentalRates();
  const nights = calculateStayNights(checkInDate, checkOutDate);
  let rentSubtotal = moneySafe(input.rentSubtotal, NaN);
  let stateTax = moneySafe(input.stateTax, NaN);
  let countyTax = moneySafe(input.countyTax, NaN);
  let grandTotal = moneySafe(input.grandTotal, NaN);

  // If rent not provided, compute from current rates
  if (!Number.isFinite(rentSubtotal)) {
    const breakdown = calculateStayBreakdown(input.rentalType, checkInDate, checkOutDate, rates);
    rentSubtotal = breakdown.subtotal;
    if (!Number.isFinite(stateTax)) stateTax = breakdown.stateTax;
    if (!Number.isFinite(countyTax)) countyTax = breakdown.countyTax;
    if (!Number.isFinite(grandTotal)) grandTotal = breakdown.grandTotal;
  } else {
    // Recalc tax from rent + current % if tax fields omitted
    if (!Number.isFinite(stateTax)) {
      stateTax = money(rentSubtotal * ((rates.stateTransientTaxPercent ?? 0) / 100));
    }
    if (!Number.isFinite(countyTax)) {
      countyTax = money(rentSubtotal * ((rates.countyTransientTaxPercent ?? 0) / 100));
    }
    if (!Number.isFinite(grandTotal)) {
      grandTotal = money(rentSubtotal + stateTax + countyTax);
    }
  }

  const totalTax = money(stateTax + countyTax);
  if (!Number.isFinite(grandTotal)) grandTotal = money(rentSubtotal + totalTax);

  const ledger = loadLedger();
  let existingId = input.id && ledger.some(e => e.id === input.id) ? input.id : null;
  // No explicit id: still merge onto an existing row for the same stay
  if (!existingId) {
    const same = findExistingStay(ledger, {
      slotId: input.slotId,
      siteNumber: input.siteNumber,
      siteLabel: input.siteLabel,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      rentalType: input.rentalType,
      guestName: input.guestName,
    });
    if (same) existingId = same.id;
  }

  const prior = existingId ? ledger.find(e => e.id === existingId) : undefined;

  const entry: TaxLedgerEntry = {
    id: existingId || `tax_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    bookedAt: (input.bookedAt || prior?.bookedAt || new Date().toISOString().split('T')[0]).slice(0, 10),
    checkIn: input.checkIn.slice(0, 10),
    checkOut: input.checkOut.slice(0, 10),
    nights,
    rentalType: input.rentalType,
    guestName: String(input.guestName || '').trim() || 'Guest',
    guestEmail: input.guestEmail?.trim() || prior?.guestEmail || undefined,
    guestPhone: input.guestPhone?.trim() || prior?.guestPhone || undefined,
    siteLabel: String(input.siteLabel || '').trim() || 'Site',
    siteNumber: input.siteNumber ?? prior?.siteNumber,
    slotId: input.slotId || prior?.slotId,
    paymentMethod: input.paymentMethod?.trim() || prior?.paymentMethod || undefined,
    rentSubtotal,
    stateTaxPercent:
      Number.isFinite(Number(input.stateTaxPercent))
        ? Number(input.stateTaxPercent)
        : rates.stateTransientTaxPercent ?? 0,
    countyTaxPercent:
      Number.isFinite(Number(input.countyTaxPercent))
        ? Number(input.countyTaxPercent)
        : rates.countyTransientTaxPercent ?? 0,
    stateTax,
    countyTax,
    totalTax,
    grandTotal,
    status: input.status === 'estimated' ? 'estimated' : 'paid',
    source: (() => {
      const status = input.status === 'estimated' ? 'estimated' : 'paid';
      // Paid stays must not stay as source "slot" (tax report hid those)
      if (status === 'paid') {
        if (prior?.source === 'booking') return 'booking';
        return 'manual';
      }
      if (prior?.source === 'booking') return 'booking';
      if (prior?.source === 'manual') return 'manual';
      return prior?.source || 'manual';
    })(),
    createdAt: prior?.createdAt || new Date().toISOString(),
  };

  if (existingId) {
    const idx = ledger.findIndex(e => e.id === existingId);
    ledger[idx] = entry;
  } else {
    ledger.push(entry);
  }
  saveLedger(ledger);
  return entry;
}

export function deleteTaxLedgerEntry(id: string): boolean {
  const ledger = loadLedger();
  const next = ledger.filter(e => e.id !== id);
  if (next.length === ledger.length) return false;
  saveLedger(next);
  return true;
}

export function getTaxLedgerEntry(id: string): TaxLedgerEntry | null {
  return loadLedger().find(e => e.id === id) ?? null;
}

function dateKey10(value?: string | null): string {
  if (!value) return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    const d = parseFlexibleDate(s);
    if (!d) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return '';
  }
}

function normName(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function extractSiteNumber(e: {
  slotId?: string;
  siteNumber?: number;
  siteLabel?: string;
}): number | null {
  if (e.siteNumber != null && Number.isFinite(Number(e.siteNumber))) {
    return Number(e.siteNumber);
  }
  if (e.slotId) {
    const m = String(e.slotId).match(/(\d+)/);
    if (m) return Number(m[1]);
  }
  const label = String(e.siteLabel || '');
  const m = label.match(/(?:site|space|sp\.?)\s*#?\s*(\d+)/i) || label.match(/\b(\d{1,2})\b/);
  if (m) return Number(m[1]);
  return null;
}

function sitesMatch(
  a: { slotId?: string; siteNumber?: number; siteLabel?: string },
  b: { slotId?: string; siteNumber?: number; siteLabel?: string }
): boolean {
  if (a.slotId && b.slotId && a.slotId === b.slotId) return true;
  const an = extractSiteNumber(a);
  const bn = extractSiteNumber(b);
  if (an != null && bn != null && an === bn) return true;
  const al = String(a.siteLabel || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const bl = String(b.siteLabel || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return !!(al && bl && al === bl);
}

/** Same physical stay (site + dates + rental type). Guest name soft-match when both set. */
function isSameStay(
  a: {
    slotId?: string;
    siteNumber?: number;
    siteLabel?: string;
    checkIn?: string;
    checkOut?: string;
    rentalType?: string;
    guestName?: string;
  },
  b: {
    slotId?: string;
    siteNumber?: number;
    siteLabel?: string;
    checkIn?: string;
    checkOut?: string;
    rentalType?: string;
    guestName?: string;
  }
): boolean {
  if ((a.rentalType || '') !== (b.rentalType || '')) return false;
  const aIn = dateKey10(a.checkIn);
  const bIn = dateKey10(b.checkIn);
  const aOut = dateKey10(a.checkOut);
  const bOut = dateKey10(b.checkOut);
  if (!aIn || !bIn || aIn !== bIn) return false;
  if (!aOut || !bOut || aOut !== bOut) return false;
  if (!sitesMatch(a, b)) return false;
  const aGuest = normName(a.guestName);
  const bGuest = normName(b.guestName);
  // If both names present and clearly different, treat as different stays
  if (aGuest && bGuest && aGuest !== bGuest) return false;
  return true;
}

/** Prefer paid/booking rows over estimated/slot; prefer higher grand total when both paid. */
function stayQuality(e: TaxLedgerEntry): number {
  let score = 0;
  if (e.status === 'paid') score += 100;
  if (e.source === 'booking') score += 30;
  if (e.source === 'manual') score += 20;
  if (e.source === 'slot') score += 5;
  if (e.status === 'estimated') score -= 40;
  score += Math.min(50, Math.round((e.grandTotal || 0) / 10));
  // Prefer newer createdAt slightly
  const t = Date.parse(e.createdAt || '') || 0;
  score += Math.min(10, t / 1e12);
  return score;
}

/**
 * Collapse duplicate stays on the tax ledger (same site + check-in/out + type).
 * Keeps the highest-quality row. Returns how many rows were removed.
 */
export function dedupeTaxLedgerEntries(): { removed: number; total: number } {
  const ledger = loadLedger();
  if (ledger.length < 2) return { removed: 0, total: ledger.length };

  const final: TaxLedgerEntry[] = [];
  for (const e of ledger) {
    const idx = final.findIndex(f => isSameStay(f, e));
    if (idx === -1) {
      final.push(e);
    } else if (stayQuality(e) > stayQuality(final[idx])) {
      final[idx] = e;
    }
  }

  const removed = ledger.length - final.length;
  if (removed > 0) saveLedger(final);
  return { removed, total: final.length };
}

function findExistingStay(
  ledger: TaxLedgerEntry[],
  candidate: {
    slotId?: string;
    siteNumber?: number;
    siteLabel?: string;
    checkIn?: string;
    checkOut?: string;
    rentalType?: string;
    guestName?: string;
  }
): TaxLedgerEntry | undefined {
  return ledger.find(e => isSameStay(e, candidate));
}

/**
 * Remove daily/weekly tax ledger rows that belong to a cancelled reservation.
 * Call when a site is marked available, maintenance, or a tenant is removed.
 * Completed auto-expired stays should keep tax history — only explicit cancels use this.
 */
export function removeTaxLedgerMatching(criteria: {
  slotId?: string;
  siteNumber?: number;
  checkIn?: string | null;
  checkOut?: string | null;
  guestName?: string | null;
}): number {
  const ledger = loadLedger();
  if (!ledger.length) return 0;

  const ci = dateKey10(criteria.checkIn);
  const co = dateKey10(criteria.checkOut);
  const guest = (criteria.guestName || '').trim().toLowerCase();
  const slotId = criteria.slotId || '';
  const siteNumber =
    criteria.siteNumber != null && Number.isFinite(Number(criteria.siteNumber))
      ? Number(criteria.siteNumber)
      : null;

  if (!slotId && siteNumber == null && !guest && !ci) return 0;

  let removed = 0;
  const next = ledger.filter(e => {
    if (e.rentalType !== 'daily' && e.rentalType !== 'weekly') return true;

    const sameSlot =
      (!!slotId && e.slotId === slotId) ||
      (siteNumber != null && e.siteNumber === siteNumber);

    const sameGuest = guest && (e.guestName || '').trim().toLowerCase() === guest;
    const eIn = dateKey10(e.checkIn);
    const eOut = dateKey10(e.checkOut);

    let match = false;

    if (sameSlot && ci && co) {
      // Exact stay window, or same check-in on this site (checkout may have been edited)
      match = (eIn === ci && eOut === co) || eIn === ci;
    } else if (sameSlot && ci) {
      match = eIn === ci;
    } else if (sameSlot && !ci) {
      // Cleared without dates: drop open ledger rows for this site (optional guest filter)
      match = !guest || !!sameGuest;
    } else if (sameGuest && ci) {
      match = eIn === ci && (siteNumber == null || e.siteNumber === siteNumber || !e.siteNumber);
    }

    if (!match) return true;
    removed += 1;
    return false;
  });

  if (removed > 0) saveLedger(next);
  return removed;
}

/** Snapshot fields from a slot before clearing a reservation. */
export function removeTaxLedgerForSlotReservation(slot: {
  id?: string;
  number?: number;
  startDate?: string;
  endDate?: string;
  contactName?: string;
  tenantName?: string;
  rentalType?: string;
}): number {
  // Monthly stays are not on the tax ledger; still try if type is missing (phone/daily often set)
  if (slot.rentalType === 'monthly') return 0;
  return removeTaxLedgerMatching({
    slotId: slot.id,
    siteNumber: slot.number,
    checkIn: slot.startDate,
    checkOut: slot.endDate,
    guestName: slot.contactName || slot.tenantName,
  });
}

/**
 * When a Sites stay is daily/weekly with a payment method (paid), write/upgrade a
 * paid tax ledger row so it appears on the quarterly tax report.
 */
export function recordPaidSlotStayTax(slot: Slot): TaxLedgerEntry | null {
  const rentalType = slot.rentalType;
  if (rentalType !== 'daily' && rentalType !== 'weekly') return null;
  if (!slot.startDate || !slot.endDate) return null;
  if (slot.status !== 'reserved' && slot.status !== 'occupied') return null;
  if (!slot.paymentMethod?.trim()) return null;
  const guestName = (slot.contactName || slot.tenantName || '').trim();
  if (!guestName) return null;

  let checkIn: string;
  let checkOut: string;
  try {
    const ci = parseFlexibleDate(slot.startDate) || parseDateKey(String(slot.startDate).slice(0, 10));
    const co = parseFlexibleDate(slot.endDate) || parseDateKey(String(slot.endDate).slice(0, 10));
    if (!ci || !co || co <= ci) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    checkIn = `${ci.getFullYear()}-${pad(ci.getMonth() + 1)}-${pad(ci.getDate())}`;
    checkOut = `${co.getFullYear()}-${pad(co.getMonth() + 1)}-${pad(co.getDate())}`;
  } catch {
    return null;
  }

  const rates = getActiveRentalRates();
  const breakdown = calculateStayBreakdown(rentalType, parseDateKey(checkIn), parseDateKey(checkOut), rates);
  const grandFromSlot = Number(slot.rentAmount);
  let rentSubtotal = breakdown.subtotal;
  let stateTax = breakdown.stateTax;
  let countyTax = breakdown.countyTax;
  let grandTotal = breakdown.grandTotal;

  if (Number.isFinite(grandFromSlot) && grandFromSlot > 0 && Math.abs(grandFromSlot - breakdown.grandTotal) > 0.02) {
    const taxRate = (breakdown.stateTaxPercent + breakdown.countyTaxPercent) / 100;
    if (taxRate > 0) {
      rentSubtotal = money(grandFromSlot / (1 + taxRate));
      stateTax = money(rentSubtotal * (breakdown.stateTaxPercent / 100));
      countyTax = money(rentSubtotal * (breakdown.countyTaxPercent / 100));
      grandTotal = money(grandFromSlot);
    } else {
      rentSubtotal = money(grandFromSlot);
      stateTax = 0;
      countyTax = 0;
      grandTotal = money(grandFromSlot);
    }
  }

  return upsertTaxLedgerEntry({
    bookedAt: (slot.bookedAt || checkIn).slice(0, 10),
    checkIn,
    checkOut,
    rentalType,
    guestName,
    guestEmail: slot.contactEmail,
    guestPhone: slot.contactPhone,
    siteLabel: slot.label,
    siteNumber: slot.number,
    slotId: slot.id,
    paymentMethod: slot.paymentMethod,
    rentSubtotal,
    stateTax,
    countyTax,
    grandTotal,
    status: 'paid',
  });
}

/**
 * Pull daily/weekly stays still on slots into the ledger if missing
 * (uses current tax rates — marked estimated when unpaid; paid when paymentMethod set).
 */
export function syncTaxLedgerFromSlots(): { added: number; total: number; upgraded: number } {
  const rates = getActiveRentalRates();
  const ledger = loadLedger();
  let added = 0;
  let upgraded = 0;

  for (const slot of getSlots()) {
    const rentalType = slot.rentalType;
    if (rentalType !== 'daily' && rentalType !== 'weekly') continue;
    if (!slot.startDate || !slot.endDate) continue;
    if (!slot.bookedAt && !slot.contactName && !slot.tenantName) continue;

    let checkIn: string;
    let checkOut: string;
    try {
      const ci = parseFlexibleDate(slot.startDate) || parseDateKey(String(slot.startDate).slice(0, 10));
      const co = parseFlexibleDate(slot.endDate) || parseDateKey(String(slot.endDate).slice(0, 10));
      if (!ci || !co || co <= ci) continue;
      const pad = (n: number) => String(n).padStart(2, '0');
      checkIn = `${ci.getFullYear()}-${pad(ci.getMonth() + 1)}-${pad(ci.getDate())}`;
      checkOut = `${co.getFullYear()}-${pad(co.getMonth() + 1)}-${pad(co.getDate())}`;
    } catch {
      continue;
    }

    const paid = !!slot.paymentMethod?.trim();
    const bookedAt = (slot.bookedAt || checkIn).slice(0, 10);
    const existingIdx = ledger.findIndex(
      e =>
        (e.slotId === slot.id || e.siteNumber === slot.number) &&
        e.checkIn === checkIn &&
        e.checkOut === checkOut &&
        e.rentalType === rentalType
    );

    // Upgrade estimated → paid when Sites now has a payment method
    if (existingIdx >= 0) {
      if (paid && ledger[existingIdx].status === 'estimated') {
        try {
          recordPaidSlotStayTax(slot);
          upgraded += 1;
        } catch (err) {
          console.error('Tax upgrade from slot failed:', err);
        }
      }
      continue;
    }

    const breakdown = calculateStayBreakdown(rentalType, parseDateKey(checkIn), parseDateKey(checkOut), rates);
    const nights = calculateStayNights(parseDateKey(checkIn), parseDateKey(checkOut));
    const grandFromSlot = Number(slot.rentAmount);
    let entry: TaxLedgerEntry = {
      id: `tax_slot_${slot.id}_${checkIn}`,
      bookedAt,
      checkIn,
      checkOut,
      nights,
      rentalType,
      guestName: slot.contactName || slot.tenantName || 'Guest',
      guestEmail: slot.contactEmail,
      siteLabel: slot.label,
      siteNumber: slot.number,
      slotId: slot.id,
      paymentMethod: slot.paymentMethod,
      rentSubtotal: breakdown.subtotal,
      stateTaxPercent: breakdown.stateTaxPercent,
      countyTaxPercent: breakdown.countyTaxPercent,
      stateTax: breakdown.stateTax,
      countyTax: breakdown.countyTax,
      totalTax: breakdown.totalTax,
      grandTotal: breakdown.grandTotal,
      status: paid ? 'paid' : 'estimated',
      source: paid ? 'manual' : 'slot',
      createdAt: new Date().toISOString(),
    };

    // If stored total differs from computed, scale tax from current rates onto stored total when possible
    if (Number.isFinite(grandFromSlot) && grandFromSlot > 0 && Math.abs(grandFromSlot - breakdown.grandTotal) > 0.02) {
      const taxRate =
        (breakdown.stateTaxPercent + breakdown.countyTaxPercent) / 100;
      if (taxRate > 0 && rentalType !== 'monthly') {
        const rent = money(grandFromSlot / (1 + taxRate));
        const stateTax = money(rent * (breakdown.stateTaxPercent / 100));
        const countyTax = money(rent * (breakdown.countyTaxPercent / 100));
        entry = {
          ...entry,
          rentSubtotal: rent,
          stateTax,
          countyTax,
          totalTax: money(stateTax + countyTax),
          grandTotal: money(grandFromSlot),
        };
      } else {
        entry = {
          ...entry,
          rentSubtotal: money(grandFromSlot),
          stateTax: 0,
          countyTax: 0,
          totalTax: 0,
          grandTotal: money(grandFromSlot),
        };
      }
    }

    ledger.push(entry);
    added += 1;
  }

  if (added > 0) saveLedger(ledger);
  return { added, upgraded, total: loadLedger().length };
}

/** True when a ledger row is a real booked stay (not a slot estimate). */
export function isBookedTaxEntry(e: TaxLedgerEntry): boolean {
  if (e.rentalType !== 'daily' && e.rentalType !== 'weekly') return false;
  // Estimated auto-pulled site stays never appear on the tax summary
  if (e.status === 'estimated') return false;
  // Unpaid slot sync rows stay hidden; paid stays from Sites (even if source was slot) count
  if (e.source === 'slot' && e.status !== 'paid') return false;
  // Paid website bookings, phone bookings, Sites paid stays, and admin guest receipts
  return e.status === 'paid' || e.source === 'booking' || e.source === 'manual';
}

/**
 * Drop estimated / slot-synced rows so the ledger only keeps booked tax records.
 * Guest-receipt list can still rebuild estimates via sync if needed elsewhere.
 */
export function purgeEstimatedTaxLedgerEntries(): { removed: number; total: number } {
  const ledger = loadLedger();
  const next = ledger.filter(
    e => e.status !== 'estimated' && e.source !== 'slot'
  );
  const removed = ledger.length - next.length;
  if (removed > 0) saveLedger(next);
  return { removed, total: next.length };
}

export function getQuarterlyTaxReport(year: number, quarter: 1 | 2 | 3 | 4): QuarterlyTaxReport {
  // Collapse accidental double writes (e.g. guest receipt saved twice)
  try {
    dedupeTaxLedgerEntries();
  } catch {
    /* ignore */
  }
  // Do not import estimated site stays — tax summary is booked/paid only
  const { start, end, startDate, endDate, label } = quarterRange(year, quarter);
  const rates = getActiveRentalRates();
  const entries = loadLedger()
    .filter(
      e =>
        isBookedTaxEntry(e) &&
        inRange(e.bookedAt || e.checkIn, start, end)
    )
    .sort((a, b) => (a.bookedAt || a.checkIn).localeCompare(b.bookedAt || b.checkIn));

  const summary = {
    bookingCount: entries.length,
    dailyCount: entries.filter(e => e.rentalType === 'daily').length,
    weeklyCount: entries.filter(e => e.rentalType === 'weekly').length,
    rentSubtotal: money(entries.reduce((s, e) => s + (e.rentSubtotal || 0), 0)),
    stateTax: money(entries.reduce((s, e) => s + (e.stateTax || 0), 0)),
    countyTax: money(entries.reduce((s, e) => s + (e.countyTax || 0), 0)),
    totalTax: money(entries.reduce((s, e) => s + (e.totalTax || 0), 0)),
    grandTotal: money(entries.reduce((s, e) => s + (e.grandTotal || 0), 0)),
  };

  return {
    year,
    quarter,
    label,
    startDate,
    endDate,
    taxRates: {
      stateTransientTaxPercent: rates.stateTransientTaxPercent ?? 0,
      countyTransientTaxPercent: rates.countyTransientTaxPercent ?? 0,
    },
    entries,
    summary,
  };
}

export function listTaxLedgerYears(): number[] {
  const years = new Set<number>();
  const now = new Date().getFullYear();
  years.add(now);
  years.add(now - 1);
  for (const e of loadLedger()) {
    const y = Number((e.bookedAt || e.checkIn || '').slice(0, 4));
    if (y >= 2020 && y <= now + 1) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}
