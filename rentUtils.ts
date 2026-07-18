import { RentalType } from './types';

export const WEEKLY_RENT = 250;
export const MONTHLY_RENT = 750;
/** Used when a charge spans two calendar months (always 30-day math). */
export const MONTHLY_BILLING_DAYS = 30;
export const DAILY_RENT_WEEKDAY = 49.99;
export const DAILY_RENT_WEEKEND = 59.99;

export function getDailyRentForDate(date: Date = new Date()): number {
  const day = date.getDay();
  return day === 5 || day === 6 ? DAILY_RENT_WEEKEND : DAILY_RENT_WEEKDAY;
}

export function rentAmountForType(rentalType: RentalType, date: Date = new Date()): number {
  if (rentalType === 'weekly') return WEEKLY_RENT;
  if (rentalType === 'daily') return getDailyRentForDate(date);
  return MONTHLY_RENT;
}

export function dailyRateLabel(date: Date = new Date()): string {
  const day = date.getDay();
  return day === 5 || day === 6 ? 'Friday–Saturday' : 'Sunday–Thursday';
}

export function formatDailyRateDescription(): string {
  return `$${DAILY_RENT_WEEKDAY.toFixed(2)} Sun–Thu, $${DAILY_RENT_WEEKEND.toFixed(2)} Fri–Sat`;
}

export function calculateWeeklyStayTotal(nights: number): number {
  if (nights <= 0) return 0;
  if (nights <= 7) return WEEKLY_RENT;
  const fullWeeks = Math.floor(nights / 7);
  const remainder = nights % 7;
  const fullWeekTotal = fullWeeks * WEEKLY_RENT;
  const proratedRemainder = remainder > 0
    ? Math.round((remainder / 7) * WEEKLY_RENT * 100) / 100
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

export function calculateStayTotal(rentalType: RentalType, checkIn: Date, checkOut: Date): number {
  const nights: Date[] = [];
  let cursor = new Date(checkIn);
  while (cursor < checkOut) {
    nights.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  if (nights.length === 0) return 0;

  if (rentalType === 'daily') {
    return Math.round(nights.reduce((sum, night) => sum + getDailyRentForDate(night), 0) * 100) / 100;
  }
  if (rentalType === 'weekly') {
    return calculateWeeklyStayTotal(nights.length);
  }
  return calculateMonthlyStayTotal(nights.length, checkIn, checkOut);
}

export function calculateMonthlyStayTotal(
  nights: number,
  checkIn?: Date,
  checkOut?: Date
): number {
  if (nights <= 0) return 0;
  const lastNight = checkOut ? addDays(checkOut, -1) : undefined;
  const divisor =
    checkIn && lastNight && lastNight >= checkIn
      ? monthlyProrationDivisor(checkIn, lastNight)
      : MONTHLY_BILLING_DAYS;
  const dailyRate = MONTHLY_RENT / divisor;
  // Full month (or 30-day multi-month block) = full $750
  if (nights >= divisor) {
    const fullBlocks = Math.floor(nights / divisor);
    const remainder = nights % divisor;
    return Math.round((fullBlocks * MONTHLY_RENT + remainder * dailyRate) * 100) / 100;
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