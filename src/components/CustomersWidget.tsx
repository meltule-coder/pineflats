import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Pencil, X } from 'lucide-react';
import { StoredCustomer } from '../../types';

const EMPTY: Omit<StoredCustomer, 'id'> = {
  name: '',
  phone: '',
  email: '',
  rvType: '',
  licensePlate: '',
  emergencyContact: '',
  notes: '',
};

export function CustomersWidget() {
  const [customers, setCustomers] = useState<StoredCustomer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const loadCustomers = async () => {
    const res = await fetch('/api/customers');
    if (res.ok) setCustomers(await res.json());
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const resetForm = () => {
    setForm(EMPTY);
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (customer: StoredCustomer) => {
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

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setIsLoading(true);
    try {
      const url = editingId ? `/api/customers/${editingId}` : '/api/customers';
      const res = await fetch(url, {
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
    const res = await fetch(`/api/customers/${id}`, { method: 'DELETE' });
    if (res.ok) await loadCustomers();
  };

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
            Guest contact info for bookings and site assignments. Not shown on the public website.
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
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
                <div className="flex gap-1 shrink-0">
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