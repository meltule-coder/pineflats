import { Slot } from '../types';

export const SLOT_CONTACT_CLEAR: Partial<Slot> = {
  contactName: undefined,
  contactPhone: undefined,
  contactEmail: undefined,
  contactRvType: undefined,
  contactLicensePlate: undefined,
  contactEmergency: undefined,
  contactNotes: undefined,
  tenantName: undefined,
  tenantId: undefined,
  startDate: undefined,
  endDate: undefined,
  notes: undefined,
  rentAmount: undefined,
  rentalType: undefined,
  balanceDue: undefined,
};

export function clearSlotContactFields<T extends Record<string, unknown>>(updates: T): T & Partial<Slot> {
  return { ...updates, ...SLOT_CONTACT_CLEAR };
}