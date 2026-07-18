import { Slot, RentalType } from '../types';
import { allowsRentalType, calculateStayTotal, parseDateKey } from '../rentUtils';
import { getActiveProperty, getActiveRentalRates } from './propertiesStore';

export interface BookingRequestBody {
  slotId?: string;
  rentalType?: RentalType;
  checkIn?: string;
  checkOut?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactRvType?: string;
  contactLicensePlate?: string;
  contactEmergency?: string;
  contactNotes?: string;
  paymentMethod?: string;
}

export interface ParsedBooking {
  name: string;
  email: string;
  slotId: string;
  checkIn: string;
  checkOut: string;
  rentalType: RentalType;
  total: number;
  contactPhone: string;
  contactEmail: string;
  contactRvType: string;
  contactLicensePlate: string;
  contactEmergency: string;
  contactNotes: string;
  paymentMethod: string;
}

export function parseBookingRequest(
  body: BookingRequestBody
): { ok: true; data: ParsedBooking } | { ok: false; error: string } {
  const name = (body.contactName || '').trim();
  const email = (body.contactEmail || '').trim().toLowerCase();
  const slotId = body.slotId;
  const checkIn = body.checkIn;
  const checkOut = body.checkOut;
  const rentalType = body.rentalType ?? 'monthly';

  if (!name) return { ok: false, error: 'Contact name is required' };
  if (!slotId) return { ok: false, error: 'Site is required' };
  if (!checkIn || !checkOut) return { ok: false, error: 'Check-in and check-out dates are required' };

  const activeProperty = getActiveProperty();
  if (!allowsRentalType(activeProperty, rentalType)) {
    return {
      ok: false,
      error: `${rentalType} stays are not offered for ${activeProperty?.name ?? 'this property'}`,
    };
  }

  const checkInDate = parseDateKey(checkIn);
  const checkOutDate = parseDateKey(checkOut);
  if (checkOutDate <= checkInDate) {
    return { ok: false, error: 'Check-out must be after check-in' };
  }

  const rates = getActiveRentalRates();
  const total = calculateStayTotal(rentalType, checkInDate, checkOutDate, rates);
  if (total <= 0) return { ok: false, error: 'Invalid stay dates' };

  return {
    ok: true,
    data: {
      name,
      email,
      slotId,
      checkIn,
      checkOut,
      rentalType,
      total,
      contactPhone: body.contactPhone || '',
      contactEmail: body.contactEmail || '',
      contactRvType: body.contactRvType || '',
      contactLicensePlate: body.contactLicensePlate || '',
      contactEmergency: body.contactEmergency || '',
      contactNotes: body.contactNotes || '',
      paymentMethod: body.paymentMethod || 'Card',
    },
  };
}

export function canBookSlot(slot: Slot, email: string, allowReserved = false): string | null {
  if (slot.status === 'available') return null;
  if (
    allowReserved
    && slot.status === 'reserved'
    && slot.contactEmail?.trim().toLowerCase() === email
  ) {
    return null;
  }
  if (slot.status === 'reserved') return 'This site is already reserved';
  return 'This site is no longer available';
}

export function buildSlotBookingUpdates(parsed: ParsedBooking, paid: boolean): Partial<Slot> {
  const method = parsed.paymentMethod;
  return {
    status: 'reserved',
    contactName: parsed.name,
    contactPhone: parsed.contactPhone,
    contactEmail: parsed.contactEmail,
    contactRvType: parsed.contactRvType,
    contactLicensePlate: parsed.contactLicensePlate,
    contactEmergency: parsed.contactEmergency,
    contactNotes: parsed.contactNotes,
    rentalType: parsed.rentalType,
    rentAmount: parsed.total,
    balanceDue: paid ? 0 : parsed.total,
    startDate: parsed.checkIn,
    endDate: parsed.checkOut,
    paymentMethod: paid ? method : undefined,
    bookedAt: new Date().toISOString().split('T')[0],
    notes: paid
      ? `Booked online via ${method}`
      : 'Website booking started — payment pending',
  };
}