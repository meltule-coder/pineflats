/**
 * Shared card references for renewals: brand + last 4 only (never full PAN/CVV).
 * Available for monthly tenants and any customer renewing a stay.
 */
import fs from 'fs';
import path from 'path';
import { PaymentCardRef } from '../types';
import { atomicWriteJson } from './persist';
import { sanitizeToLast4, detectCardBrandFromLast4Only } from './cardSecurity';
import { getTenant, getTenants } from './tenantsStore';
import { getTenantPayment, addSavedCard, publicSavedCards } from './paymentsStore';
import { upsertCustomer } from './customersStore';

const DATA_DIR = path.join(process.cwd(), 'data');
const CARD_REFS_FILE = path.join(DATA_DIR, 'card-refs.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadRefs(): PaymentCardRef[] {
  ensureDataDir();
  if (!fs.existsSync(CARD_REFS_FILE)) {
    atomicWriteJson(CARD_REFS_FILE, []);
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CARD_REFS_FILE, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveRefs(refs: PaymentCardRef[]) {
  ensureDataDir();
  atomicWriteJson(CARD_REFS_FILE, refs);
}

function newId(): string {
  return `cref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normName(s?: string): string {
  return String(s || '').trim().toLowerCase();
}

function normEmail(s?: string): string {
  return String(s || '').trim().toLowerCase();
}

/** Public view: brand + last4 only (plus guest/site context for staff). */
export function toPublicCardRef(ref: PaymentCardRef): PaymentCardRef {
  return {
    id: ref.id,
    brand: ref.brand || 'Card',
    last4: String(ref.last4 || '').replace(/\D/g, '').slice(-4),
    guestName: ref.guestName || 'Guest',
    guestEmail: ref.guestEmail,
    guestPhone: ref.guestPhone,
    customerId: ref.customerId,
    tenantId: ref.tenantId,
    site: ref.site,
    isDefault: ref.isDefault,
    createdAt: ref.createdAt,
    updatedAt: ref.updatedAt,
    source: ref.source,
  };
}

/**
 * Upsert a brand + last4 reference for a guest.
 * Dedupes on last4 + brand + (email or name).
 */
export function upsertPaymentCardRef(input: {
  brand?: string;
  last4: string;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  customerId?: string;
  tenantId?: string;
  site?: string;
  isDefault?: boolean;
  source?: PaymentCardRef['source'];
}): PaymentCardRef | null {
  const last4 = sanitizeToLast4(input.last4);
  if (!last4) return null;
  const brand = detectCardBrandFromLast4Only(last4, input.brand);
  const guestName = String(input.guestName || '').trim() || 'Guest';
  const guestEmail = String(input.guestEmail || '').trim() || undefined;
  const guestPhone = String(input.guestPhone || '').trim() || undefined;

  // Link to customer directory when possible
  let customerId = input.customerId;
  if (!customerId && (guestEmail || guestName)) {
    try {
      const customer = upsertCustomer({
        name: guestName,
        email: guestEmail,
        phone: guestPhone,
      });
      customerId = customer.id;
    } catch {
      /* ignore */
    }
  }

  const refs = loadRefs();
  const emailKey = normEmail(guestEmail);
  const nameKey = normName(guestName);
  const existingIdx = refs.findIndex(r => {
    if (r.last4 !== last4) return false;
    if ((r.brand || 'Card').toLowerCase() !== brand.toLowerCase()) return false;
    if (emailKey && normEmail(r.guestEmail) === emailKey) return true;
    if (nameKey && normName(r.guestName) === nameKey) return true;
    if (customerId && r.customerId === customerId) return true;
    if (input.tenantId && r.tenantId === input.tenantId) return true;
    return false;
  });

  const today = new Date().toISOString().split('T')[0];
  if (existingIdx >= 0) {
    const prev = refs[existingIdx];
    const updated: PaymentCardRef = {
      ...prev,
      brand,
      last4,
      guestName: guestName || prev.guestName,
      guestEmail: guestEmail || prev.guestEmail,
      guestPhone: guestPhone || prev.guestPhone,
      customerId: customerId || prev.customerId,
      tenantId: input.tenantId || prev.tenantId,
      site: input.site || prev.site,
      isDefault: input.isDefault ?? prev.isDefault,
      source: input.source || prev.source,
      updatedAt: today,
    };
    refs[existingIdx] = updated;
    saveRefs(refs);
    return toPublicCardRef(updated);
  }

  const created: PaymentCardRef = {
    id: newId(),
    brand,
    last4,
    guestName,
    guestEmail,
    guestPhone,
    customerId,
    tenantId: input.tenantId,
    site: input.site,
    isDefault: input.isDefault !== false,
    createdAt: today,
    source: input.source || 'manual',
  };
  refs.push(created);
  saveRefs(refs);
  return toPublicCardRef(created);
}

export function listPaymentCardRefs(filter?: {
  customerId?: string;
  tenantId?: string;
  email?: string;
  name?: string;
  q?: string;
}): PaymentCardRef[] {
  // Merge vault + cards still only on tenant payment files
  const vault = loadRefs().map(toPublicCardRef);
  const fromTenants: PaymentCardRef[] = [];

  for (const tenant of getTenants()) {
    const payment = getTenantPayment(tenant.id);
    const cards = publicSavedCards(payment?.savedCards as never);
    for (const c of cards) {
      // Skip if already in vault with same last4+brand for this tenant/name
      const exists = vault.some(
        v =>
          v.last4 === c.last4 &&
          v.brand.toLowerCase() === (c.brand || 'Card').toLowerCase() &&
          (v.tenantId === tenant.id ||
            normName(v.guestName) === normName(tenant.name) ||
            (tenant.email && normEmail(v.guestEmail) === normEmail(tenant.email)))
      );
      if (exists) continue;
      fromTenants.push({
        id: `tenant-${tenant.id}-${c.id}`,
        brand: c.brand || 'Card',
        last4: c.last4,
        guestName: tenant.name,
        guestEmail: tenant.email || undefined,
        guestPhone: tenant.phone || undefined,
        tenantId: tenant.id,
        site: String(tenant.site),
        isDefault: c.isDefault,
        createdAt: c.createdAt,
        source: 'tenant',
      });
    }
  }

  let all = [...vault, ...fromTenants];

  if (filter?.customerId) {
    all = all.filter(r => r.customerId === filter.customerId);
  }
  if (filter?.tenantId) {
    const tenant = getTenant(filter.tenantId);
    all = all.filter(
      r =>
        r.tenantId === filter.tenantId ||
        (tenant &&
          (normName(r.guestName) === normName(tenant.name) ||
            (tenant.email && normEmail(r.guestEmail) === normEmail(tenant.email))))
    );
  }
  if (filter?.email) {
    const e = normEmail(filter.email);
    all = all.filter(r => normEmail(r.guestEmail) === e);
  }
  if (filter?.name) {
    const n = normName(filter.name);
    all = all.filter(r => normName(r.guestName).includes(n) || n.includes(normName(r.guestName)));
  }
  if (filter?.q) {
    const q = filter.q.trim().toLowerCase();
    all = all.filter(
      r =>
        r.guestName.toLowerCase().includes(q) ||
        (r.guestEmail || '').toLowerCase().includes(q) ||
        (r.guestPhone || '').includes(q) ||
        r.brand.toLowerCase().includes(q) ||
        r.last4.includes(q) ||
        (r.site || '').includes(q)
    );
  }

  // Dedupe display by brand+last4+name
  const seen = new Set<string>();
  const deduped: PaymentCardRef[] = [];
  for (const r of all) {
    const key = `${r.last4}|${r.brand.toLowerCase()}|${normName(r.guestName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  deduped.sort((a, b) => {
    const an = a.guestName.localeCompare(b.guestName);
    if (an !== 0) return an;
    return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
  });

  return deduped;
}

export function getPaymentCardRef(id: string): PaymentCardRef | null {
  const vault = loadRefs().find(r => r.id === id);
  if (vault) return toPublicCardRef(vault);
  // Synthetic tenant-card id: tenant-{tenantId}-{cardId}
  const m = /^tenant-(.+?)-(card-.+)$/.exec(id);
  if (m) {
    const tenant = getTenant(m[1]);
    if (!tenant) return null;
    const payment = getTenantPayment(tenant.id);
    const cards = publicSavedCards(payment?.savedCards as never);
    const c = cards.find(x => x.id === m[2]);
    if (!c) return null;
    return {
      id,
      brand: c.brand || 'Card',
      last4: c.last4,
      guestName: tenant.name,
      guestEmail: tenant.email || undefined,
      guestPhone: tenant.phone || undefined,
      tenantId: tenant.id,
      site: String(tenant.site),
      isDefault: c.isDefault,
      createdAt: c.createdAt,
      source: 'tenant',
    };
  }
  return null;
}

export function deletePaymentCardRef(id: string): boolean {
  if (id.startsWith('tenant-')) {
    // Only vault entries are deleted here; tenant cards use tenant card DELETE API
    return false;
  }
  const refs = loadRefs();
  const next = refs.filter(r => r.id !== id);
  if (next.length === refs.length) return false;
  saveRefs(next);
  return true;
}

/**
 * Copy a card ref onto a tenant so it can be used for monthly / stay renewal.
 * Still only brand + last4.
 */
export function applyCardRefToTenant(
  cardRefId: string,
  tenantId: string
): { ok: true; label: string; payment: ReturnType<typeof addSavedCard> } | { ok: false; error: string } {
  const tenant = getTenant(tenantId);
  if (!tenant) return { ok: false, error: 'Tenant not found' };
  const ref = getPaymentCardRef(cardRefId);
  if (!ref || ref.last4.length !== 4) return { ok: false, error: 'Card reference not found' };

  const payment = addSavedCard(tenantId, {
    brand: ref.brand,
    last4: ref.last4,
    cardholderName: tenant.name,
    isDefault: true,
  });
  if (!payment) return { ok: false, error: 'Could not apply card to tenant' };

  // Keep vault linked to this tenant for future renewals
  upsertPaymentCardRef({
    brand: ref.brand,
    last4: ref.last4,
    guestName: tenant.name,
    guestEmail: tenant.email,
    guestPhone: tenant.phone,
    tenantId: tenant.id,
    site: String(tenant.site),
    isDefault: true,
    source: ref.source || 'tenant',
  });

  const label = `${ref.brand} •••• ${ref.last4}`;
  return { ok: true, label, payment };
}

/** Called when a tenant payment saves brand+last4. */
export function syncCardRefFromTenant(
  tenantId: string,
  brand: string,
  last4: string
): PaymentCardRef | null {
  const tenant = getTenant(tenantId);
  if (!tenant) return null;
  return upsertPaymentCardRef({
    brand,
    last4,
    guestName: tenant.name,
    guestEmail: tenant.email,
    guestPhone: tenant.phone,
    tenantId,
    site: String(tenant.site),
    isDefault: true,
    source: 'tenant',
  });
}

export function formatCardRefLabel(ref: Pick<PaymentCardRef, 'brand' | 'last4'>): string {
  return `${ref.brand || 'Card'} •••• ${ref.last4}`;
}

/** Ensure vault has entries from all current tenants (one-time sync helper). */
export function syncVaultFromAllTenants(): { added: number; total: number } {
  let added = 0;
  const before = loadRefs().length;
  for (const tenant of getTenants()) {
    const payment = getTenantPayment(tenant.id);
    const cards = publicSavedCards(payment?.savedCards as never);
    for (const c of cards) {
      const r = upsertPaymentCardRef({
        brand: c.brand,
        last4: c.last4,
        guestName: tenant.name,
        guestEmail: tenant.email,
        guestPhone: tenant.phone,
        tenantId: tenant.id,
        site: String(tenant.site),
        isDefault: c.isDefault,
        source: 'tenant',
      });
      if (r) added += 1;
    }
  }
  // upsert counts updates too; report net new roughly
  const after = loadRefs().length;
  return { added: Math.max(0, after - before), total: after };
}
