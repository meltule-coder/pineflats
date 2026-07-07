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