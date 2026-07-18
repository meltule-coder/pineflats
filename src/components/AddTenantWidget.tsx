import { useEffect, useState } from 'react';
import { Plus, Save, UserPlus, X } from 'lucide-react';
import { RentalType, Slot } from '../../types';
import { rentAmountForType } from '../../rentUtils';

const EMPTY = {
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
  rentAmount: String(rentAmountForType('monthly')),
};

interface AddTenantWidgetProps {
  onAdded: (tenant?: { id: string }) => void | Promise<void>;
}

export function AddTenantWidget({ onAdded }: AddTenantWidgetProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [availableSites, setAvailableSites] = useState<Slot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadAvailableSites = async () => {
    try {
      const res = await fetch('/api/slots');
      if (!res.ok) return;
      const data = await res.json();
      // API returns { slots, total, available } — not a bare array
      const slots: Slot[] = Array.isArray(data) ? data : (data.slots ?? []);
      setAvailableSites(
        slots
          .filter((s) => s.status === 'available')
          .sort((a, b) => a.number - b.number)
      );
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (open) loadAvailableSites();
  }, [open]);

  const reset = () => {
    setForm({
      ...EMPTY,
      startDate: new Date().toISOString().split('T')[0],
      rentAmount: String(rentAmountForType('monthly')),
    });
    setError('');
    setOpen(false);
  };

  const setRentalType = (rentalType: RentalType) => {
    setForm((p) => ({
      ...p,
      rentalType,
      rentAmount: String(rentAmountForType(rentalType)),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.site) {
      setError('Name and site are required.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenants', {
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
              <p className="text-xs text-[#5A6355]">Assign a guest to an available space</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Full name *"
                className="sm:col-span-2 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                required
              />

              <select
                value={form.site}
                onChange={(e) => setForm((p) => ({ ...p, site: e.target.value }))}
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                required
              >
                <option value="">Select available space *</option>
                {availableSites.map((s) => (
                  <option key={s.id} value={String(s.number)}>
                    Space {s.number}
                    {s.label && s.label !== String(s.number) ? ` (${s.label})` : ''}
                  </option>
                ))}
              </select>

              <select
                value={form.rentalType}
                onChange={(e) => setRentalType(e.target.value as RentalType)}
                className="px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              >
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="daily">Daily</option>
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

            {availableSites.length === 0 && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                No available spaces right now. Free a site first, then try again.
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
