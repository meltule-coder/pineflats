import fs from 'fs';
import path from 'path';
import { MeterRecord, Slot, SlotStatus } from '../types';
import { parseDateKey } from '../rentUtils';
import { normalizeStayDateKey } from './slotAvailability';
import { SLOT_CONTACT_CLEAR } from './slotContactUtils';
import { atomicWriteJson } from './persist';

/** Same rate as tenant utilities ($/kWh) for weekly overage. */
export const SLOT_KWH_RATE = 0.24;

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function rechainSlotMeters(
  records: MeterRecord[],
  baselinePrevious?: number
): MeterRecord[] {
  const oldestFirst = [...records].reverse();
  const rebuilt: MeterRecord[] = [];
  for (let i = 0; i < oldestFirst.length; i++) {
    const r = oldestFirst[i];
    const previousReading =
      i === 0
        ? Number.isFinite(Number(baselinePrevious))
          ? Number(baselinePrevious)
          : Number(r.previousReading) || 0
        : rebuilt[i - 1].reading;
    const reading = Number(r.reading) || 0;
    rebuilt.push({
      ...r,
      reading,
      previousReading,
      usage: Math.max(0, reading - previousReading),
    });
  }
  return rebuilt.reverse(); // newest first
}

function applyMeterDerivedFields(slot: Slot): Slot {
  const meterRecords = slot.meterRecords ?? [];
  const latest = meterRecords[0];
  const usage = latest?.usage ?? slot.currentMeterUsage ?? 0;
  const baseline = Number(slot.meterBaselineCredit) || 0;
  const netKwh = Math.max(0, usage - baseline);
  const overage = money(netKwh * SLOT_KWH_RATE);
  const rent = Number(slot.rentAmount) || 0;
  return {
    ...slot,
    currentMeterUsage: usage,
    previousMeterReading: latest?.reading ?? slot.previousMeterReading ?? 0,
    meterOverageCharge: overage,
    // Keep rent + overage as balance due for weekly site billing
    balanceDue: money(rent + overage),
  };
}

/**
 * Add a meter reading on a site (for weekly overage). Records newest-first.
 */
export function addSlotMeterRecord(
  slotId: string,
  input: {
    reading: number;
    date?: string;
    note?: string;
    previousReading?: number;
    baselineCredit?: number;
  }
): Slot | null {
  const slots = getSlots();
  const index = slots.findIndex(s => s.id === slotId);
  if (index === -1) return null;
  const slot = slots[index];
  const existing = slot.meterRecords ?? [];
  const previousReading =
    input.previousReading !== undefined && !Number.isNaN(Number(input.previousReading))
      ? Math.max(0, Number(input.previousReading))
      : (existing[0]?.reading ?? Number(slot.previousMeterReading) ?? 0);
  const reading = Number(input.reading);
  if (!Number.isFinite(reading) || reading < 0) return null;

  const newRecord: MeterRecord = {
    id: `slot-meter-${Date.now()}`,
    date: (input.date || new Date().toISOString().split('T')[0]).slice(0, 10),
    reading,
    previousReading,
    usage: Math.max(0, reading - previousReading),
    note: input.note?.trim() || undefined,
  };

  let next: Slot = {
    ...slot,
    meterRecords: rechainSlotMeters([newRecord, ...existing]),
  };
  if (input.baselineCredit !== undefined && Number.isFinite(Number(input.baselineCredit))) {
    next.meterBaselineCredit = Math.max(0, Number(input.baselineCredit));
  }
  next = applyMeterDerivedFields(next);
  slots[index] = next;
  saveSlots(slots);
  return next;
}

/** Update included kWh baseline for overage on a site. */
export function setSlotMeterBaseline(slotId: string, baselineCredit: number): Slot | null {
  const slots = getSlots();
  const index = slots.findIndex(s => s.id === slotId);
  if (index === -1) return null;
  let next: Slot = {
    ...slots[index],
    meterBaselineCredit: Math.max(0, Number(baselineCredit) || 0),
  };
  next = applyMeterDerivedFields(next);
  slots[index] = next;
  saveSlots(slots);
  return next;
}

