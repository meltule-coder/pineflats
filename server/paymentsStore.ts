import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  TenantPayment, PaymentRecord, MeterRecord, ExtraCharge, PaymentCredit, RentalType,
  SavedPaymentCard, StoredPaymentCard
} from '../types';
import { rentAmountForType, prorateMonthlyRent } from '../rentUtils';
import { getTenant } from './tenantsStore';
import { getActiveRentalRates } from './propertiesStore';
import {
  encryptSensitive, decryptSensitive, sanitizeToLast4, detectCardBrandFromLast4Only
} from './cardSecurity';

const DATA_DIR = path.join(process.cwd(), 'data');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const KWH_RATE = 0.24;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadAll(): Record<string, TenantPayment> {
  ensureDataDir();
  if (!fs.existsSync(PAYMENTS_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8'));
}

/** Sum of all payment records for a tenant (lifetime running total). */
export function getTotalPaidForTenant(tenantId: string): number {
  const payment = loadAll()[tenantId];
  if (!payment?.records?.length) return 0;
  const total = payment.records.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  return Math.round(total * 100) / 100;
}

/** Lifetime totals for every tenant that has payment data. */
export function getAllPaymentTotals(): Record<string, number> {
  const all = loadAll();
  const totals: Record<string, number> = {};
  for (const [tenantId, payment] of Object.entries(all)) {
    const total = (payment.records ?? []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    totals[tenantId] = Math.round(total * 100) / 100;
  }
  return totals;
}

function saveAll(data: Record<string, TenantPayment>) {
  ensureDataDir();
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(data, null, 2));
}

function resolveRentalType(tenantId: string, payment?: TenantPayment): RentalType {
  if (payment?.rentalType) return payment.rentalType;
  const tenant = getTenant(tenantId);
  if (tenant?.rentalType) return tenant.rentalType;
  return 'monthly';
}

/** Billing period key for a rental type (monthly = YYYY-MM, weekly = YYYY-Www, daily = YYYY-MM-DD) */
export function billingPeriodKey(rentalType: RentalType, date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (rentalType === 'daily') return `${y}-${m}-${d}`;
  if (rentalType === 'weekly') {
    // ISO week number
    const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
  return `${y}-${m}`;
}

function applyMonthlyProration(tenantId: string, payment: TenantPayment): TenantPayment {
  const rentalType = resolveRentalType(tenantId, payment);
  if (rentalType !== 'monthly') {
    const { rentProration: _drop, ...rest } = payment as TenantPayment & { rentProration?: unknown };
    return {
      ...rest,
      rentalType,
      rentAmount: resolveNonMonthlyRent(payment, tenantId, rentalType),
    };
  }

  const tenant = getTenant(tenantId);
  const activeRates = getActiveRentalRates();
  const baseMonthlyRate =
    payment.baseMonthlyRate
    ?? (payment as TenantPayment & { monthlyRate?: number }).monthlyRate
    ?? activeRates.monthly;

  // Current billing window (YYYY-MM) — not the tenant's original move-in month
  const period =
    (payment.billingPeriod && /^\d{4}-\d{2}$/.test(payment.billingPeriod)
      ? payment.billingPeriod
      : null)
    || billingPeriodKey('monthly');

  let userStart = payment.rentChargeStart || undefined;
  let userEnd = payment.rentChargeEnd || undefined;
  const tenantStart = tenant?.startDate || undefined;
  const tenantEnd =
    tenant?.endDate && tenant.endDate !== 'ongoing' ? tenant.endDate : undefined;

  // Ignore stale charge dates outside this billing window (from older auto-expand logic)
  if (userStart && userEnd) {
    const probe = prorateMonthlyRent({
      monthlyRate: baseMonthlyRate,
      startDate: userStart,
      endDate: userEnd,
      billingPeriod: period,
      mode: 'range',
    });
    const [py, pm] = period.split('-').map(Number);
    const winStart = new Date(py, pm - 1, 1);
    const winEnd = new Date(py, pm, 0); // last calendar day of billing month
    const cs = new Date(probe.chargeStart + 'T12:00:00');
    const ce = new Date(probe.chargeEnd + 'T12:00:00');
    if (ce < winStart || cs > winEnd) {
      userStart = undefined;
      userEnd = undefined;
    }
  }

  // Both user charge dates in this window → exact range. Else clip stay into 30-day window.
  const explicitRange = !!(userStart && userEnd);
  const startDate = userStart || tenantStart;
  // Ongoing tenants must use window mode so mid-period move-in is prorated
  const endDate = explicitRange ? userEnd : tenantEnd;

  const proration = prorateMonthlyRent({
    monthlyRate: baseMonthlyRate,
    startDate,
    endDate,
    billingPeriod: period,
    mode: explicitRange ? 'range' : 'window',
  });

  return {
    ...payment,
    tenantId,
    rentalType: 'monthly',
    baseMonthlyRate,
    // Keep user-set dates only — do not auto-write a 30-day span that locks rent at $750
    rentChargeStart: payment.rentChargeStart,
    rentChargeEnd: payment.rentChargeEnd,
    rentAmount: proration.amount,
    rentProration: {
      fullRate: proration.fullRate,
      dailyRate: proration.dailyRate,
      daysCharged: proration.daysCharged,
      billableDays: proration.billableDays,
      extraDaysFor31DayMonth: proration.extraDaysFor31DayMonth,
      daysInPeriod: proration.daysInPeriod,
      prorated: proration.prorated,
      chargeStart: proration.chargeStart,
      chargeEnd: proration.chargeEnd,
    },
  };
}

function defaultPayment(tenantId: string): TenantPayment {
  const rentalType = resolveRentalType(tenantId);
  const period = billingPeriodKey(rentalType);
  const base: TenantPayment = {
    tenantId,
    rentalType,
    rentAmount: rentAmountForType(rentalType, new Date(), getActiveRentalRates()),
    baseMonthlyRate: rentalType === 'monthly' ? getActiveRentalRates().monthly : undefined,
    currentReadingTotal: 0,
    baselineCredit: 0,
    balanceDue: 0,
    previousMeterReading: 0,
    records: [],
    meterRecords: [],
    extraCharges: [],
    credits: [],
    savedCards: [],
    billingPeriod: period,
    carriedBalance: 0,
    paymentBaseline: 0,
  };
  return applyMonthlyProration(tenantId, base);
}

function isStoredCard(card: SavedPaymentCard | StoredPaymentCard): card is StoredPaymentCard {
  return typeof (card as StoredPaymentCard).sealed === 'string' && !!(card as StoredPaymentCard).sealed;
}

/** Decrypt / migrate a single card for API responses (never includes full PAN). */
export function toPublicCard(card: SavedPaymentCard | StoredPaymentCard): SavedPaymentCard | null {
  if (isStoredCard(card)) {
    const payload = decryptSensitive(card.sealed);
    if (payload) {
      return {
        id: card.id,
        brand: card.brand || 'Card',
        isDefault: card.isDefault,
        createdAt: card.createdAt,
        cardholderName: payload.cardholderName,
        last4: payload.last4,
        expMonth: payload.expMonth,
        expYear: payload.expYear,
        billingZip: payload.billingZip,
        label: payload.label,
        notes: payload.notes,
      };
    }
    // Broken seal — try legacy plaintext fields on same object
  }

  const legacy = card as SavedPaymentCard & Partial<StoredPaymentCard>;
  if (legacy.last4 && legacy.cardholderName && legacy.expMonth && legacy.expYear) {
    return {
      id: legacy.id,
      brand: legacy.brand || 'Card',
      isDefault: legacy.isDefault,
      createdAt: legacy.createdAt,
      cardholderName: legacy.cardholderName,
      last4: sanitizeToLast4(legacy.last4) || legacy.last4.slice(-4),
      expMonth: legacy.expMonth,
      expYear: legacy.expYear,
      billingZip: legacy.billingZip,
      label: legacy.label,
      notes: legacy.notes,
    };
  }
  return null;
}

/** Map stored cards to safe public view; drops undecryptable records. */
export function publicSavedCards(
  cards: Array<SavedPaymentCard | StoredPaymentCard> | undefined
): SavedPaymentCard[] {
  if (!cards?.length) return [];
  return cards.map(toPublicCard).filter((c): c is SavedPaymentCard => !!c);
}

/** Re-encrypt legacy plaintext cards on disk when possible. */
function migrateCardsToEncrypted(
  cards: Array<SavedPaymentCard | StoredPaymentCard>
): { cards: StoredPaymentCard[]; changed: boolean } {
  let changed = false;
  const out: StoredPaymentCard[] = [];
  for (const card of cards) {
    if (isStoredCard(card) && card.sealed.startsWith('enc:v1:')) {
      out.push({
        id: card.id,
        brand: card.brand || 'Card',
        isDefault: card.isDefault,
        createdAt: card.createdAt,
        sealed: card.sealed,
      });
      continue;
    }
    const pub = toPublicCard(card);
    if (!pub) continue;
    changed = true;
    out.push({
      id: pub.id,
      brand: pub.brand || 'Card',
      isDefault: pub.isDefault,
      createdAt: pub.createdAt,
      sealed: encryptSensitive({
        cardholderName: pub.cardholderName,
        last4: pub.last4,
        expMonth: pub.expMonth,
        expYear: pub.expYear,
        billingZip: pub.billingZip,
        label: pub.label,
        notes: pub.notes,
      }),
    });
  }
  return { cards: out, changed };
}

export function addSavedCard(
  tenantId: string,
  input: {
    cardholderName: string;
    /** @deprecated Prefer last4 only — full PAN is discarded immediately */
    cardNumber?: string;
    last4?: string;
    brand?: string;
    expMonth: string;
    expYear: string;
    billingZip?: string;
    label?: string;
    notes?: string;
    isDefault?: boolean;
  }
): TenantPayment | null {
  const name = (input.cardholderName || '').trim();
  if (!name) return null;

  // Security: only last 4 digits ever retained (full PAN discarded)
  const last4 = sanitizeToLast4(String(input.last4 || input.cardNumber || ''));
  if (!last4) return null;

  const expMonth = String(input.expMonth || '').padStart(2, '0');
  const expYearRaw = String(input.expYear || '').trim();
  if (!/^\d{2}$/.test(expMonth) || Number(expMonth) < 1 || Number(expMonth) > 12) return null;
  if (!/^\d{2,4}$/.test(expYearRaw)) return null;
  const expYear = expYearRaw.length === 2 ? `20${expYearRaw}` : expYearRaw;

  // Reject obvious CVV-sized input mistakes (3–4 digit only year/etc handled above)
  // Never store CVV — field is not accepted

  const all = loadAll();
  const current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const migrated = migrateCardsToEncrypted((current.savedCards ?? []) as Array<SavedPaymentCard | StoredPaymentCard>);
  let cards = migrated.cards;
  const makeDefault = input.isDefault || cards.length === 0;
  if (makeDefault) {
    cards = cards.map(c => ({ ...c, isDefault: false }));
  }

  const brand = detectCardBrandFromLast4Only(last4, input.brand);
  const sealed = encryptSensitive({
    cardholderName: name,
    last4,
    expMonth,
    expYear,
    billingZip: (input.billingZip || '').trim() || undefined,
    label: (input.label || '').trim() || undefined,
    notes: (input.notes || '').trim() || undefined,
  });

  const stored: StoredPaymentCard = {
    id: `card-${Date.now()}-${cryptoRandomId()}`,
    brand,
    isDefault: makeDefault,
    createdAt: new Date().toISOString().split('T')[0],
    sealed,
  };

  cards.push(stored);
  const next: TenantPayment = { ...current, tenantId, savedCards: cards };
  next.balanceDue = recomputeBalanceDue(tenantId, next);
  all[tenantId] = next;
  saveAll(all);
  return withPublicCards(all[tenantId]);
}

function cryptoRandomId(): string {
  return crypto.randomBytes(4).toString('hex');
}

/** Attach decrypted public cards for API responses (mutates a copy). */
export function withPublicCards(payment: TenantPayment): TenantPayment {
  return {
    ...payment,
    savedCards: publicSavedCards(payment.savedCards as Array<SavedPaymentCard | StoredPaymentCard>),
  };
}

export function updateSavedCard(
  tenantId: string,
  cardId: string,
  updates: Partial<Pick<SavedPaymentCard, 'label' | 'cardholderName' | 'brand' | 'expMonth' | 'expYear' | 'billingZip' | 'notes' | 'isDefault'>>
    & { last4?: string }
): TenantPayment | null {
  const all = loadAll();
  const current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const migrated = migrateCardsToEncrypted((current.savedCards ?? []) as Array<SavedPaymentCard | StoredPaymentCard>);
  let cards = migrated.cards;
  const index = cards.findIndex(c => c.id === cardId);
  if (index === -1) return null;

  const existingPublic = toPublicCard(cards[index]);
  if (!existingPublic) return null;

  let last4 = existingPublic.last4;
  if (updates.last4 !== undefined) {
    const normalized = sanitizeToLast4(String(updates.last4));
    if (!normalized) return null;
    last4 = normalized;
  }

  let expMonth = existingPublic.expMonth;
  if (updates.expMonth !== undefined) {
    expMonth = String(updates.expMonth).padStart(2, '0');
    if (!/^\d{2}$/.test(expMonth) || Number(expMonth) < 1 || Number(expMonth) > 12) return null;
  }

  let expYear = existingPublic.expYear;
  if (updates.expYear !== undefined) {
    const y = String(updates.expYear).trim();
    if (!/^\d{2,4}$/.test(y)) return null;
    expYear = y.length === 2 ? `20${y}` : y;
  }

  if (updates.isDefault) {
    cards = cards.map(c => ({ ...c, isDefault: false }));
  }

  const brand =
    updates.brand !== undefined
      ? (updates.brand.trim() || existingPublic.brand)
      : existingPublic.brand;

  cards[index] = {
    id: cards[index].id,
    brand,
    isDefault: updates.isDefault ? true : cards[index].isDefault,
    createdAt: cards[index].createdAt,
    sealed: encryptSensitive({
      cardholderName:
        updates.cardholderName !== undefined
          ? updates.cardholderName.trim() || existingPublic.cardholderName
          : existingPublic.cardholderName,
      last4,
      expMonth,
      expYear,
      billingZip:
        updates.billingZip !== undefined
          ? (updates.billingZip.trim() || undefined)
          : existingPublic.billingZip,
      label:
        updates.label !== undefined
          ? (updates.label.trim() || undefined)
          : existingPublic.label,
      notes:
        updates.notes !== undefined
          ? (updates.notes.trim() || undefined)
          : existingPublic.notes,
    }),
  };

  if (!cards.some(c => c.isDefault) && cards.length > 0) {
    cards[0] = { ...cards[0], isDefault: true };
  }

  const next: TenantPayment = { ...current, tenantId, savedCards: cards };
  next.balanceDue = recomputeBalanceDue(tenantId, next);
  all[tenantId] = next;
  saveAll(all);
  return withPublicCards(all[tenantId]);
}

export function deleteSavedCard(tenantId: string, cardId: string): TenantPayment | null {
  const all = loadAll();
  const current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const before = current.savedCards ?? [];
  let cards = (before as StoredPaymentCard[]).filter(c => c.id !== cardId);
  if (cards.length === before.length) return null;
  if (cards.length > 0 && !cards.some(c => c.isDefault)) {
    cards = cards.map((c, i) => ({ ...c, isDefault: i === 0 }));
  }
  const next: TenantPayment = { ...current, tenantId, savedCards: cards };
  next.balanceDue = recomputeBalanceDue(tenantId, next);
  all[tenantId] = next;
  saveAll(all);
  return withPublicCards(all[tenantId]);
}

function resolveNonMonthlyRent(
  payment: TenantPayment & { monthlyRate?: number },
  tenantId: string,
  rentalType: RentalType
): number {
  if (payment.rentAmount != null && rentalType !== 'monthly') return payment.rentAmount;
  if (payment.monthlyRate != null) return payment.monthlyRate;
  return rentAmountForType(rentalType);
}

function resolveRentAmount(payment: TenantPayment & { monthlyRate?: number }, tenantId: string): number {
  const rentalType = resolveRentalType(tenantId, payment);
  if (rentalType === 'monthly') {
    // Prefer already-prorated rentAmount after applyMonthlyProration
    if (payment.rentAmount != null && payment.rentProration) return payment.rentAmount;
    const tenant = getTenant(tenantId);
    const base = payment.baseMonthlyRate ?? payment.monthlyRate ?? getActiveRentalRates().monthly;
    const userStart = payment.rentChargeStart || undefined;
    const userEnd = payment.rentChargeEnd || undefined;
    return prorateMonthlyRent({
      monthlyRate: base,
      startDate: userStart || tenant?.startDate,
      endDate: userEnd || (tenant?.endDate !== 'ongoing' ? tenant?.endDate : undefined),
      billingPeriod:
        (payment.billingPeriod && /^\d{4}-\d{2}$/.test(payment.billingPeriod) ? payment.billingPeriod : null)
        || undefined,
      mode: userStart && userEnd ? 'range' : 'window',
    }).amount;
  }
  return resolveNonMonthlyRent(payment, tenantId, rentalType);
}

function resolveCurrentReadingTotal(payment: TenantPayment): number {
  if (payment.currentReadingTotal != null) return payment.currentReadingTotal;
  const meterRecords = payment.meterRecords ?? [];
  if (meterRecords.length > 0) return meterRecords[0].usage;
  return 0;
}

function getEffectivePreviousReading(payment: TenantPayment): number {
  const meterRecords = payment.meterRecords ?? [];
  if (meterRecords.length > 0) return meterRecords[0].reading;
  return payment.previousMeterReading ?? 0;
}

export function syncPreviousMeterReading(payment: TenantPayment): TenantPayment {
  const meterRecords = payment.meterRecords ?? [];
  if (meterRecords.length === 0) return payment;
  return { ...payment, previousMeterReading: meterRecords[0].reading };
}

function totalPaidAll(records: PaymentRecord[]): number {
  return records.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

/** Payments that apply to the current billing period only */
function periodPaymentsTotal(payment: TenantPayment): number {
  const period = payment.billingPeriod ?? '';
  const records = payment.records ?? [];

  // Monthly period key "YYYY-MM" — only count payments dated in that month
  if (period && /^\d{4}-\d{2}$/.test(period)) {
    return records
      .filter((r) => (r.date || '').startsWith(period))
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }

  // Fallback: payments since last period baseline
  const all = totalPaidAll(records);
  const baseline = payment.paymentBaseline ?? 0;
  return Math.max(0, all - baseline);
}

/** All extra charges are part of current period charges / balance due */
function periodExtraChargesTotal(payment: TenantPayment): number {
  return (payment.extraCharges ?? []).reduce(
    (sum, c) => sum + (Number(c.amount) || 0),
    0
  );
}

function periodCreditsTotal(payment: TenantPayment): number {
  return (payment.credits ?? []).reduce(
    (sum, c) => sum + (Number(c.amount) || 0),
    0
  );
}

/** Current-period charges only: rent + utilities + extra charges (no carried balance). */
function computePeriodCharges(payment: TenantPayment, tenantId: string): number {
  const rent = resolveRentAmount(payment, tenantId);
  const usage = resolveCurrentReadingTotal(payment);
  const baseline = payment.baselineCredit ?? 0;
  const netKwh = Math.max(0, usage - baseline);
  const extras = periodExtraChargesTotal(payment);
  return rent + netKwh * KWH_RATE + extras;
}

/**
 * Balance due = carried balance + period charges − credits − payments this period.
 * Period charges are rent + utilities + extra charges only.
 */
function recomputeBalanceDue(tenantId: string, payment: TenantPayment): number {
  const periodCharges = computePeriodCharges({ ...payment, tenantId }, tenantId);
  const carried = payment.carriedBalance ?? 0;
  const credits = periodCreditsTotal(payment);
  const paid = periodPaymentsTotal(payment);
  return Math.max(0, Math.round((carried + periodCharges - credits - paid) * 100) / 100);
}

/**
 * Roll into a new billing period.
 * If previous period balance was paid (≤ 0), carried balance starts at 0.
 * If unpaid, that amount carries forward (including any unpaid extra charges).
 * Utilities usage resets; extra charges list is cleared for the new month.
 */
export function startNewBillingPeriod(
  tenantId: string,
  payment: TenantPayment,
  options?: { force?: boolean; asOf?: Date }
): TenantPayment {
  const rentalType = resolveRentalType(tenantId, payment);
  const asOf = options?.asOf ?? new Date();
  const nextPeriod = billingPeriodKey(rentalType, asOf);
  const currentPeriod = payment.billingPeriod ?? nextPeriod;

  if (!options?.force && currentPeriod === nextPeriod && payment.billingPeriod) {
    return {
      ...payment,
      balanceDue: recomputeBalanceDue(tenantId, payment),
    };
  }

  // Settle current period balance before rolling (includes extra charges)
  const settled = { ...payment, tenantId };
  const endingBalance = recomputeBalanceDue(tenantId, settled);

  // Paid in full → start new period with zero carried balance
  // Unpaid → carry the remaining balance forward (extras included in that total)
  const carriedBalance = endingBalance > 0.009 ? endingBalance : 0;

  const allPaid = totalPaidAll(payment.records ?? []);

  let next: TenantPayment = {
    ...payment,
    tenantId,
    rentalType,
    baseMonthlyRate: payment.baseMonthlyRate ?? (rentalType === 'monthly' ? getActiveRentalRates().monthly : payment.baseMonthlyRate),
    billingPeriod: nextPeriod,
    carriedBalance,
    paymentBaseline: allPaid,
    // Fresh utility usage for the new period; keep last meter as previous reading
    currentReadingTotal: 0,
    baselineCredit: payment.baselineCredit ?? 0,
    previousMeterReading: getEffectivePreviousReading(payment),
    records: payment.records ?? [],
    meterRecords: payment.meterRecords ?? [],
    // Extra charges and credits do not roll into the new month as line items
    extraCharges: [],
    credits: [],
    // Clear proration date overrides so new month starts clean
    rentChargeStart: undefined,
    rentChargeEnd: undefined,
  };
  next = applyMonthlyProration(tenantId, next);
  next.balanceDue = recomputeBalanceDue(tenantId, next);
  return next;
}

/** Ensure billing period is current; auto-roll when the calendar period changes */
function ensureCurrentPeriod(tenantId: string, payment: TenantPayment): TenantPayment {
  const rentalType = resolveRentalType(tenantId, payment);
  const nowKey = billingPeriodKey(rentalType);

  if (!payment.billingPeriod) {
    // First-time: do not wipe history — baseline so current all-time math is preserved
    // until the next natural period change.
    const withPeriod: TenantPayment = {
      ...payment,
      tenantId,
      rentalType,
      billingPeriod: nowKey,
      carriedBalance: payment.carriedBalance ?? 0,
      paymentBaseline: payment.paymentBaseline ?? 0,
    };
    withPeriod.balanceDue = recomputeBalanceDue(tenantId, withPeriod);
    return withPeriod;
  }

  if (payment.billingPeriod !== nowKey) {
    return startNewBillingPeriod(tenantId, payment, { force: true });
  }

  return {
    ...payment,
    tenantId,
    rentalType,
    balanceDue: recomputeBalanceDue(tenantId, payment),
  };
}

export function deleteTenantPayment(tenantId: string): boolean {
  const all = loadAll();
  if (!(tenantId in all)) return false;
  delete all[tenantId];
  saveAll(all);
  return true;
}

export function getTenantPayment(tenantId: string): TenantPayment {
  const all = loadAll();
  if (!all[tenantId]) {
    all[tenantId] = defaultPayment(tenantId);
    saveAll(all);
  }
  const payment = all[tenantId];
  const synced = syncPreviousMeterReading(payment);
  const rentalType = resolveRentalType(tenantId, synced);
  let updated: TenantPayment = {
    ...synced,
    rentalType,
    baseMonthlyRate:
      synced.baseMonthlyRate
      ?? (rentalType === 'monthly'
        ? (() => {
            const monthly = getActiveRentalRates().monthly;
            return synced.rentAmount && synced.rentAmount >= monthly ? synced.rentAmount : monthly;
          })()
        : undefined),
    currentReadingTotal: resolveCurrentReadingTotal(synced),
    baselineCredit: synced.baselineCredit ?? 0,
    previousMeterReading: synced.previousMeterReading ?? 0,
    meterRecords: synced.meterRecords ?? [],
    extraCharges: synced.extraCharges ?? [],
    credits: synced.credits ?? [],
    savedCards: synced.savedCards ?? [],
    carriedBalance: synced.carriedBalance ?? 0,
    paymentBaseline: synced.paymentBaseline ?? 0,
  };
  updated = ensureCurrentPeriod(tenantId, updated);
  updated = applyMonthlyProration(tenantId, updated);
  updated.balanceDue = recomputeBalanceDue(tenantId, updated);

  // Migrate legacy plaintext cards to encrypted storage when loaded
  const mig = migrateCardsToEncrypted(
    (updated.savedCards ?? []) as Array<SavedPaymentCard | StoredPaymentCard>
  );
  if (mig.changed) {
    updated = { ...updated, savedCards: mig.cards };
  }

  all[tenantId] = updated;
  saveAll(all);
  return withPublicCards(updated);
}

export function updateTenantPayment(tenantId: string, updates: Partial<TenantPayment>): TenantPayment {
  const all = loadAll();
  const current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const rentalType = resolveRentalType(tenantId, { ...current, ...updates });

  const {
    rentAmount: updateRentAmount,
    baseMonthlyRate: updateBaseRate,
    rentChargeStart: updateChargeStart,
    rentChargeEnd: updateChargeEnd,
    records: updateRecords,
    meterRecords: updateMeters,
    balanceDue: _ignoreClientBalance,
    rentProration: _ignoreProration,
    savedCards: _ignoreClientCards, // never accept card data from generic PUT
    ...restUpdates
  } = updates;

  let merged: TenantPayment = {
    ...current,
    ...restUpdates,
    tenantId,
    records: updateRecords ?? current.records,
    meterRecords: updateMeters ?? current.meterRecords ?? [],
    extraCharges: updates.extraCharges ?? current.extraCharges ?? [],
    credits: updates.credits ?? current.credits ?? [],
    // Cards only via dedicated secure endpoints
    savedCards: current.savedCards ?? [],
  };

  if (rentalType === 'monthly') {
    const nextBase =
      updateBaseRate != null
        ? Number(updateBaseRate)
        : updateRentAmount != null
          ? Number(updateRentAmount)
          : (current.baseMonthlyRate ?? getActiveRentalRates().monthly);
    merged.baseMonthlyRate = nextBase;
    if (updateChargeStart !== undefined) {
      merged.rentChargeStart = updateChargeStart ? String(updateChargeStart) : undefined;
    }
    if (updateChargeEnd !== undefined) {
      merged.rentChargeEnd = updateChargeEnd ? String(updateChargeEnd) : undefined;
    }
    merged = applyMonthlyProration(tenantId, merged);
  } else if (updateRentAmount != null) {
    merged.rentAmount = Number(updateRentAmount);
  }

  merged.balanceDue = recomputeBalanceDue(tenantId, merged);
  all[tenantId] = merged;
  saveAll(all);
  return withPublicCards(all[tenantId]);
}

export function startNewMonth(tenantId: string): TenantPayment {
  const all = loadAll();
  const current = all[tenantId] ?? defaultPayment(tenantId);
  const next = startNewBillingPeriod(tenantId, current, { force: true });
  all[tenantId] = next;
  saveAll(all);
  return next;
}

export function addPaymentRecord(
  tenantId: string,
  record: Omit<PaymentRecord, 'id'>
): TenantPayment {
  const all = loadAll();
  let current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const newRecord: PaymentRecord = { ...record, id: `pay-${Date.now()}` };
  const records = [newRecord, ...current.records];
  current = { ...current, records };
  current.balanceDue = recomputeBalanceDue(tenantId, current);
  all[tenantId] = current;
  saveAll(all);
  return all[tenantId];
}

export function updatePaymentRecord(
  tenantId: string,
  recordId: string,
  updates: Partial<Omit<PaymentRecord, 'id'>>
): TenantPayment | null {
  const all = loadAll();
  let current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const index = current.records.findIndex((r) => r.id === recordId);
  if (index === -1) return null;

  const amount = updates.amount !== undefined ? Number(updates.amount) : current.records[index].amount;
  if (!amount || amount <= 0 || Number.isNaN(amount)) return null;

  const next: PaymentRecord = {
    ...current.records[index],
    ...updates,
    id: recordId,
    amount,
    date: updates.date !== undefined ? String(updates.date) : current.records[index].date,
    method: updates.method !== undefined ? String(updates.method) : current.records[index].method,
    note: updates.note !== undefined ? String(updates.note) : current.records[index].note,
  };

  const records = [...current.records];
  records[index] = next;
  current = { ...current, records };
  current.balanceDue = recomputeBalanceDue(tenantId, current);
  all[tenantId] = current;
  saveAll(all);
  return all[tenantId];
}

export function deletePaymentRecord(tenantId: string, recordId: string): TenantPayment | null {
  const all = loadAll();
  let current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  if (!current.records.some((r) => r.id === recordId)) return null;
  const records = current.records.filter((r) => r.id !== recordId);
  current = { ...current, records };
  current.balanceDue = recomputeBalanceDue(tenantId, current);
  all[tenantId] = current;
  saveAll(all);
  return all[tenantId];
}

export function addExtraCharge(
  tenantId: string,
  charge: Omit<ExtraCharge, 'id'>
): TenantPayment {
  const all = loadAll();
  let current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const amount = Number(charge.amount);
  if (!amount || amount <= 0 || Number.isNaN(amount)) {
    throw new Error('Invalid charge amount');
  }
  const description = String(charge.description || '').trim();
  if (!description) {
    throw new Error('Description is required');
  }
  const newCharge: ExtraCharge = {
    id: `chg-${Date.now()}`,
    date: charge.date || new Date().toISOString().split('T')[0],
    amount,
    description,
    note: charge.note ? String(charge.note) : undefined,
  };
  const extraCharges = [newCharge, ...(current.extraCharges ?? [])];
  current = { ...current, extraCharges };
  current.balanceDue = recomputeBalanceDue(tenantId, current);
  all[tenantId] = current;
  saveAll(all);
  return all[tenantId];
}

export function updateExtraCharge(
  tenantId: string,
  chargeId: string,
  updates: Partial<Omit<ExtraCharge, 'id'>>
): TenantPayment | null {
  const all = loadAll();
  let current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const charges = [...(current.extraCharges ?? [])];
  const index = charges.findIndex((c) => c.id === chargeId);
  if (index === -1) return null;

  const amount = updates.amount !== undefined ? Number(updates.amount) : charges[index].amount;
  if (!amount || amount <= 0 || Number.isNaN(amount)) return null;
  const description =
    updates.description !== undefined
      ? String(updates.description).trim()
      : charges[index].description;
  if (!description) return null;

  charges[index] = {
    ...charges[index],
    amount,
    description,
    date: updates.date !== undefined ? String(updates.date) : charges[index].date,
    note: updates.note !== undefined ? String(updates.note) : charges[index].note,
  };
  current = { ...current, extraCharges: charges };
  current.balanceDue = recomputeBalanceDue(tenantId, current);
  all[tenantId] = current;
  saveAll(all);
  return all[tenantId];
}

export function deleteExtraCharge(tenantId: string, chargeId: string): TenantPayment | null {
  const all = loadAll();
  let current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const charges = current.extraCharges ?? [];
  if (!charges.some((c) => c.id === chargeId)) return null;
  current = {
    ...current,
    extraCharges: charges.filter((c) => c.id !== chargeId),
  };
  current.balanceDue = recomputeBalanceDue(tenantId, current);
  all[tenantId] = current;
  saveAll(all);
  return all[tenantId];
}

export function addCredit(
  tenantId: string,
  credit: Omit<PaymentCredit, 'id'>
): TenantPayment {
  const all = loadAll();
  let current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const amount = Number(credit.amount);
  if (!amount || amount <= 0 || Number.isNaN(amount)) {
    throw new Error('Invalid credit amount');
  }
  const description = String(credit.description || '').trim();
  if (!description) {
    throw new Error('Description is required');
  }
  const newCredit: PaymentCredit = {
    id: `crd-${Date.now()}`,
    date: credit.date || new Date().toISOString().split('T')[0],
    amount,
    description,
    note: credit.note ? String(credit.note) : undefined,
  };
  const credits = [newCredit, ...(current.credits ?? [])];
  current = { ...current, credits };
  current.balanceDue = recomputeBalanceDue(tenantId, current);
  all[tenantId] = current;
  saveAll(all);
  return all[tenantId];
}

export function updateCredit(
  tenantId: string,
  creditId: string,
  updates: Partial<Omit<PaymentCredit, 'id'>>
): TenantPayment | null {
  const all = loadAll();
  let current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const credits = [...(current.credits ?? [])];
  const index = credits.findIndex((c) => c.id === creditId);
  if (index === -1) return null;

  const amount = updates.amount !== undefined ? Number(updates.amount) : credits[index].amount;
  if (!amount || amount <= 0 || Number.isNaN(amount)) return null;
  const description =
    updates.description !== undefined
      ? String(updates.description).trim()
      : credits[index].description;
  if (!description) return null;

  credits[index] = {
    ...credits[index],
    amount,
    description,
    date: updates.date !== undefined ? String(updates.date) : credits[index].date,
    note: updates.note !== undefined ? String(updates.note) : credits[index].note,
  };
  current = { ...current, credits };
  current.balanceDue = recomputeBalanceDue(tenantId, current);
  all[tenantId] = current;
  saveAll(all);
  return all[tenantId];
}

export function deleteCredit(tenantId: string, creditId: string): TenantPayment | null {
  const all = loadAll();
  let current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const credits = current.credits ?? [];
  if (!credits.some((c) => c.id === creditId)) return null;
  current = {
    ...current,
    credits: credits.filter((c) => c.id !== creditId),
  };
  current.balanceDue = recomputeBalanceDue(tenantId, current);
  all[tenantId] = current;
  saveAll(all);
  return all[tenantId];
}

/** meterRecords are stored newest-first; rechain previous/usage and latest totals */
function applyMeterChain(tenantId: string, current: TenantPayment, meterRecords: MeterRecord[]): TenantPayment {
  const oldestFirst = [...meterRecords].reverse();
  const rebuilt: MeterRecord[] = [];
  for (let i = 0; i < oldestFirst.length; i++) {
    const r = oldestFirst[i];
    const previousReading = i === 0
      ? (Number(r.previousReading) || 0)
      : rebuilt[i - 1].reading;
    const usage = Math.max(0, Number(r.reading) - previousReading);
    rebuilt.push({
      ...r,
      reading: Number(r.reading),
      previousReading,
      usage,
    });
  }
  const newestFirst = rebuilt.reverse();
  const latest = newestFirst[0];
  const next: TenantPayment = {
    ...current,
    tenantId,
    meterRecords: newestFirst,
    currentReadingTotal: latest?.usage ?? 0,
    previousMeterReading: latest?.reading ?? (current.previousMeterReading ?? 0),
    records: current.records,
  };
  next.balanceDue = recomputeBalanceDue(tenantId, next);
  return next;
}

export function addMeterRecord(
  tenantId: string,
  record: Omit<MeterRecord, 'id' | 'previousReading' | 'usage'> & {
    reading: number;
    /** Optional override when meter was replaced or baseline needs a reset */
    previousReading?: number;
  }
): TenantPayment {
  const all = loadAll();
  const current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const meterRecords = current.meterRecords ?? [];
  const previousReading =
    record.previousReading !== undefined && !Number.isNaN(Number(record.previousReading))
      ? Math.max(0, Number(record.previousReading))
      : getEffectivePreviousReading(current);
  const usage = Math.max(0, record.reading - previousReading);
  const { previousReading: _drop, ...rest } = record;
  const newRecord: MeterRecord = {
    ...rest,
    id: `meter-${Date.now()}`,
    previousReading,
    usage,
  };
  const next = applyMeterChain(tenantId, current, [newRecord, ...meterRecords]);
  all[tenantId] = next;
  saveAll(all);
  return all[tenantId];
}

/**
 * Set or replace the current (latest) meter reading.
 * Creates a first reading if none exist; otherwise updates the newest record in place.
 */
export function setCurrentMeterReading(
  tenantId: string,
  options: {
    reading: number;
    date?: string;
    note?: string;
    previousReading?: number;
  }
): TenantPayment {
  const all = loadAll();
  const current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const meterRecords = current.meterRecords ?? [];
  const date = options.date || new Date().toISOString().split('T')[0];
  const reading = Number(options.reading);

  if (meterRecords.length === 0) {
    return addMeterRecord(tenantId, {
      date,
      reading,
      note: options.note,
      previousReading: options.previousReading,
    });
  }

  const latest = meterRecords[0];
  // Only one reading: allow previous override (baseline). Otherwise chain from older record.
  const isOnlyReading = meterRecords.length === 1;
  const updated = updateMeterRecord(tenantId, latest.id, {
    reading,
    date,
    note: options.note,
    previousReading:
      isOnlyReading && options.previousReading !== undefined
        ? options.previousReading
        : undefined,
  });

  return updated ?? addMeterRecord(tenantId, {
    date,
    reading,
    note: options.note,
    previousReading: options.previousReading,
  });
}

export function updateMeterRecord(
  tenantId: string,
  recordId: string,
  updates: Partial<Pick<MeterRecord, 'date' | 'reading' | 'note' | 'previousReading'>>
): TenantPayment | null {
  const all = loadAll();
  const current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const meterRecords = [...(current.meterRecords ?? [])];
  const index = meterRecords.findIndex((r) => r.id === recordId);
  if (index === -1) return null;

  const existing = meterRecords[index];
  const reading = updates.reading !== undefined ? Number(updates.reading) : existing.reading;
  if (Number.isNaN(reading) || reading < 0) return null;

  const isOldest = index === meterRecords.length - 1;
  meterRecords[index] = {
    ...existing,
    reading,
    date: updates.date !== undefined ? String(updates.date) : existing.date,
    note: updates.note !== undefined ? String(updates.note) : existing.note,
    previousReading: isOldest && updates.previousReading !== undefined
      ? Number(updates.previousReading) || 0
      : existing.previousReading,
  };

  const next = applyMeterChain(tenantId, current, meterRecords);
  all[tenantId] = next;
  saveAll(all);
  return all[tenantId];
}

export function deleteMeterRecord(tenantId: string, recordId: string): TenantPayment | null {
  const all = loadAll();
  const current = ensureCurrentPeriod(tenantId, all[tenantId] ?? defaultPayment(tenantId));
  const meterRecords = current.meterRecords ?? [];
  if (!meterRecords.some((r) => r.id === recordId)) return null;
  const filtered = meterRecords.filter((r) => r.id !== recordId);
  const next = applyMeterChain(tenantId, current, filtered);
  all[tenantId] = next;
  saveAll(all);
  return all[tenantId];
}
