import fs from 'fs';
import path from 'path';
import { Property, PropertyRentalRates, RentalType } from '../types';
import { getAllowedRentalTypes } from '../rentUtils';

const DATA_DIR = path.join(process.cwd(), 'data');
const PROPERTIES_FILE = path.join(DATA_DIR, 'properties.json');

export const DEFAULT_RENTAL_RATES: PropertyRentalRates = {
  monthly: 750,
  weekly: 250,
  dailyWeekday: 49.99,
  dailyWeekend: 59.99,
  notes: '',
};

const DEFAULT_PROPERTIES: Property[] = [
  {
    id: '1',
    name: 'Pine Flats RV Park',
    address: '',
    city: '',
    state: '',
    zip: '',
    phone: '555-0199',
    email: 'info@pineflatsrv.com',
    totalSites: 25,
    notes: 'Primary property',
    rentalRates: { ...DEFAULT_RENTAL_RATES },
    isActive: true,
    createdAt: new Date().toISOString().split('T')[0],
  },
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getProperties(): Property[] {
  ensureDataDir();
  if (!fs.existsSync(PROPERTIES_FILE)) {
    fs.writeFileSync(PROPERTIES_FILE, JSON.stringify(DEFAULT_PROPERTIES, null, 2));
    return DEFAULT_PROPERTIES.map(p => ({ ...p }));
  }
  const raw = JSON.parse(fs.readFileSync(PROPERTIES_FILE, 'utf-8')) as Property[];
  return raw.map(p => {
    const allowedRentalTypes = getAllowedRentalTypes(p);
    return {
      ...p,
      rentalRates: normalizeRentalRates(p.rentalRates, DEFAULT_RENTAL_RATES),
      allowedRentalTypes,
    };
  });
}

function saveProperties(properties: Property[]) {
  ensureDataDir();
  fs.writeFileSync(PROPERTIES_FILE, JSON.stringify(properties, null, 2));
}

function nextId(): string {
  const list = getProperties();
  const numeric = list.map(p => Number(p.id)).filter(n => !Number.isNaN(n));
  const max = numeric.length > 0 ? Math.max(...numeric) : 0;
  return String(max + 1);
}

export function getProperty(id: string): Property | null {
  return getProperties().find(p => p.id === id) ?? null;
}

export function getActiveProperty(): Property | null {
  const list = getProperties();
  return list.find(p => p.isActive) ?? list[0] ?? null;
}

function parsePositiveMoney(value: unknown, fallback: number): number {
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

export function normalizeRentalRates(
  input?: Partial<PropertyRentalRates> | null,
  base: PropertyRentalRates = DEFAULT_RENTAL_RATES
): PropertyRentalRates {
  return {
    monthly: parsePositiveMoney(input?.monthly, base.monthly),
    weekly: parsePositiveMoney(input?.weekly, base.weekly),
    dailyWeekday: parsePositiveMoney(input?.dailyWeekday, base.dailyWeekday),
    dailyWeekend: parsePositiveMoney(input?.dailyWeekend, base.dailyWeekend),
    notes: (input?.notes ?? base.notes ?? '').toString().trim() || undefined,
  };
}

/** Rates for the active property (falls back to system defaults). */
export function getActiveRentalRates(): PropertyRentalRates {
  const active = getActiveProperty();
  return normalizeRentalRates(active?.rentalRates, DEFAULT_RENTAL_RATES);
}

/** Active property rates plus which rental types it offers. */
export function getActiveRatesPayload(): PropertyRentalRates & {
  allowedRentalTypes: RentalType[];
  propertyId?: string;
  propertyName?: string;
} {
  const active = getActiveProperty();
  return {
    ...getActiveRentalRates(),
    allowedRentalTypes: getAllowedRentalTypes(active),
    propertyId: active?.id,
    propertyName: active?.name,
  };
}

export function addProperty(data: {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  totalSites?: number;
  notes?: string;
  isActive?: boolean;
  rentalRates?: Partial<PropertyRentalRates>;
}): Property {
  const name = data.name.trim();
  if (!name) throw new Error('Property name is required');

  const list = getProperties();
  const makeActive = data.isActive === true || list.length === 0;
  if (makeActive) {
    for (const p of list) p.isActive = false;
  }

  const totalSites = Number(data.totalSites);
  const property: Property = {
    id: nextId(),
    name,
    address: (data.address || '').trim() || undefined,
    city: (data.city || '').trim() || undefined,
    state: (data.state || '').trim() || undefined,
    zip: (data.zip || '').trim() || undefined,
    phone: (data.phone || '').trim() || undefined,
    email: (data.email || '').trim() || undefined,
    totalSites: !Number.isNaN(totalSites) && totalSites > 0 ? Math.floor(totalSites) : undefined,
    notes: (data.notes || '').trim() || undefined,
    rentalRates: normalizeRentalRates(data.rentalRates, DEFAULT_RENTAL_RATES),
    isActive: makeActive,
    createdAt: new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString().split('T')[0],
  };

  list.push(property);
  saveProperties(list);
  return property;
}

export function updateProperty(
  id: string,
  updates: Partial<Omit<Property, 'id' | 'createdAt' | 'rentalRates'>> & {
    rentalRates?: Partial<PropertyRentalRates>;
  }
): Property | null {
  const list = getProperties();
  const index = list.findIndex(p => p.id === id);
  if (index === -1) return null;

  if (updates.isActive === true) {
    for (const p of list) p.isActive = false;
  }

  const next = { ...list[index] };
  if (updates.name !== undefined) {
    const name = String(updates.name).trim();
    if (!name) return null;
    next.name = name;
  }
  if (updates.address !== undefined) next.address = String(updates.address).trim() || undefined;
  if (updates.city !== undefined) next.city = String(updates.city).trim() || undefined;
  if (updates.state !== undefined) next.state = String(updates.state).trim() || undefined;
  if (updates.zip !== undefined) next.zip = String(updates.zip).trim() || undefined;
  if (updates.phone !== undefined) next.phone = String(updates.phone).trim() || undefined;
  if (updates.email !== undefined) next.email = String(updates.email).trim() || undefined;
  if (updates.notes !== undefined) next.notes = String(updates.notes).trim() || undefined;
  if (updates.totalSites !== undefined) {
    const n = Number(updates.totalSites);
    next.totalSites = !Number.isNaN(n) && n > 0 ? Math.floor(n) : undefined;
  }
  if (updates.rentalRates !== undefined) {
    next.rentalRates = normalizeRentalRates(
      updates.rentalRates,
      next.rentalRates ?? DEFAULT_RENTAL_RATES
    );
  }
  if (updates.isActive !== undefined) next.isActive = !!updates.isActive;
  next.updatedAt = new Date().toISOString().split('T')[0];

  list[index] = next;

  // Always keep at least one active property
  if (!list.some(p => p.isActive) && list.length > 0) {
    list[0] = { ...list[0], isActive: true };
  }

  saveProperties(list);
  return list.find(p => p.id === id) ?? next;
}

export function deleteProperty(id: string): boolean {
  const list = getProperties();
  if (list.length <= 1) {
    throw new Error('Cannot delete the only property');
  }
  const next = list.filter(p => p.id !== id);
  if (next.length === list.length) return false;
  if (!next.some(p => p.isActive)) {
    next[0] = { ...next[0], isActive: true };
  }
  saveProperties(next);
  return true;
}

export function setActiveProperty(id: string): Property | null {
  return updateProperty(id, { isActive: true });
}

/** Save rental rates for a property (typically the active one). */
export function updatePropertyRentalRates(
  id: string,
  rates: Partial<PropertyRentalRates>
): Property | null {
  return updateProperty(id, { rentalRates: rates });
}
