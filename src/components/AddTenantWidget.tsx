import { apiFetch } from '../lib/api';
import { useEffect, useState } from 'react';
import { Plus, Save, UserPlus, X, Users, CalendarRange } from 'lucide-react';
import { RentalType, Slot, StoredCustomer } from '../../types';
import {
  ALL_RENTAL_TYPES,
  DEFAULT_RENTAL_RATES,
  rentAmountForType,
  type RentalRatesConfig,
} from '../../rentUtils';
import { fetchActiveRates, subscribeActiveRates, type ActiveRates } from '../lib/activeRates';

function emptyForm(rates: RentalRatesConfig = DEFAULT_RENTAL_RATES) {
  return {
    name: '',
    site: '',
    phone: '',
    email: '',
    rvType: '',
    licensePlate: '',
    emergencyContact: '',
    notes: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: 'ongoing',
    rentalType: 'monthly' as RentalType,
    rentAmount: String(rentAmountForType('monthly', new Date(), rates)),
  };
}

function toDateInput(value?: string): string {
  if (!value) return '';
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return '';
}

interface AddTenantWidgetProps {
  onAdded: (tenant?: { id: string }) => void | Promise<void>;
}

export function AddTenantWidget({ onAdded }: AddTenantWidgetProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => emptyForm());
  const [rates, setRates] = useState<ActiveRates>({
    ...DEFAULT_RENTAL_RATES,
    allowedRentalTypes: [...ALL_RENTAL_TYPES],
  });
  const [availableSites, setAvailableSites] = useState<Slot[]>([]);
  const [reservations, setReservations] = useState<Slot[]>([]);
  const [customers, setCustomers] = useState<StoredCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedReservationId, setSelectedReservationId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadLookups = async () => {
    try {
      const [slotsRes, customersRes] = await Promise.all([
        apiFetch('/api/slots'),
        apiFetch('/api/customers'),
      ]);
      if (slotsRes.ok) {
        const data = await slotsRes.json();
        const slots: Slot[] = Array.isArray(data) ? data : (data.slots ?? []);
        setAvailableSites(
          slots
            .filter((s) => s.status === 'available')
            .sort((a, b) => a.number - b.number)
        );
        setReservations(
          slots
            .filter((s) => s.status === 'reserved')
            .sort((a, b) => a.number - b.number)
        );
      }
      if (customersRes.ok) {
        const list = await customersRes.json();
        setCustomers(Array.isArray(list) ? list : []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const applyRates = (active: ActiveRates) => {
      setRates(active);
      setForm(prev => {
        const rentalType = active.allowedRentalTypes.includes(prev.rentalType)
          ? prev.rentalType
          : (active.allowedRentalTypes[0] ?? 'monthly');
        return {
          ...prev,
          rentalType,
          rentAmount: String(rentAmountForType(rentalType, new Date(), active)),
        };
      });
    };
    if (open) {
      loadLookups();
      fetchActiveRates({ force: true }).then(applyRates);
    }
    return subscribeActiveRates(() => {
      if (!open) return;
      fetchActiveRates({ force: true }).then(applyRates);
    });
  }, [open]);

  const reset = () => {
    setForm(emptyForm(rates));
    setSelectedCustomerId('');
    setSelectedReservationId('');
    setError('');
    setOpen(false);
  };

  const setRentalType = (rentalType: RentalType) => {
    setForm((p) => ({
      ...p,
      rentalType,
      rentAmount: String(rentAmountForType(rentalType, new Date(), rates)),
    }));
  };

  const applyCustomer = (customer: StoredCustomer) => {
    setSelectedCustomerId(customer.id);
    setSelectedReservationId('');
    setForm((p) => ({
      ...p,
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      rvType: customer.rvType || '',
      licensePlate: customer.licensePlate || '',
      emergencyContact: customer.emergencyContact || '',
      notes: customer.notes || '',
    }));
  };

  const applyReservation = (slot: Slot) => {
    setSelectedReservationId(slot.id);
    setSelectedCustomerId('');
    const rentalType = (slot.rentalType && rates.allowedRentalTypes.includes(slot.rentalType)
      ? slot.rentalType
      : (form.rentalType || rates.allowedRentalTypes[0] || 'monthly')) as RentalType;
    const rent =
      slot.rentAmount != null && Number(slot.rentAmount) > 0
        ? String(slot.rentAmount)
        : String(rentAmountForType(rentalType, new Date(), rates));
    setForm({
      name: (slot.contactName || slot.tenantName || '').trim(),
      site: String(slot.number),
      phone: slot.contactPhone || '',
      email: slot.contactEmail || '',
      rvType: slot.contactRvType || '',
      licensePlate: slot.contactLicensePlate || '',
      emergencyContact: slot.contactEmergency || '',
      notes: slot.contactNotes || slot.notes || '',
      startDate: toDateInput(slot.startDate) || new Date().toISOString().split('T')[0],
      endDate: slot.endDate && slot.endDate !== 'ongoing'
        ? (toDateInput(slot.endDate) || slot.endDate)
        : 'ongoing',
      rentalType,
      rentAmount: rent,
    });
  };

  const siteOptions: { value: string; label: string; kind: 'available' | 'reserved' }[] = [
    ...availableSites.map((s) => ({
      value: String(s.number),
      label: `Space ${s.number}${s.label && s.label !== String(s.number) ? ` (${s.label})` : ''} · available`,
      kind: 'available' as const,
    })),
    ...reservations.map((s) => ({
      value: String(s.number),
      label: `Space ${s.number}${s.label && s.label !== String(s.number) ? ` (${s.label})` : ''} · reserved${s.contactName ? ` · ${s.contactName}` : ''}`,
      kind: 'reserved' as const,
    })),
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.site) {
      setError('Name and site are required.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          site: form.site,
          phone: form.phone.trim(),
          email: form.email.trim(),
          rvType: form.rvType.trim(),
          licensePlate: form.licensePlate.trim(),
          emergencyContact: form.emergencyContact.trim(),
          notes: form.notes.trim(),
          startDate: form.startDate || undefined,
          endDate: form.endDate || 'ongoing',
          rentalType: form.rentalType,
          rentAmount: parseFloat(form.rentAmount) || 0,
          balanceDue: parseFloat(form.rentAmount) || 0,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to add tenant');
        return;
      }
      const created = await res.json().catch(() => null);
      await onAdded(created && created.id ? { id: String(created.id) } : undefined);
      reset();
    } catch {
      setError('Network error — could not add tenant.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex justify-end">
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 bg-[#5A6355] text-white rounded-2xl px-4 py-3 text-sm font-semibold shadow-sm hover:bg-[#4a5347] transition"
          >
            <UserPlus className="w-4 h-4" />
            Add Tenant
          </button>
        ) : (
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl text-sm border border-[#E2D9D0] bg-white hover:bg-[#FBF9F7] transition"
          >
            <X className="w-4 h-4" />
            Close form
          </button>
        )}
      </div>

      {open && (
        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-[#EDE7E1] flex items-center justify-center">
              <Plus className="w-5 h-5 text-[#5A6355]" />
            </div>
            <div>
              <h3 className="text-lg font-serif text-[#3D3730]">Add New Tenant</h3>
              <p className="text-xs text-[#5A6355]">
                Prefill from a returning customer or current reservation, or enter details manually
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-2">
                <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] font-medium">
                  <Users className="w-3.5 h-3.5" />
                  Returning customer
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      setSelectedCustomerId('');
                      return;
                    }
                    const customer = customers.find((c) => c.id === id);
                    if (customer) applyCustomer(customer);
                  }}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                >
                  <option value="">Select a returning customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.phone ? ` · ${c.phone}` : ''}
                      {c.email ? ` · ${c.email}` : ''}
                    </option>
                  ))}
                </select>
                {customers.length === 0 && (
                  <p className="text-xs text-[#5A6355]">
                    No saved customers yet. Add them under Bookings → Returning Customers.
                  </p>
                )}
              </div>

              <div className="sm:col-span-2 space-y-2">
                <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] font-medium">
                  <CalendarRange className="w-3.5 h-3.5" />
                  Current reservation
                </label>
                <select
                  value={selectedReservationId}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      setSelectedReservationId('');
                      return;
                    }
                    const slot = reservations.find((s) => s.id === id);
                    if (slot) applyReservation(slot);
                  }}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                >
                  <option value="">Select a reservation to convert…</option>
                  {reservations.map((s) => (
                    <option key={s.id} value={s.id}>
                      Space {s.number}
                      {s.contactName || s.tenantName ? ` · ${s.contactName || s.tenantName}` : ''}
                      {s.startDate ? ` · ${s.startDate}` : ''}
                      {s.endDate ? ` → ${s.endDate}` : ''}
                    </option>
                  ))}
                </select>
                {reservations.length === 0 ? (
                  <p className="text-xs text-[#5A6355]">
                    No reserved sites right now. Reservations appear here when a site is held for a guest.
                  </p>
                ) : (
                  <p className="text-xs text-[#5A6355]">
                    Choosing a reservation fills guest info and site. Saving converts that reservation into an active tenant.
                  </p>
                )}
              </div>

              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Full name *"
                className="sm:col-span-2 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                required
              />

              <select
                value={form.site}
                onChange={(e) => {
                  const siteNum = e.target.value;
                  setForm((p) => ({ ...p, site: siteNum }));
                  const reserved = reservations.find((s) => String(s.number) === siteNum);
                  if (reserved) {
                    applyReservation(reserved);
                  } else {
                    setSelectedReservationId('');
                  }
                }}
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                required
              >
                <option value="">Select space *</option>
                {siteOptions.map((opt) => (
                  <option key={`${opt.kind}-${opt.value}`} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <select
                value={form.rentalType}
                onChange={(e) => setRentalType(e.target.value as RentalType)}
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              >
                {rates.allowedRentalTypes.includes('monthly') && (
                  <option value="monthly">Monthly</option>
                )}
                {rates.allowedRentalTypes.includes('weekly') && (
                  <option value="weekly">Weekly</option>
                )}
                {rates.allowedRentalTypes.includes('daily') && (
                  <option value="daily">Daily</option>
                )}
              </select>

              <input
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                placeholder="Phone"
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
              <input
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                placeholder="Email"
                type="email"
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
              <input
                value={form.rvType}
                onChange={(e) => setForm((p) => ({ ...p, rvType: e.target.value }))}
                placeholder="RV type"
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
              <input
                value={form.licensePlate}
                onChange={(e) => setForm((p) => ({ ...p, licensePlate: e.target.value }))}
                placeholder="License plate"
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
              <input
                value={form.rentAmount}
                onChange={(e) => setForm((p) => ({ ...p, rentAmount: e.target.value }))}
                placeholder="Rent amount"
                type="number"
                min="0"
                step="0.01"
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
              <input
                value={form.startDate}
                onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                type="date"
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
              <input
                value={form.endDate === 'ongoing' ? '' : form.endDate}
                onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value || 'ongoing' }))}
                type="date"
                placeholder="End date (optional)"
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
              <input
                value={form.emergencyContact}
                onChange={(e) => setForm((p) => ({ ...p, emergencyContact: e.target.value }))}
                placeholder="Emergency contact"
                className="sm:col-span-2 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
              <textarea
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Notes"
                rows={2}
                className="sm:col-span-2 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355] resize-none"
              />
            </div>

            {siteOptions.length === 0 && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                No available or reserved spaces right now. Free a site or create a reservation first.
              </p>
            )}

            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isLoading || !form.name.trim() || !form.site}
                className="flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-[#b08364] transition"
              >
                <Save className="w-4 h-4" />
                {isLoading ? 'Saving…' : 'Save Tenant'}
              </button>
              <button
                type="button"
                onClick={reset}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm border border-[#E2D9D0] hover:bg-[#FBF9F7] transition"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
