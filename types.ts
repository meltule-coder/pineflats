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

export interface TenantPayment {
  tenantId: string;
  rentalType?: RentalType;
  rentAmount: number;
  currentReadingTotal: number;
  baselineCredit?: number;
  balanceDue: number;
  previousMeterReading?: number;
  records: PaymentRecord[];
  meterRecords?: MeterRecord[];
}

export interface Photo {
  id: string;
  url: string;
  caption: string;
  published?: boolean;
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

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}
