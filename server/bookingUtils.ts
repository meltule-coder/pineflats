import { Slot, RentalType } from '../types';
import {
  allowsRentalType,
  calculateStayBreakdown,
  calculateStayTotal,
  parseDateKey,
  type StayTaxBreakdown,
} from '../rentUtils';
import { getActiveProperty, getActiveRentalRates } from './propertiesStore';

/** Safe card metadata only — never full PAN or CVV. */
export interface BookingCardMeta {
  cardholderName?: string;
  brand?: string;
  last4?: string;
  expMonth?: string;
  expYear?: string;
  billingZip?: string;
}

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
  /** Last-4 / brand only — full card number & CVV must never be sent or stored. */
  cardMeta?: BookingCardMeta;
  /** Rejected if present — never persist. */
  cardNumber?: string;
  cvv?: string;
  cvc?: string;
}

export interface ParsedBooking {
  name: string;
  email: string;
  slotId: string;
  checkIn: string;
  checkOut: string;
  rentalType: RentalType;
  total: number;
  tax?: StayTaxBreakdown;
  contactPhone: string;
  contactEmail: string;
  contactRvType: string;
  contactLicensePlate: string;
  contactEmergency: string;
  contactNotes: string;
  paymentMethod: string;
  /** Sanitized last-4 card summary for admin notes (never PAN/CVV). */
  cardSummary?: string;
}

/** Strip any full PAN / CVV and keep only last-4 style metadata. */
export function sanitizeCardMeta(raw: unknown): BookingCardMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const last4 = String(m.last4 || '').replace(/\D/g, '').slice(-4);
  if (last4.length !== 4) return undefined;
  const expMonth = String(m.expMonth || '').replace(/\D/g, '').slice(0, 2);
  const expYear = String(m.expYear || '').replace(/\D/g, '').slice(0, 4);
  return {
    cardholderName: String(m.cardholderName || '').trim().slice(0, 80) || undefined,
    brand: String(m.brand || 'Card').trim().slice(0, 32) || 'Card',
    last4,
    expMonth: expMonth || undefined,
    expYear: expYear || undefined,
    billingZip: String(m.billingZip || '').replace(/[^\dA-Za-z- ]/g, '').slice(0, 12) || undefined,
  };
}

export function parseBookingRequest(
  body: BookingRequestBody
): { ok: true; data: ParsedBooking } | { ok: false; error: string } {
  // Hard reject full card secrets if a client accidentally posts them
  const dangerous =
    (typeof body.cardNumber === 'string' && body.cardNumber.replace(/\D/g, '').length >= 12) ||
    (typeof body.cvv === 'string' && body.cvv.trim().length > 0) ||
    (typeof body.cvc === 'string' && body.cvc.trim().length > 0);
  if (dangerous) {
    return {
      ok: false,
      error: 'Full card numbers and CVV cannot be submitted to the park server. Use the card form fields only.',
    };
  }

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
  const tax = calculateStayBreakdown(rentalType, checkInDate, checkOutDate, rates);
  const total = tax.grandTotal || calculateStayTotal(rentalType, checkInDate, checkOutDate, rates);
  if (total <= 0) return { ok: false, error: 'Invalid stay dates' };

  // Card numbers / last-4 / expiry belong with the payment processor only — never park records.
  // Accept method "Card" (or "Card •••• xxxx" from older clients) as plain "Card".
  let paymentMethod = String(body.paymentMethod || 'Card').trim() || 'Card';
  if (/^card\b/i.test(paymentMethod) || /••••|last\s*4/i.test(paymentMethod)) {
    paymentMethod = 'Card';
  }
  // Ignore cardMeta for storage (still reject full PAN via sanitize above path)
  void sanitizeCardMeta(body.cardMeta);

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
      tax,
      contactPhone: body.contactPhone || '',
      contactEmail: body.contactEmail || '',
      contactRvType: body.contactRvType || '',
      contactLicensePlate: body.contactLicensePlate || '',
      contactEmergency: body.contactEmergency || '',
      contactNotes: body.contactNotes || '',
      paymentMethod,
      // Intentionally omitted — never persist card digits on admin site
      cardSummary: undefined,
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
  // Occupied sites may still accept a non-overlapping future stay (date check
  // runs in slotConflictForStay). Reserved/maintenance stay blocked here.
  if (slot.status === 'occupied') return null;
  if (slot.status === 'maintenance') return 'This site is under maintenance';
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