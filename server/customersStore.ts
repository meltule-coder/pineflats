import fs from 'fs';
import path from 'path';
import { StoredCustomer } from '../types';

const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getCustomers(): StoredCustomer[] {
  ensureDataDir();
  if (!fs.existsSync(CUSTOMERS_FILE)) {
    fs.writeFileSync(CUSTOMERS_FILE, '[]');
    return [];
  }
  return JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf-8'));
}

export function saveCustomers(customers: StoredCustomer[]) {
  ensureDataDir();
  fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2));
}

export function nextCustomerId(): string {
  const customers = getCustomers();
  const numericIds = customers.map(c => Number(c.id)).filter(n => !Number.isNaN(n));
  const max = numericIds.length > 0 ? Math.max(...numericIds) : 0;
  return String(max + 1);
}

export function addCustomer(data: Omit<StoredCustomer, 'id'> & { id?: string }): StoredCustomer {
  const customers = getCustomers();
  const customer: StoredCustomer = {
    id: data.id ?? nextCustomerId(),
    name: data.name.trim(),
    phone: data.phone?.trim() ?? '',
    email: data.email?.trim() ?? '',
    rvType: data.rvType?.trim() ?? '',
    licensePlate: data.licensePlate?.trim() ?? '',
    emergencyContact: data.emergencyContact?.trim() ?? '',
    notes: data.notes?.trim() ?? '',
    updatedAt: new Date().toISOString().split('T')[0],
  };
  customers.push(customer);
  saveCustomers(customers);
  return customer;
}

export function updateCustomer(id: string, updates: Partial<StoredCustomer>): StoredCustomer | null {
  const customers = getCustomers();
  const index = customers.findIndex(c => c.id === id);
  if (index === -1) return null;
  customers[index] = {
    ...customers[index],
    ...updates,
    name: (updates.name ?? customers[index].name).trim(),
    updatedAt: new Date().toISOString().split('T')[0],
  };
  saveCustomers(customers);
  return customers[index];
}

export function deleteCustomer(id: string): boolean {
  const customers = getCustomers();
  const next = customers.filter(c => c.id !== id);
  if (next.length === customers.length) return false;
  saveCustomers(next);
  return true;
}

export function upsertCustomer(data: {
  name: string;
  phone?: string;
  email?: string;
  rvType?: string;
  licensePlate?: string;
  emergencyContact?: string;
  notes?: string;
}): StoredCustomer {
  const name = data.name.trim();
  const customers = getCustomers();
  const existing = customers.find(
    c => c.name.toLowerCase() === name.toLowerCase()
      || (data.email && c.email.toLowerCase() === data.email.toLowerCase())
  );
  if (existing) {
    return updateCustomer(existing.id, data) ?? existing;
  }
  return addCustomer(data);
}