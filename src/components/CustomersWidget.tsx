import { apiFetch } from '../lib/api';
import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Pencil, X, UserPlus, Home } from 'lucide-react';
import { RentalType, Slot, StoredCustomer } from '../../types';
import {
  ALL_RENTAL_TYPES,
  DEFAULT_RENTAL_RATES,
  rentAmountForType,
} from '../../rentUtils';
import { fetchActiveRates, subscribeActiveRates, type ActiveRates } from '../lib/activeRates';

const EMPTY: Omit<StoredCustomer, 'id'> = {
  name: '',
  phone: '',
  email: '',
  rvType: '',
  licensePlate: '',
  emergencyContact: '',
  notes: '',
};

interface CustomersWidgetProps {
  /** Called after a customer is successfully converted to a tenant */
  onConverted?: (tenant: { id: string }) => void | Promise<void>;
}

export function CustomersWidget({ onConverted }: CustomersWidgetProps) {
  const [customers, setCustomers] = useState<StoredCustomer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Convert-to-tenant panel
  const [converting, setConverting] = useState<StoredCustomer | null>(null);
  const [convertSite, setConvertSite] = useState('');
  const [convertRentalType, setConvertRentalType] = useState<RentalType>('monthly');
  const [convertRent, setConvertRent] = useState('');
  const [convertStart, setConvertStart] = useState(() => new Date().toISOString().split('T')[0]);
  const [convertEnd, setConvertEnd] = useState('ongoing');
  const [convertError, setConvertError] = useState('');
  const [convertLoading, setConvertLoading] = useState(false);
  const [availableSites, setAvailableSites] = useState<Slot[]>([]);
  const [reservations, setReservations] = useState<Slot[]>([]);
  const [rates, setRates] = useState<ActiveRates>({
    ...DEFAULT_RENTAL_RATES,
    allowedRentalTypes: [...ALL_RENTAL_TYPES],
  });

  const loadCustomers = async () => {
    const res = await apiFetch('/api/customers');
    if (res.ok) setCustomers(await res.json());
  };

  const loadSites = async () => {
    try {
      const res = await apiFetch('/api/slots');
      if (!res.ok) return;
      const data = await res.json();
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
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  useEffect(() => {
    if (!converting) return;
    loadSites();
    fetchActiveRates({ force: true }).then((active) => {
      setRates(active);
      const rentalType = active.allowedRentalTypes.includes('monthly')
        ? 'monthly'
        : (active.allowedRentalTypes[0] ?? 'monthly');
      setConvertRentalType(rentalType);
      setConvertRent(String(rentAmountForType(rentalType, new Date(), active)));
    });
    return subscribeActiveRates(() => {
      fetchActiveRates({ force: true }).then(setRates);
    });
  }, [converting]);

  const resetForm = () => {
    setForm(EMPTY);
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (customer: StoredCustomer) => {
    setConverting(null);
    setForm({
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      rvType: customer.rvType ?? '',
      licensePlate: customer.licensePlate ?? '',
      emergencyContact: customer.emergencyContact ?? '',
      notes: customer.notes ?? '',
    });
    setEditingId(customer.id);
    setShowForm(true);
  };

  const startConvert = (customer: StoredCustomer) => {
    setShowForm(false);
    setEditingId(null);
    setConverting(customer);
    setConvertSite('');
    setConvertStart(new Date().toISOString().split('T')[0]);
    setConvertEnd('ongoing');
    setConvertError('');
  };

  const cancelConvert = () => {
    setConverting(null);
    setConvertSite('');
    setConvertError('');
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setIsLoading(true);
    try {
      const url = editingId ? `/api/customers/${editingId}` : '/api/customers';
      const res = await apiFetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        await loadCustomers();
        resetForm();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this customer from the directory?')) return;
    const res = await apiFetch(`/api/customers/${id}`, { method: 'DELETE' });
    if (res.ok) await loadCustomers();
  };

  const handleConvert = async () => {
    if (!converting) return;
    if (!convertSite) {
      setConvertError('Select a site for this tenant.');
      return;
    }
    setConvertLoading(true);
    setConvertError('');
    try {
      const rent = parseFloat(convertRent) || 0;
      const convertNote = `Converted from returning customer (${converting.name}) on ${new Date().toISOString().split('T')[0]}`;
      const notes = [converting.notes, convertNote].filter(Boolean).join('\n');
      const res = await apiFetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: converting.name.trim(),
          site: convertSite,
          phone: converting.phone || '',
          email: converting.email || '',
          rvType: converting.rvType || '',
          licensePlate: converting.licensePlate || '',
          emergencyContact: converting.emergencyContact || '',
          notes,
          startDate: convertStart || undefined,
          endDate: convertEnd || 'ongoing',
          rentalType: convertRentalType,
          rentAmount: rent,
          balanceDue: rent,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setConvertError(data.error || 'Failed to convert customer to tenant');
        return;
      }
      const created = await res.json().catch(() => null);
      cancelConvert();
      if (created?.id && onConverted) {
        await onConverted({ id: String(created.id) });
      }
    } catch {
      setConvertError('Network error — could not convert customer.');
    } finally {
      setConvertLoading(false);
    }
  };

  const setRentalType = (rentalType: RentalType) => {
    setConvertRentalType(rentalType);
    setConvertRent(String(rentAmountForType(rentalType, new Date(), rates)));
  };

  const siteOptions: { value: string; label: string }[] = [
    ...availableSites.map((s) => ({
      value: String(s.number),
      label: `Space ${s.number}${s.label && s.label !== String(s.number) ? ` (${s.label})` : ''} · available`,
    })),
    ...reservations.map((s) => ({
      value: String(s.number),
      label: `Space ${s.number}${s.label && s.label !== String(s.number) ? ` (${s.label})` : ''} · reserved${s.contactName ? ` · ${s.contactName}` : ''}`,
    })),
  ];

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
    || c.email.toLowerCase().includes(search.toLowerCase())
    || c.phone.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-serif text-[#3D3730]">Returning Customers</h2>
          <p className="text-sm text-[#5A6355] mt-1">
            Guest contact info for bookings and site assignments. Convert any customer into an active tenant on an available site.
          </p>
        </div>
        <button
          onClick={() => { cancelConvert(); resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 bg-[#5A6355] text-white rounded-xl px-4 py-2 text-sm font-semibold"
        >
          <Plus className="w-4 h-4" />
          Add Customer
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-serif text-[#3D3730]">{editingId ? 'Edit Customer' : 'New Customer'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name *" className="sm:col-span-2 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm" />
            <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="Phone" className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm" />
            <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="Email" type="email" className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm" />
            <input value={form.rvType} onChange={e => setForm(p => ({ ...p, rvType: e.target.value }))} placeholder="RV type" className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm" />
            <input value={form.licensePlate} onChange={e => setForm(p => ({ ...p, licensePlate: e.target.value }))} placeholder="License plate" className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm" />
            <input value={form.emergencyContact} onChange={e => setForm(p => ({ ...p, emergencyContact: e.target.value }))} placeholder="Emergency contact" className="sm:col-span-2 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm" />
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Notes" rows={2} className="sm:col-span-2 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={isLoading || !form.name.trim()} className="flex items-center gap-2 bg-[#C29474] text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40">
              <Save className="w-4 h-4" /> Save
            </button>
            <button onClick={resetForm} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm border border-[#E2D9D0]">
              <X className="w-4 h-4" /> Cancel
            </button>
          </div>
        </div>
      )}

      {converting && (
        <div className="bg-white rounded-[32px] border border-[#C29474]/40 p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#EDE7E1] flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-[#5A6355]" />
              </div>
              <div>
                <h3 className="text-lg font-serif text-[#3D3730]">Convert to Tenant</h3>
                <p className="text-sm text-[#5A6355]">
                  {converting.name}
                  {converting.phone ? ` · ${converting.phone}` : ''}
                  {converting.email ? ` · ${converting.email}` : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={cancelConvert}
              className="p-2 rounded-lg hover:bg-[#FBF9F7]"
              aria-label="Cancel convert"
            >
              <X className="w-4 h-4 text-[#5A6355]" />
            </button>
          </div>

          <p className="text-xs text-[#5A6355]">
            Assign an available (or reserved) site and rental terms. Contact details stay on file as a returning customer.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-2">
              <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] font-medium">
                <Home className="w-3.5 h-3.5" />
                Site *
              </label>
              <select
                value={convertSite}
                onChange={(e) => setConvertSite(e.target.value)}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              >
                <option value="">Select space…</option>
                {siteOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {siteOptions.length === 0 && (
                <p className="text-xs text-amber-800">
                  No available or reserved spaces. Free a site first.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355] font-medium">
                Rental type
              </label>
              <select
                value={convertRentalType}
                onChange={(e) => setRentalType(e.target.value as RentalType)}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
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
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355] font-medium">
                Rent amount
              </label>
              <input
                value={convertRent}
                onChange={(e) => setConvertRent(e.target.value)}
                type="number"
                min="0"
                step="0.01"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355] font-medium">
                Start date
              </label>
              <input
                value={convertStart}
                onChange={(e) => setConvertStart(e.target.value)}
                type="date"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355] font-medium">
                End date (optional)
              </label>
              <input
                value={convertEnd === 'ongoing' ? '' : convertEnd}
                onChange={(e) => setConvertEnd(e.target.value || 'ongoing')}
                type="date"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
          </div>

          {convertError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              {convertError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleConvert}
              disabled={convertLoading || !convertSite}
              className="flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-[#b08364] transition"
            >
              <UserPlus className="w-4 h-4" />
              {convertLoading ? 'Converting…' : 'Create Tenant'}
            </button>
            <button
              type="button"
              onClick={cancelConvert}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm border border-[#E2D9D0] hover:bg-[#FBF9F7] transition"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search customers…"
          className="w-full mb-4 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm"
        />
        {filtered.length === 0 ? (
          <p className="text-sm text-[#5A6355] text-center py-8">No returning customers saved yet.</p>
        ) : (
          <div className="space-y-3">
            {filtered.map(customer => (
              <div key={customer.id} className="flex items-start justify-between gap-4 p-4 rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7]">
                <div className="min-w-0">
                  <p className="font-medium text-[#3D3730]">{customer.name}</p>
                  <p className="text-xs text-[#5A6355] mt-1">{customer.phone}{customer.email && ` · ${customer.email}`}</p>
                  {customer.rvType && <p className="text-xs text-[#5A6355]">{customer.rvType}</p>}
                </div>
                <div className="flex flex-wrap gap-1 shrink-0 justify-end">
                  <button
                    onClick={() => startConvert(customer)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-white text-xs font-semibold text-[#5A6355] border border-transparent hover:border-[#E2D9D0]"
                    title="Convert to tenant"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span className="hidden sm:inline">To tenant</span>
                  </button>
                  <button onClick={() => startEdit(customer)} className="p-2 rounded-lg hover:bg-white" aria-label="Edit">
                    <Pencil className="w-4 h-4 text-[#5A6355]" />
                  </button>
                  <button onClick={() => handleDelete(customer.id)} className="p-2 rounded-lg hover:bg-red-50" aria-label="Delete">
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
