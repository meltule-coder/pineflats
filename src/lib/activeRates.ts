import { PropertyRentalRates, RentalType } from '../../types';
import { ALL_RENTAL_TYPES, DEFAULT_RENTAL_RATES, type RentalRatesConfig } from '../../rentUtils';

export type ActiveRates = RentalRatesConfig & {
  notes?: string;
  allowedRentalTypes: RentalType[];
  propertyId?: string;
  propertyName?: string;
};

export async function fetchActiveRates(): Promise<ActiveRates> {
  try {
    const res = await fetch('/api/rates/active');
    if (!res.ok) {
      return { ...DEFAULT_RENTAL_RATES, allowedRentalTypes: [...ALL_RENTAL_TYPES] };
    }
    const data = (await res.json()) as Partial<PropertyRentalRates> & {
      allowedRentalTypes?: RentalType[];
      propertyId?: string;
      propertyName?: string;
    };
    const allowed =
      Array.isArray(data.allowedRentalTypes) && data.allowedRentalTypes.length > 0
        ? ALL_RENTAL_TYPES.filter(t => data.allowedRentalTypes!.includes(t))
        : [...ALL_RENTAL_TYPES];
    return {
      monthly: Number(data.monthly) || DEFAULT_RENTAL_RATES.monthly,
      weekly: Number(data.weekly) || DEFAULT_RENTAL_RATES.weekly,
      dailyWeekday: Number(data.dailyWeekday) || DEFAULT_RENTAL_RATES.dailyWeekday,
      dailyWeekend: Number(data.dailyWeekend) || DEFAULT_RENTAL_RATES.dailyWeekend,
      notes: data.notes,
      allowedRentalTypes: allowed.length > 0 ? allowed : [...ALL_RENTAL_TYPES],
      propertyId: data.propertyId,
      propertyName: data.propertyName,
    };
  } catch {
    return { ...DEFAULT_RENTAL_RATES, allowedRentalTypes: [...ALL_RENTAL_TYPES] };
  }
}