export function deleteSlotMeterRecord(slotId: string, recordId: string): Slot | null {
  const slots = getSlots();
  const index = slots.findIndex(s => s.id === slotId);
  if (index === -1) return null;
  const slot = slots[index];
  const existing = slot.meterRecords ?? [];
  if (!existing.some(r => r.id === recordId)) return null;
  const filtered = existing.filter(r => r.id !== recordId);
  let next: Slot = {
    ...slot,
    meterRecords: rechainSlotMeters(filtered, Number(slot.previousMeterReading) || 0),
  };
  if (filtered.length === 0) {
    next = {
      ...next,
      currentMeterUsage: 0,
      meterOverageCharge: 0,
      meterRecords: [],
    };
    const rent = Number(next.rentAmount) || 0;
    next.balanceDue = money(rent);
  } else {
    next = applyMeterDerivedFields(next);
  }
  slots[index] = next;
  saveSlots(slots);
  return next;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const SLOTS_FILE = path.join(DATA_DIR, 'slots.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const TOTAL_SLOTS = 25;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function createDefaultSlots(): Slot[] {
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
    id: `slot-${i + 1}`,
    number: i + 1,
    label: `Site ${i + 1}`,
    status: 'available' as SlotStatus,
  }));
}

export function getSlots(): Slot[] {
  ensureDataDir();
  if (!fs.existsSync(SLOTS_FILE)) {
    const slots = createDefaultSlots();
    atomicWriteJson(SLOTS_FILE, slots);
    return slots;
  }
  return JSON.parse(fs.readFileSync(SLOTS_FILE, 'utf-8'));
}

/** Expire ended reservations and strip stale data from available sites. */
export function maintainSlots(): Slot[] {
  const slots = getSlots();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let changed = false;

  for (const slot of slots) {
    // Normalize US-style dates (4/1/26) → YYYY-MM-DD so public availability compares correctly
    if (slot.startDate) {
      const n = normalizeStayDateKey(slot.startDate);
      if (n && n !== '9999-12-31' && n !== slot.startDate) {
        slot.startDate = n;
        changed = true;
      }
    }
    if (slot.endDate) {
      const raw = String(slot.endDate).trim().toLowerCase();
      if (raw === 'ongoing' || raw === 'open' || raw === 'indefinite') {
        // keep symbolic ongoing for monthly tenants
      } else {
        const n = normalizeStayDateKey(slot.endDate);
        if (n && n !== slot.endDate) {
          slot.endDate = n;
          changed = true;
        }
      }
    }

    if (slot.status === 'available') {
      const hasStale = slot.contactName || slot.contactPhone || slot.contactEmail
        || slot.tenantName || slot.tenantId || slot.startDate || slot.endDate;
      if (hasStale) {
        Object.assign(slot, SLOT_CONTACT_CLEAR, { status: 'available' as SlotStatus });
        changed = true;
      }
    }

    if (slot.status === 'reserved' && slot.endDate) {
      try {
        const endKey = normalizeStayDateKey(slot.endDate);
        if (endKey && endKey !== '9999-12-31' && endKey <= todayKey) {
          Object.assign(slot, SLOT_CONTACT_CLEAR, { status: 'available' as SlotStatus });
          changed = true;
        } else if (!endKey) {
          // fall back to Date parse for odd strings
          const end = parseDateKey(String(slot.endDate).slice(0, 10));
          end.setHours(0, 0, 0, 0);
          if (!Number.isNaN(end.getTime()) && end <= today) {
            Object.assign(slot, SLOT_CONTACT_CLEAR, { status: 'available' as SlotStatus });
            changed = true;
          }
        }
      } catch {
        // ignore invalid date strings
      }
    }
  }

  if (changed) saveSlots(slots);
  return slots;
}

export function saveSlots(slots: Slot[]) {
  ensureDataDir();
  atomicWriteJson(SLOTS_FILE, slots);
}

export function updateSlot(id: string, updates: Partial<Slot>): Slot | null {
  const slots = getSlots();
  const index = slots.findIndex(s => s.id === id);
  if (index === -1) return null;
  slots[index] = { ...slots[index], ...updates };
  saveSlots(slots);
  return slots[index];
}

/**
 * Read → guard → write in one step so two online bookings cannot both claim
 * the same site (double-book). `guard` returns an error string to abort, or null to proceed.
 */
export function updateSlotIf(
  id: string,
  guard: (slot: Slot) => string | null,
  updates: Partial<Slot>
): { ok: true; slot: Slot } | { ok: false; error: string } {
  const slots = maintainSlots();
  const index = slots.findIndex(s => s.id === id);
  if (index === -1) return { ok: false, error: 'Site not found' };
  const err = guard(slots[index]);
  if (err) return { ok: false, error: err };
  slots[index] = { ...slots[index], ...updates };
  saveSlots(slots);
  return { ok: true, slot: slots[index] };
}

