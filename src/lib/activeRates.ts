import { PropertyRentalRates, RentalType } from '../../types';
import { ALL_RENTAL_TYPES, DEFAULT_RENTAL_RATES, type RentalRatesConfig } from '../../rentUtils';

export type ActiveRates = RentalRatesConfig & {
  notes?: string;
  allowedRentalTypes: RentalType[];
  propertyId?: string;
  propertyName?: string;
};

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: ActiveRates | null = null;
let inflight: Promise<ActiveRates> | null = null;

function money(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

function parsePayload(data: Partial<PropertyRentalRates> & {
  allowedRentalTypes?: RentalType[];
  propertyId?: string;
  propertyName?: string;
}): ActiveRates {
  const allowed =
    Array.isArray(data.allowedRentalTypes) && data.allowedRentalTypes.length > 0
      ? ALL_RENTAL_TYPES.filter(t => data.allowedRentalTypes!.includes(t))
      : [...ALL_RENTAL_TYPES];
  const taxPct = (value: unknown, fallback: number) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(Math.round(n * 1000) / 1000, 100);
  };
  return {
    monthly: money(data.monthly, DEFAULT_RENTAL_RATES.monthly),
    weekly: money(data.weekly, DEFAULT_RENTAL_RATES.weekly),
    dailyWeekday: money(data.dailyWeekday, DEFAULT_RENTAL_RATES.dailyWeekday),
    dailyWeekend: money(data.dailyWeekend, DEFAULT_RENTAL_RATES.dailyWeekend),
    stateTransientTaxPercent: taxPct(
      data.stateTransientTaxPercent,
      DEFAULT_RENTAL_RATES.stateTransientTaxPercent ?? 0
    ),
    countyTransientTaxPercent: taxPct(
      data.countyTransientTaxPercent,
      DEFAULT_RENTAL_RATES.countyTransientTaxPercent ?? 0
    ),
    notes: data.notes,
    allowedRentalTypes: allowed.length > 0 ? allowed : [...ALL_RENTAL_TYPES],
    propertyId: data.propertyId,
    propertyName: data.propertyName,
  };
}

/** Subscribe to rental-rate updates (e.g. after admin saves rates). */
export function subscribeActiveRates(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Clear cache and notify admin widgets to reload rates. */
export function notifyActiveRatesChanged(): void {
  cache = null;
  inflight = null;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function fetchActiveRates(options?: { force?: boolean }): Promise<ActiveRates> {
  const force = options?.force === true;
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch('/api/rates/active', { credentials: 'include' });
      if (!res.ok) {
        const fallback: ActiveRates = {
          ...DEFAULT_RENTAL_RATES,
          allowedRentalTypes: [...ALL_RENTAL_TYPES],
        };
        if (!force) cache = fallback;
        return fallback;
      }
      const data = (await res.json()) as Partial<PropertyRentalRates> & {
        allowedRentalTypes?: RentalType[];
        propertyId?: string;
        propertyName?: string;
      };
      const parsed = parsePayload(data);
      cache = parsed;
      return parsed;
    } catch {
      const fallback: ActiveRates = {
        ...DEFAULT_RENTAL_RATES,
        allowedRentalTypes: [...ALL_RENTAL_TYPES],
      };
      if (!force) cache = fallback;
      return fallback;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
