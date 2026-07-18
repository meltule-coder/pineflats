import { Property, PropertyRentalRates, RentalType } from './types';

export const WEEKLY_RENT = 250;
export const MONTHLY_RENT = 750;
/** Used when a charge spans two calendar months (always 30-day math). */
export const MONTHLY_BILLING_DAYS = 30;
export const DAILY_RENT_WEEKDAY = 49.99;
export const DAILY_RENT_WEEKEND = 59.99;

export const ALL_RENTAL_TYPES: RentalType[] = ['daily', 'weekly', 'monthly'];

/**
 * Big House / Little House rentals are monthly-only (no weekly or daily).
 * Matches names like "Big House", "Big House Rental", "Little House Rental".
 */
export function isMonthlyOnlyHouseName(name?: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  return /(?:^|\b)(big|little)\s+house(?:\s+rental)?(?:\b|$)/.test(n);
}

/**
 * Tree house rentals are daily-only (no monthly or weekly).
 * Matches "Tree house", "Treehouse", "Tree house Rental", etc.
 */
export function isDailyOnlyTreeHouseName(name?: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  return /tree\s*house/.test(n);
}

/** Which rental types a property offers (name rules, then explicit list, then all). */
export function getAllowedRentalTypes(
  property?: Pick<Property, 'name' | 'allowedRentalTypes'> | null
): RentalType[] {
  // Known product types always win so UI/API stay consistent
  if (isMonthlyOnlyHouseName(property?.name)) {
    return ['monthly'];
  }
  if (isDailyOnlyTreeHouseName(property?.name)) {
    return ['daily'];
  }
  if (property?.allowedRentalTypes && property.allowedRentalTypes.length > 0) {
    const set = new Set(property.allowedRentalTypes);
    const filtered = ALL_RENTAL_TYPES.filter(t => set.has(t));
    if (filtered.length > 0) return filtered;
  }
  return [...ALL_RENTAL_TYPES];
}

export function allowsRentalType(
  property: Pick<Property, 'name' | 'allowedRentalTypes'> | null | undefined,
  rentalType: RentalType
): boolean {
  return getAllowedRentalTypes(property).includes(rentalType);
}

export type RentalRatesConfig = Pick<
  PropertyRentalRates,
  'monthly' | 'weekly' | 'dailyWeekday' | 'dailyWeekend'
>;

export const DEFAULT_RENTAL_RATES: RentalRatesConfig = {
  monthly: MONTHLY_RENT,
  weekly: WEEKLY_RENT,
  dailyWeekday: DAILY_RENT_WEEKDAY,
  dailyWeekend: DAILY_RENT_WEEKEND,
};

export function getDailyRentForDate(
  date: Date = new Date(),
  rates: RentalRatesConfig = DEFAULT_RENTAL_RATES
): number {
  const day = date.getDay();
  return day === 5 || day === 6 ? rates.dailyWeekend : rates.dailyWeekday;
}

export function rentAmountForType(
  rentalType: RentalType,
  date: Date = new Date(),
  rates: RentalRatesConfig = DEFAULT_RENTAL_RATES
): number {
  if (rentalType === 'weekly') return rates.weekly;
  if (rentalType === 'daily') return getDailyRentForDate(date, rates);
  return rates.monthly;
}

export function dailyRateLabel(date: Date = new Date()): string {
  const day = date.getDay();
  return day === 5 || day === 6 ? 'Friday–Saturday' : 'Sunday–Thursday';
}

export function formatDailyRateDescription(rates: RentalRatesConfig = DEFAULT_RENTAL_RATES): string {
  return `$${rates.dailyWeekday.toFixed(2)} Sun–Thu, $${rates.dailyWeekend.toFixed(2)} Fri–Sat`;
}