export function assignSlot(slotLabel: string, tenant: {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}): Slot | null {
  const slots = getSlots();
  const normalized = slotLabel.toLowerCase().replace(/\s+/g, '');
  const slot = slots.find(s =>
    s.label.toLowerCase().replace(/\s+/g, '') === normalized ||
    s.number.toString() === normalized ||
    `site${s.number}` === normalized
  );
  if (!slot) return null;

  slot.status = 'occupied';
  slot.tenantName = tenant.name;
  slot.tenantId = tenant.id;
  slot.startDate = tenant.startDate;
  slot.endDate = tenant.endDate;
  slot.notes = tenant.description;
  saveSlots(slots);
  return slot;
}

export function clearSlotByTenant(tenantName: string): boolean {
  const slots = getSlots();
  let changed = false;
  for (const slot of slots) {
    if (slot.tenantName?.toLowerCase().includes(tenantName.toLowerCase())) {
      Object.assign(slot, SLOT_CONTACT_CLEAR, {
        status: 'available' as SlotStatus,
        paymentMethod: undefined,
        bookedAt: undefined,
      });
      changed = true;
    }
  }
  if (changed) saveSlots(slots);
  return changed;
}

export function clearSlotByTenantId(tenantId: string): boolean {
  const slots = getSlots();
  let changed = false;
  for (const slot of slots) {
    if (slot.tenantId === tenantId) {
      Object.assign(slot, SLOT_CONTACT_CLEAR, {
        status: 'available' as SlotStatus,
        paymentMethod: undefined,
        bookedAt: undefined,
      });
      changed = true;
    }
  }
  if (changed) saveSlots(slots);
  return changed;
}

export function clearSlotBySiteNumber(site: string | number): boolean {
  const num = String(site).replace(/\D/g, '');
  if (!num) return false;
  const slots = getSlots();
  let changed = false;
  for (const slot of slots) {
    if (String(slot.number) === num) {
      Object.assign(slot, SLOT_CONTACT_CLEAR, {
        status: 'available' as SlotStatus,
        paymentMethod: undefined,
        bookedAt: undefined,
      });
      changed = true;
    }
  }
  if (changed) saveSlots(slots);
  return changed;
}

export function moveTenantSlot(tenantName: string, newSite: string): Slot | null {
  const slots = getSlots();
  const tenantSlot = slots.find(s =>
    s.tenantName?.toLowerCase().includes(tenantName.toLowerCase())
  );
  if (!tenantSlot) return null;

  const tenantData = {
    tenantName: tenantSlot.tenantName,
    tenantId: tenantSlot.tenantId,
    startDate: tenantSlot.startDate,
    endDate: tenantSlot.endDate,
    notes: tenantSlot.notes,
  };

  tenantSlot.status = 'available';
  tenantSlot.tenantName = undefined;
  tenantSlot.tenantId = undefined;
  tenantSlot.startDate = undefined;
  tenantSlot.endDate = undefined;
  tenantSlot.notes = undefined;

  const normalized = newSite.toLowerCase().replace(/\s+/g, '');
  const targetSlot = slots.find(s =>
    s.label.toLowerCase().replace(/\s+/g, '') === normalized ||
    s.number.toString() === normalized ||
    `site${s.number}` === normalized
  );
  if (!targetSlot) {
    saveSlots(slots);
    return null;
  }

  targetSlot.status = 'occupied';
  targetSlot.tenantName = tenantData.tenantName;
  targetSlot.tenantId = tenantData.tenantId;
  targetSlot.startDate = tenantData.startDate;
  targetSlot.endDate = tenantData.endDate;
  targetSlot.notes = tenantData.notes;
  saveSlots(slots);
  return targetSlot;
}

export function getAvailableCount(): number {
  return getSlots().filter(s => s.status === 'available').length;
}

export function getSpreadsheetId(): string | null {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_FILE)) return null;
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  return config.spreadsheetId ?? null;
}

export function setSpreadsheetId(id: string) {
  ensureDataDir();
  const config = fs.existsSync(CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    : {};
  config.spreadsheetId = id;
  atomicWriteJson(CONFIG_FILE, config);
}

export { TOTAL_SLOTS };