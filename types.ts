export type SlotStatus = 'available' | 'occupied' | 'reserved' | 'maintenance';

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
}

export interface Tenant {
  id: string;
  name: string;
  site: string;
  status: string;
  imageUrl?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface Photo {
  id: string;
  url: string;
  caption: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}
