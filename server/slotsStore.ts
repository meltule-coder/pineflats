import fs from 'fs';
import path from 'path';
import { Slot, SlotStatus } from '../types';
import { parseDateKey } from '../rentUtils';
import { SLOT_CONTACT_CLEAR } from './slotContactUtils';

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
    fs.writeFileSync(SLOTS_FILE, JSON.stringify(slots, null, 2));
    return slots;
  }
  return JSON.parse(fs.readFileSync(SLOTS_FILE, 'utf-8'));
}

/** Expire ended reservations and strip stale data from available sites. */
export function maintainSlots(): Slot[] {
  const slots = getSlots();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let changed = false;

  for (const slot of slots) {
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
        const end = parseDateKey(slot.endDate);
        end.setHours(0, 0, 0, 0);
        if (end <= today) {
          Object.assign(slot, SLOT_CONTACT_CLEAR, { status: 'available' as SlotStatus });
          changed = true;
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
  fs.writeFileSync(SLOTS_FILE, JSON.stringify(slots, null, 2));
}

export function updateSlot(id: string, updates: Partial<Slot>): Slot | null {
  const slots = getSlots();
  const index = slots.findIndex(s => s.id === id);
  if (index === -1) return null;
  slots[index] = { ...slots[index], ...updates };
  saveSlots(slots);
  return slots[index];
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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export { TOTAL_SLOTS };