export function calculateWeeklyStayTotal(
  nights: number,
  rates: RentalRatesConfig = DEFAULT_RENTAL_RATES
): number {
  if (nights <= 0) return 0;
  if (nights <= 7) return rates.weekly;
  const fullWeeks = Math.floor(nights / 7);
  const remainder = nights % 7;
  const fullWeekTotal = fullWeeks * rates.weekly;
  const proratedRemainder = remainder > 0
    ? Math.round((remainder / 7) * rates.weekly * 100) / 100
    : 0;
  return fullWeekTotal + proratedRemainder;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function calculateStayNights(checkIn: Date, checkOut: Date): number {
  if (checkOut <= checkIn) return 0;
  return Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysInCalendarMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function sameCalendarMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Divisor for monthly proration from $750:
 * - One calendar month with 31 days → 31
 * - One calendar month with 30 (or 28/29) days → that month's length
 * - Charge covers 2+ months → always 30
 */
export function monthlyProrationDivisor(start: Date, end: Date): number {
  if (sameCalendarMonth(start, end)) {
    return daysInCalendarMonth(start.getFullYear(), start.getMonth());
  }
  return MONTHLY_BILLING_DAYS;
}

export function calculateStayTotal(
  rentalType: RentalType,
  checkIn: Date,
  checkOut: Date,
  rates: RentalRatesConfig = DEFAULT_RENTAL_RATES
): number {
  const nights: Date[] = [];
  let cursor = new Date(checkIn);
  while (cursor < checkOut) {
    nights.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  if (nights.length === 0) return 0;

  if (rentalType === 'daily') {
    return Math.round(
      nights.reduce((sum, night) => sum + getDailyRentForDate(night, rates), 0) * 100
    ) / 100;
  }
  if (rentalType === 'weekly') {
    return calculateWeeklyStayTotal(nights.length, rates);
  }
  return calculateMonthlyStayTotal(nights.length, checkIn, checkOut, rates.monthly);
}

export function calculateMonthlyStayTotal(
  nights: number,
  checkIn?: Date,
  checkOut?: Date,
  monthlyRate: number = MONTHLY_RENT
): number {
  if (nights <= 0) return 0;
  const lastNight = checkOut ? addDays(checkOut, -1) : undefined;
  const divisor =
    checkIn && lastNight && lastNight >= checkIn
      ? monthlyProrationDivisor(checkIn, lastNight)
      : MONTHLY_BILLING_DAYS;
  const dailyRate = monthlyRate / divisor;
  if (nights >= divisor) {
    const fullBlocks = Math.floor(nights / divisor);
    const remainder = nights % divisor;
    return Math.round((fullBlocks * monthlyRate + remainder * dailyRate) * 100) / 100;
  }
  return Math.round(nights * dailyRate * 100) / 100;
}

/** Parse ISO (YYYY-MM-DD) or common US (M/D/YYYY) dates; returns local calendar date or null. */
export function parseFlexibleDate(value?: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /^ongoing$/i.test(trimmed)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return parseDateKey(trimmed.slice(0, 10));
  }
  const mdy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (mdy) {
    return new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface MonthlyProrationResult {
  amount: number;
  fullRate: number;
  /** fullRate ÷ daysInPeriod */
  dailyRate: number;
  /** Inclusive calendar days charged */
  daysCharged: number;
  /** Same as daysCharged (kept for UI compatibility) */
  billableDays: number;
  /** Deprecated — always 0 (31-day months use 750÷31 instead) */
  extraDaysFor31DayMonth: number;
  /**
   * 31 for a single 31-day month, 30 for a 30-day month,
   * 28/29 for February, or 30 when the charge spans two months.
   */
  daysInPeriod: number;
  prorated: boolean;
  periodStart: string;
  periodEnd: string;
  chargeStart: string;
  chargeEnd: string;
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function inclusiveDays(start: Date, end: Date): number {
  if (end < start) return 0;
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Prorate monthly rent from a $750 full-month rate.
 *
 * - **One calendar month, 31 days:** daily = $750 ÷ 31; full month = $750
 * - **One calendar month, 30 days:** daily = $750 ÷ 30; full month = $750 (same total)
 * - **February:** daily = $750 ÷ 28 or 29; full month = $750
 * - **Covers 2+ months:** always use 30-day math ($750 ÷ 30 × days)
 *
 * Modes:
 * - **range** — bill exact start–end dates
 * - **window** — clip occupancy to the calendar month of `billingPeriod`
 *   (1st through last day of that month). Mid-month move-in pays remaining days only.
 */
export function prorateMonthlyRent(options: {
  monthlyRate?: number;
  startDate?: string | null;
  endDate?: string | null;
  billingPeriod?: string | null;
  asOf?: Date;
  mode?: 'range' | 'window';
}): MonthlyProrationResult {
  const fullRate = options.monthlyRate ?? MONTHLY_RENT;
  const asOf = options.asOf ?? new Date();

  const occStart = parseFlexibleDate(options.startDate);
  const occEnd = parseFlexibleDate(options.endDate);

  const mode: 'range' | 'window' =
    options.mode
    ?? (occStart && occEnd ? 'range' : 'window');

  // Calendar-month billing window (1st → last day of month)
  const periodKey =
    options.billingPeriod && /^\d{4}-\d{2}$/.test(options.billingPeriod)
      ? options.billingPeriod
      : occStart
        ? `${occStart.getFullYear()}-${String(occStart.getMonth() + 1).padStart(2, '0')}`
        : `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = periodKey.split('-').map(Number);
  const windowStart = new Date(y, m - 1, 1);
  const windowEnd = new Date(y, m, 0); // last calendar day of month
  const empty = (dailyRate: number, daysInPeriod: number): MonthlyProrationResult => ({
    amount: 0,
    fullRate,
    dailyRate,
    daysCharged: 0,
    billableDays: 0,
    extraDaysFor31DayMonth: 0,
    daysInPeriod,
    prorated: true,
    periodStart: toKey(windowStart),
    periodEnd: toKey(windowEnd),
    chargeStart: toKey(windowStart),
    chargeEnd: toKey(windowEnd),
  });

  let start: Date;
  let end: Date;

  if (mode === 'range' && occStart && occEnd) {
    start = occStart;
    end = occEnd;
  } else {
    start = windowStart;
    end = windowEnd;

    if (occStart) {
      if (occStart > windowEnd) {
        const daysInPeriod = daysInCalendarMonth(y, m - 1);
        return empty(fullRate / daysInPeriod, daysInPeriod);
      }
      if (occStart > windowStart) start = occStart;
    }

    if (occEnd) {
      if (occEnd < windowStart) {
        const daysInPeriod = daysInCalendarMonth(y, m - 1);
        return empty(fullRate / daysInPeriod, daysInPeriod);
      }
      if (occEnd < windowEnd) end = occEnd;
    }
  }

  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  const daysCharged = inclusiveDays(start, end);
  if (daysCharged <= 0) {
    const daysInPeriod = daysInCalendarMonth(y, m - 1);
    return empty(fullRate / daysInPeriod, daysInPeriod);
  }

  // Divisor: calendar days if single month; always 30 if spanning two months
  const daysInPeriod = monthlyProrationDivisor(start, end);
  const dailyRate = Math.round((fullRate / daysInPeriod) * 10000) / 10000;

  const fullMonthInWindow =
    mode === 'window'
    && start.getTime() === windowStart.getTime()
    && end.getTime() === windowEnd.getTime();
  const fullSingleMonthRange =
    mode === 'range'
    && sameCalendarMonth(start, end)
    && daysCharged === daysInPeriod;
  // Spanning two months: a full “month” block is 30 days
  const fullMultiMonthBlock =
    !sameCalendarMonth(start, end) && daysCharged >= MONTHLY_BILLING_DAYS;

  if (fullMonthInWindow || fullSingleMonthRange) {
    return {
      amount: fullRate,
      fullRate,
      dailyRate,
      daysCharged,
      billableDays: daysCharged,
      extraDaysFor31DayMonth: 0,
      daysInPeriod,
      prorated: false,
      periodStart: toKey(mode === 'window' ? windowStart : start),
      periodEnd: toKey(mode === 'window' ? windowEnd : end),
      chargeStart: toKey(start),
      chargeEnd: toKey(end),
    };
  }

  let amount: number;
  if (fullMultiMonthBlock) {
    const fullBlocks = Math.floor(daysCharged / MONTHLY_BILLING_DAYS);
    const remainder = daysCharged % MONTHLY_BILLING_DAYS;
    amount = Math.round((fullBlocks * fullRate + remainder * (fullRate / MONTHLY_BILLING_DAYS)) * 100) / 100;
  } else {
    amount = Math.round(dailyRate * daysCharged * 100) / 100;
  }

  return {
    amount,
    fullRate,
    dailyRate: !sameCalendarMonth(start, end)
      ? Math.round((fullRate / MONTHLY_BILLING_DAYS) * 10000) / 10000
      : dailyRate,
    daysCharged,
    billableDays: daysCharged,
    extraDaysFor31DayMonth: 0,
    daysInPeriod: !sameCalendarMonth(start, end) ? MONTHLY_BILLING_DAYS : daysInPeriod,
    prorated: true,
    periodStart: toKey(mode === 'window' ? windowStart : start),
    periodEnd: toKey(mode === 'window' ? windowEnd : end),
    chargeStart: toKey(start),
    chargeEnd: toKey(end),
  };
}