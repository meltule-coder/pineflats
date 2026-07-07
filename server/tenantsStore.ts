import fs from 'fs';
import path from 'path';
import { Tenant } from '../types';

const DATA_DIR = path.join(process.cwd(), 'data');
const TENANTS_FILE = path.join(DATA_DIR, 'tenants.json');

const DEFAULT_TENANTS: Tenant[] = [
  { id: '3', name: 'Dawn Beinke', site: '1', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '4', name: 'Michelle Thomasson', site: '3', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '5', name: 'Ralph Pina', site: '8', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '6', name: 'Austin Mackey', site: '10', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '7', name: 'Valerie Johnston', site: '12', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '8', name: 'Ray Hendrickson', site: '18', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '9', name: 'Charles Norris', site: '19', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '10', name: 'Michael Madden', site: '20', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '11', name: 'Laney Nellis', site: '21', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '12', name: 'Ron Peck', site: '22', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '13', name: 'Ryan Shanley', site: '23', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '14', name: 'Amanda Kline', site: '24', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing' },
  { id: '15', name: 'Jake DeOre', site: '11', status: 'Active', imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', endDate: 'ongoing', rentalType: 'weekly' },
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getTenants(): Tenant[] {
  ensureDataDir();
  if (!fs.existsSync(TENANTS_FILE)) {
    fs.writeFileSync(TENANTS_FILE, JSON.stringify(DEFAULT_TENANTS, null, 2));
    return DEFAULT_TENANTS;
  }
  return JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf-8'));
}

export function saveTenants(tenants: Tenant[]) {
  ensureDataDir();
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(tenants, null, 2));
}

export function getTenant(id: string): Tenant | null {
  return getTenants().find(t => t.id === id) ?? null;
}

export function updateTenant(id: string, updates: Partial<Tenant>): Tenant | null {
  const tenants = getTenants();
  const index = tenants.findIndex(t => t.id === id);
  if (index === -1) return null;
  tenants[index] = { ...tenants[index], ...updates };
  saveTenants(tenants);
  return tenants[index];
}

export function addTenant(tenant: Tenant) {
  const tenants = getTenants();
  tenants.push(tenant);
  saveTenants(tenants);
  return tenant;
}

export function removeTenantByName(tenantName: string): boolean {
  const tenants = getTenants();
  const filtered = tenants.filter(t => !t.name.toLowerCase().includes(tenantName.toLowerCase()));
  if (filtered.length === tenants.length) return false;
  saveTenants(filtered);
  return true;
}

export function findTenantByName(tenantName: string): Tenant | undefined {
  return getTenants().find(t => t.name.toLowerCase().includes(tenantName.toLowerCase()));
}

export function nextTenantId(): string {
  const tenants = getTenants();
  const maxId = tenants.reduce((max, tenant) => Math.max(max, Number.parseInt(tenant.id, 10) || 0), 0);
  return String(maxId + 1);
}