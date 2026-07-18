export type SlotStatus = 'available' | 'occupied' | 'reserved' | 'maintenance';
export type RentalType = 'weekly' | 'monthly' | 'daily';

export interface Slot {
  id: string;
  number: number;
  label: string;
  status: SlotStatus;
  tenantName?: string;
  tenantId?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactRvType?: string;
  contactLicensePlate?: string;
  contactEmergency?: string;
  contactNotes?: string;
  rentAmount?: number;
  rentalType?: RentalType;
  balanceDue?: number;
  imageUrl?: string;
  paymentMethod?: string;
  bookedAt?: string;
}

export interface Tenant {
  id: string;
  name: string;
  site: string;
  status: string;
  rentalType?: RentalType;
  imageUrl?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  phone?: string;
  email?: string;
  rvType?: string;
  licensePlate?: string;
  emergencyContact?: string;
  notes?: string;
}

export interface PaymentRecord {
  id: string;
  date: string;
  amount: number;
  method: string;
  note?: string;
}

export interface MeterRecord {
  id: string;
  date: string;
  reading: number;
  previousReading: number;
  usage: number;
  note?: string;
}

export interface ExtraCharge {
  id: string;
  date: string;
  amount: number;
  /** Short label, e.g. "Pet fee", "Late fee", "Propane" */
  description: string;
  note?: string;
}

/** Credit applied to reduce balance due (not a cash payment). */
export interface PaymentCredit {
  id: string;
  date: string;
  amount: number;
  /** Short label, e.g. "Courtesy credit", "Overpayment", "Promo" */
  description: string;
  note?: string;
}

/**
 * Card on file for API/UI display.
 * Never includes full PAN or CVV — last 4 digits only.
 */
export interface SavedPaymentCard {
  id: string;
  label?: string;
  cardholderName: string;
  brand: string;
  last4: string;
  expMonth: string;
  expYear: string;
  billingZip?: string;
  isDefault?: boolean;
  notes?: string;
  createdAt: string;
}

/**
 * On-disk card record: sensitive fields live only inside AES-GCM `sealed` blob.
 * Full PAN and CVV must never be stored.
 */
export interface StoredPaymentCard {
  id: string;
  brand: string;
  isDefault?: boolean;
  createdAt: string;
  /** Encrypted CardSensitivePayload (name, last4, expiry, zip, label, notes) */
  sealed: string;
  /** @deprecated legacy plaintext fields — migrated on read */
  cardholderName?: string;
  last4?: string;
  expMonth?: string;
  expYear?: string;
  billingZip?: string;
  label?: string;
  notes?: string;
}

export interface TenantPayment {
  tenantId: string;
  rentalType?: RentalType;
  /**
   * Cards on file. On disk these are StoredPaymentCard[];
   * API responses expose decrypted SavedPaymentCard[] (last 4 only).
   */
  savedCards?: Array<SavedPaymentCard | StoredPaymentCard>;
  /** Rent charged for the current billing period (may be prorated for monthly). */
  rentAmount: number;
  /** Full monthly rate before proration (monthly rentals). */
  baseMonthlyRate?: number;
  /**
   * User-chosen dates for monthly proration (YYYY-MM-DD).
   * When set, period rent = (baseMonthlyRate ÷ days in month) × days from start through end.
   * Falls back to tenant start date / period month ends when omitted.
   */
  rentChargeStart?: string;
  rentChargeEnd?: string;
  currentReadingTotal: number;
  baselineCredit?: number;
  balanceDue: number;
  previousMeterReading?: number;
  records: PaymentRecord[];
  meterRecords?: MeterRecord[];
  /** One-off fees added to period charges (pet fee, late fee, etc.). */
  extraCharges?: ExtraCharge[];
  /** Credits that reduce balance due for the current period. */
  credits?: PaymentCredit[];
  /** Current billing period key, e.g. "2026-07" (monthly) */
  billingPeriod?: string;
  /**
   * Unpaid amount carried from the previous period.
   * 0 when the previous period was paid in full — new month starts clean.
   */
  carriedBalance?: number;
  /**
   * Total of payment records already settled into prior periods.
   * Period payments = sum(records) − paymentBaseline.
   */
  paymentBaseline?: number;
  /** Present when rent was auto-prorated from start date for this period. */
  rentProration?: {
    fullRate: number;
    dailyRate: number;
    daysCharged: number;
    billableDays?: number;
    extraDaysFor31DayMonth?: number;
    daysInPeriod: number;
    prorated: boolean;
    chargeStart: string;
    chargeEnd: string;
  };
}

export type MediaType = 'image' | 'video';

export interface Photo {
  id: string;
  url: string;
  caption: string;
  published?: boolean;
  /** Defaults to image for legacy items */
  mediaType?: MediaType;
}

export interface BookingContactInfo {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  contactRvType: string;
  contactLicensePlate: string;
  contactEmergency: string;
  contactNotes: string;
}

export interface StoredCustomer {
  id: string;
  name: string;
  phone: string;
  email: string;
  rvType?: string;
  licensePlate?: string;
  emergencyContact?: string;
  notes?: string;
  updatedAt?: string;
}

export interface ParkContact {
  phone: string;
  email: string;
  contactName: string;
  address?: string;
  tagline: string;
}

export interface CustomerComment {
  id: string;
  name: string;
  comment: string;
  rating?: number;
  createdAt: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}
