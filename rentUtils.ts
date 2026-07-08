import { RentalType } from './types';

export const WEEKLY_RENT = 250;
export const MONTHLY_RENT = 750;
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
  return calculateMonthlyStayTotal(nights.length);
}

export function calculateMonthlyStayTotal(nights: number): number {
  if (nights <= 0) return 0;
  if (nights < 30) {
    return Math.round((nights / 30) * MONTHLY_RENT * 100) / 100;
  }
  const fullMonths = Math.floor(nights / 30);
  const remainder = nights % 30;
  const fullMonthTotal = fullMonths * MONTHLY_RENT;
  const proratedRemainder = remainder > 0
    ? Math.round((remainder / 30) * MONTHLY_RENT * 100) / 100
    : 0;
  return fullMonthTotal + proratedRemainder;
}