import fs from 'fs';
import path from 'path';
import { TenantPayment, PaymentRecord, MeterRecord, RentalType } from '../types';
import { rentAmountForType } from '../rentUtils';
import { getTenant } from './tenantsStore';

const DATA_DIR = path.join(process.cwd(), 'data');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadAll(): Record<string, TenantPayment> {
  ensureDataDir();
  if (!fs.existsSync(PAYMENTS_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8'));
}

function saveAll(data: Record<string, TenantPayment>) {
  ensureDataDir();
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(data, null, 2));
}

function resolveRentalType(tenantId: string, payment?: TenantPayment): RentalType {
  if (payment?.rentalType) return payment.rentalType;
  const tenant = getTenant(tenantId);
  if (tenant?.rentalType) return tenant.rentalType;
  return 'monthly';
}

function defaultPayment(tenantId: string): TenantPayment {
  const rentalType = resolveRentalType(tenantId);
  return {
    tenantId,
    rentalType,
    rentAmount: rentAmountForType(rentalType),
    currentReadingTotal: 0,
    baselineCredit: 0,
    balanceDue: 0,
    previousMeterReading: 0,
    records: [],
    meterRecords: [],
  };
}

function resolveRentAmount(payment: TenantPayment & { monthlyRate?: number }, tenantId: string): number {
  if (payment.rentAmount != null) return payment.rentAmount;
  if (payment.monthlyRate != null) return payment.monthlyRate;
  return rentAmountForType(resolveRentalType(tenantId, payment));
}

function resolveCurrentReadingTotal(payment: TenantPayment): number {
  if (payment.currentReadingTotal != null) return payment.currentReadingTotal;
  const meterRecords = payment.meterRecords ?? [];
  if (meterRecords.length > 0) return meterRecords[0].usage;
  return 0;
}

function getEffectivePreviousReading(payment: TenantPayment): number {
  const meterRecords = payment.meterRecords ?? [];
  if (meterRecords.length > 0) return meterRecords[0].reading;
  return payment.previousMeterReading ?? 0;
}

export function syncPreviousMeterReading(payment: TenantPayment): TenantPayment {
  const meterRecords = payment.meterRecords ?? [];
  if (meterRecords.length === 0) return payment;
  return { ...payment, previousMeterReading: meterRecords[0].reading };
}

export function getTenantPayment(tenantId: string): TenantPayment {
  const all = loadAll();
  if (!all[tenantId]) {
    all[tenantId] = defaultPayment(tenantId);
    saveAll(all);
  }
  const payment = all[tenantId];
  const synced = syncPreviousMeterReading(payment);
  const rentalType = resolveRentalType(tenantId, synced);
  const rentAmount = resolveRentAmount(synced, tenantId);
  const updated = { ...synced, rentalType, rentAmount };
  if (
    updated.previousMeterReading !== payment.previousMeterReading ||
    updated.rentalType !== payment.rentalType
  ) {
    all[tenantId] = updated;
    saveAll(all);
  }
  return {
    ...updated,
    rentAmount,
    currentReadingTotal: resolveCurrentReadingTotal(synced),
    baselineCredit: synced.baselineCredit ?? 0,
    previousMeterReading: synced.previousMeterReading ?? 0,
    meterRecords: synced.meterRecords ?? [],
  };
}

export function updateTenantPayment(tenantId: string, updates: Partial<TenantPayment>): TenantPayment {
  const all = loadAll();
  const current = all[tenantId] ?? defaultPayment(tenantId);
  all[tenantId] = {
    ...current,
    ...updates,
    tenantId,
    records: updates.records ?? current.records,
    meterRecords: updates.meterRecords ?? current.meterRecords ?? [],
  };
  saveAll(all);
  return all[tenantId];
}

export function addPaymentRecord(
  tenantId: string,
  record: Omit<PaymentRecord, 'id'>
): TenantPayment {
  const all = loadAll();
  const current = all[tenantId] ?? defaultPayment(tenantId);
  const newRecord: PaymentRecord = { ...record, id: `pay-${Date.now()}` };
  const balanceDue = Math.max(0, current.balanceDue - record.amount);
  all[tenantId] = {
    ...current,
    balanceDue,
    records: [newRecord, ...current.records],
    meterRecords: current.meterRecords ?? [],
  };
  saveAll(all);
  return all[tenantId];
}

export function addMeterRecord(
  tenantId: string,
  record: Omit<MeterRecord, 'id' | 'previousReading' | 'usage'> & { reading: number }
): TenantPayment {
  const all = loadAll();
  const current = all[tenantId] ?? defaultPayment(tenantId);
  const meterRecords = current.meterRecords ?? [];
  const previousReading = getEffectivePreviousReading(current);
  const usage = Math.max(0, record.reading - previousReading);
  const newRecord: MeterRecord = {
    ...record,
    id: `meter-${Date.now()}`,
    previousReading,
    usage,
  };
  all[tenantId] = {
    ...current,
    currentReadingTotal: usage,
    previousMeterReading: record.reading,
    meterRecords: [newRecord, ...meterRecords],
  };
  saveAll(all);
  return all[tenantId];
}