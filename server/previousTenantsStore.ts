import fs from 'fs';
import path from 'path';
import type {
  PreviousTenantPaymentSnapshot,
  PreviousTenantRecord,
  Tenant,
} from '../types';
import { atomicWriteJson } from './persist';
import { getTotalPaidForTenant } from './paymentsStore';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'previous-tenants.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAll(): PreviousTenantRecord[] {
  ensureDataDir();
  if (!fs.existsSync(FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return Array.isArray(raw) ? (raw as PreviousTenantRecord[]) : [];
  } catch {
    return [];
  }
}

function saveAll(list: PreviousTenantRecord[]) {
  ensureDataDir();
  atomicWriteJson(FILE, list);
}

function newArchiveId(): string {
  return `prev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Payment summary without cards / secrets. */
export function buildPaymentSnapshot(tenantId: string): PreviousTenantPaymentSnapshot | undefined {
  if (!fs.existsSync(PAYMENTS_FILE)) return undefined;
  try {
    const all = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8')) as Record<
      string,
      {
        rentalType?: PreviousTenantPaymentSnapshot['rentalType'];
        rentAmount?: number;
        billingPeriod?: string;
        records?: PreviousTenantPaymentSnapshot['records'];
        extraCharges?: PreviousTenantPaymentSnapshot['extraCharges'];
        credits?: PreviousTenantPaymentSnapshot['credits'];
      }
    >;
    const p = all[tenantId];
    if (!p) return undefined;
    const records = Array.isArray(p.records) ? p.records : [];
    return {
      rentalType: p.rentalType,
      rentAmount: p.rentAmount,
      totalPaid: getTotalPaidForTenant(tenantId),
      paymentCount: records.length,
      billingPeriod: p.billingPeriod,
      records,
      extraCharges: Array.isArray(p.extraCharges) ? p.extraCharges : [],
      credits: Array.isArray(p.credits) ? p.credits : [],
    };
  } catch {
    return undefined;
  }
}

export function listPreviousTenants(): PreviousTenantRecord[] {
  return loadAll().sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
}

export function getPreviousTenant(id: string): PreviousTenantRecord | null {
  return loadAll().find((r) => r.id === id) ?? null;
}

export function archiveTenant(opts: {
  tenant: Tenant;
  reason?: PreviousTenantRecord['reason'];
  archiveNote?: string;
  includePayment?: boolean;
}): PreviousTenantRecord {
  const tenant = { ...opts.tenant };
  // Mark as previous in snapshot
  tenant.status = tenant.status === 'Active' ? 'Previous' : tenant.status || 'Previous';
  if (!tenant.endDate || tenant.endDate === 'ongoing') {
    tenant.endDate = new Date().toISOString().slice(0, 10);
  }

  const record: PreviousTenantRecord = {
    id: newArchiveId(),
    archivedAt: new Date().toISOString(),
    reason: opts.reason || 'removed',
    archiveNote: (opts.archiveNote || '').trim() || undefined,
    tenant,
    payment:
      opts.includePayment === false
        ? undefined
        : buildPaymentSnapshot(opts.tenant.id),
  };

  const list = loadAll();
  list.unshift(record);
  saveAll(list);
  return record;
}

/** Manual entry for someone who was never in the live tenant list. */
export function addPreviousTenantManual(input: {
  name: string;
  site?: string;
  phone?: string;
  email?: string;
  address?: string;
  rvType?: string;
  licensePlate?: string;
  emergencyContact?: string;
  notes?: string;
  startDate?: string;
  endDate?: string;
  rentalType?: Tenant['rentalType'];
  archiveNote?: string;
}): PreviousTenantRecord {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Name is required');

  const tenant: Tenant = {
    id: `manual_${Date.now().toString(36)}`,
    name,
    site: String(input.site || '').trim() || '—',
    status: 'Previous',
    phone: (input.phone || '').trim() || undefined,
    email: (input.email || '').trim() || undefined,
    address: (input.address || '').trim() || undefined,
    rvType: (input.rvType || '').trim() || undefined,
    licensePlate: (input.licensePlate || '').trim() || undefined,
    emergencyContact: (input.emergencyContact || '').trim() || undefined,
    notes: (input.notes || '').trim() || undefined,
    startDate: (input.startDate || '').trim() || undefined,
    endDate: (input.endDate || '').trim() || new Date().toISOString().slice(0, 10),
    rentalType: input.rentalType,
  };

  return archiveTenant({
    tenant,
    reason: 'manual',
    archiveNote: input.archiveNote,
    includePayment: false,
  });
}

export function updatePreviousTenant(
  id: string,
  updates: {
    archiveNote?: string;
    tenant?: Partial<Tenant>;
  }
): PreviousTenantRecord | null {
  const list = loadAll();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const current = list[idx];
  const nextTenant = updates.tenant
    ? { ...current.tenant, ...updates.tenant, id: current.tenant.id }
    : current.tenant;
  if (updates.tenant?.name != null) {
    nextTenant.name = String(updates.tenant.name).trim() || current.tenant.name;
  }
  list[idx] = {
    ...current,
    archiveNote:
      updates.archiveNote !== undefined
        ? String(updates.archiveNote).trim() || undefined
        : current.archiveNote,
    tenant: nextTenant,
  };
  saveAll(list);
  return list[idx];
}

export function deletePreviousTenant(id: string): boolean {
  const list = loadAll();
  const next = list.filter((r) => r.id !== id);
  if (next.length === list.length) return false;
  saveAll(next);
  return true;
}
