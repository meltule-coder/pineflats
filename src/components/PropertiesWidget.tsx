import { useEffect, useState } from 'react';
import {
  Building2, Plus, Save, Trash2, Pencil, X, CheckCircle2, MapPin, Phone, Mail, Hash, DollarSign
} from 'lucide-react';
import { Property, PropertyRentalRates } from '../../types';
import { DEFAULT_RENTAL_RATES, getAllowedRentalTypes } from '../../rentUtils';
import { notifyActiveRatesChanged } from '../lib/activeRates';

const fetchOpts: RequestInit = { credentials: 'include' };

const EMPTY = {
  name: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  email: '',
  totalSites: '25',
  notes: '',
  isActive: false,
};

const EMPTY_RATES = {
  monthly: String(DEFAULT_RENTAL_RATES.monthly),
  weekly: String(DEFAULT_RENTAL_RATES.weekly),
  dailyWeekday: String(DEFAULT_RENTAL_RATES.dailyWeekday),
  dailyWeekend: String(DEFAULT_RENTAL_RATES.dailyWeekend),
  stateTransientTaxPercent: String(DEFAULT_RENTAL_RATES.stateTransientTaxPercent ?? 0),
  countyTransientTaxPercent: String(DEFAULT_RENTAL_RATES.countyTransientTaxPercent ?? 0),
  notes: '',
};

function ratesToForm(rates?: PropertyRentalRates | null) {
  return {
    monthly: String(rates?.monthly ?? DEFAULT_RENTAL_RATES.monthly),
    weekly: String(rates?.weekly ?? DEFAULT_RENTAL_RATES.weekly),
    dailyWeekday: String(rates?.dailyWeekday ?? DEFAULT_RENTAL_RATES.dailyWeekday),
    dailyWeekend: String(rates?.dailyWeekend ?? DEFAULT_RENTAL_RATES.dailyWeekend),
    stateTransientTaxPercent: String(
      rates?.stateTransientTaxPercent ?? DEFAULT_RENTAL_RATES.stateTransientTaxPercent ?? 0
    ),
    countyTransientTaxPercent: String(
      rates?.countyTransientTaxPercent ?? DEFAULT_RENTAL_RATES.countyTransientTaxPercent ?? 0
    ),
    notes: rates?.notes ?? '',
  };
}

export function PropertiesWidget() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [ratesForm, setRatesForm] = useState(EMPTY_RATES);
  const [ratesPropertyId, setRatesPropertyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savingRates, setSavingRates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadProperties = async () => {
    const res = await fetch('/api/properties', fetchOpts);
    if (!res.ok) {
      if (res.status === 401) {
        setError('Admin session expired. Sign in again to manage properties and rates.');
      }
      return;
    }
    const list: Property[] = await res.json();
    setProperties(list);
    // Keep rates editor on the same property when possible; otherwise active or first
    setRatesPropertyId((prev) => {
      const keep = prev && list.some(p => p.id === prev) ? prev : null;
      const nextId = keep ?? list.find(p => p.isActive)?.id ?? list[0]?.id ?? null;
      const next = list.find(p => p.id === nextId) ?? null;
      setRatesForm(ratesToForm(next?.rentalRates));
      return nextId;
    });
  };

  useEffect(() => {
    loadProperties();
  }, []);

  const resetForm = () => {
    setForm(EMPTY);
    setEditingId(null);
    setShowForm(false);
    setError(null);
  };

  const startEdit = (property: Property) => {
    setForm({
      name: property.name,
      address: property.address ?? '',
      city: property.city ?? '',
      state: property.state ?? '',
      zip: property.zip ?? '',
      phone: property.phone ?? '',
      email: property.email ?? '',
      totalSites: property.totalSites != null ? String(property.totalSites) : '',
      notes: property.notes ?? '',
      isActive: !!property.isActive,
    });
    setEditingId(property.id);
    setShowForm(true);
    setError(null);
  };

  const startAdd = () => {
    setForm({ ...EMPTY, isActive: properties.length === 0 });
    setEditingId(null);
    setShowForm(true);
    setError(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Property name is required.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setMessage(null);
    try {
      const body = {
        name: form.name.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        zip: form.zip.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        totalSites: form.totalSites ? Number(form.totalSites) : undefined,
        notes: form.notes.trim(),
        isActive: form.isActive,
      };
      const res = await fetch(
        editingId ? `/api/properties/${editingId}` : '/api/properties',
        {
          method: editingId ? 'PUT' : 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        if (res.status === 404 || contentType.includes('text/html')) {
          setError('Properties API not loaded. Stop the server and run npm run dev, then try again.');
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `Could not save property (${res.status})`);
        }
        return;
      }
      await loadProperties();
      resetForm();
      setMessage(editingId ? 'Property saved.' : 'Property saved successfully.');
      setTimeout(() => setMessage(null), 2500);
    } catch {
      setError('Network error — could not save property. Is the server running?');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetActive = async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${id}/activate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not set active property');
        return;
      }
      await loadProperties();
      notifyActiveRatesChanged();
      setMessage('Active property updated. Rental rates now follow this property.');
      setTimeout(() => setMessage(null), 2500);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this property? This cannot be undone.')) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not delete property');
        return;
      }
      await loadProperties();
      if (editingId === id) resetForm();
    } finally {
      setIsLoading(false);
    }
  };

  const selectRatesProperty = (id: string) => {
    const property = properties.find(p => p.id === id);
    setRatesPropertyId(id);
    setRatesForm(ratesToForm(property?.rentalRates));
    setError(null);
  };

  const handleSaveRates = async () => {
    if (!ratesPropertyId) {
      setError('Select a property to save rates for.');
      return;
    }
    const target = properties.find(p => p.id === ratesPropertyId);
    if (!target) {
      setError('Property not found. Refresh and try again.');
      return;
    }
    const allowed = getAllowedRentalTypes(target);
    const existing = target.rentalRates ?? DEFAULT_RENTAL_RATES;

    const parseField = (raw: string, label: string): number | null => {
      const n = parseFloat(raw);
      if (Number.isNaN(n) || n < 0) {
        setError(`Enter a valid ${label} rate.`);
        return null;
      }
      return Math.round(n * 100) / 100;
    };

    // Always persist a full rates object so other types keep prior values.
    let monthly = existing.monthly;
    let weekly = existing.weekly;
    let dailyWeekday = existing.dailyWeekday;
    let dailyWeekend = existing.dailyWeekend;

    if (allowed.includes('monthly')) {
      const n = parseField(ratesForm.monthly, 'monthly');
      if (n === null) return;
      monthly = n;
    }
    if (allowed.includes('weekly')) {
      const n = parseField(ratesForm.weekly, 'weekly');
      if (n === null) return;
      weekly = n;
    }
    if (allowed.includes('daily')) {
      const wd = parseField(ratesForm.dailyWeekday, 'weekday daily');
      const we = parseField(ratesForm.dailyWeekend, 'weekend daily');
      if (wd === null || we === null) return;
      dailyWeekday = wd;
      dailyWeekend = we;
    }

    const parseTax = (raw: string, label: string): number | null => {
      const n = parseFloat(raw);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        setError(`Enter a valid ${label} tax percent (0–100).`);
        return null;
      }
      return Math.round(n * 1000) / 1000;
    };

    // Transient tax applies to daily & weekly (always stored so it is ready when those types are used)
    const stateTax = parseTax(ratesForm.stateTransientTaxPercent, 'state transient');
    if (stateTax === null) return;
    const countyTax = parseTax(ratesForm.countyTransientTaxPercent, 'county transient');
    if (countyTax === null) return;

    const body: PropertyRentalRates = {
      monthly,
      weekly,
      dailyWeekday,
      dailyWeekend,
      stateTransientTaxPercent: stateTax,
      countyTransientTaxPercent: countyTax,
      notes: ratesForm.notes.trim() || undefined,
    };

    setSavingRates(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/properties/${ratesPropertyId}/rates`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        if (res.status === 401) {
          setError('Admin session expired. Sign in again, then save rates.');
        } else if (res.status === 404 || contentType.includes('text/html')) {
          setError('Rates API not loaded. Redeploy or restart the server, then try again.');
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `Could not save rental rates (${res.status})`);
        }
        return;
      }
      const updated = (await res.json()) as Property;
      setProperties(prev => prev.map(p => (p.id === updated.id ? updated : p)));
      setRatesForm(ratesToForm(updated.rentalRates));
      // Live bookings / public site only switch when the property being edited is active
      if (updated.isActive) {
        notifyActiveRatesChanged();
      }
      setMessage(
        updated.isActive
          ? `Rental rates saved for ${updated.name}. Sites, bookings, and the public website will use the new amounts.`
          : `Rental rates saved for ${updated.name}. They apply when this property is set as active.`
      );
      setTimeout(() => setMessage(null), 4000);
    } catch {
      setError('Network error — could not save rental rates.');
    } finally {
      setSavingRates(false);
    }
  };

  const formatLocation = (p: Property) => {
    const parts = [p.address, [p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean);
    return parts.join(' · ') || 'No address set';
  };

  const formatMoney = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  const activeProperty = properties.find(p => p.isActive) ?? null;
  const ratesProperty = properties.find(p => p.id === ratesPropertyId) ?? null;
  const ratesAllowed = getAllowedRentalTypes(ratesProperty);
  const showMonthlyRates = ratesAllowed.includes('monthly');
  const showWeeklyRates = ratesAllowed.includes('weekly');
  const showDailyRates = ratesAllowed.includes('daily');

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h2 className="text-xl font-serif text-[#3D3730]">Properties</h2>
            <p className="text-sm text-[#5A6355] mt-1">
              Add locations (RV park, Big House, Little House, tree house, etc.). Set rates on each property;
              the active property drives live bookings and the public website.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={startAdd}
          className="flex items-center gap-2 bg-[#C29474] text-white rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg shadow-black/10 hover:bg-[#A87A5C] transition"
        >
          <Plus className="w-4 h-4" />
          Add Property
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{error}</p>
      )}
      {message && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-2xl px-4 py-3">{message}</p>
      )}

      {properties.length > 0 && (
        <div
          id="property-rates-editor"
          className="bg-white rounded-[32px] border border-[#C29474] ring-1 ring-[#C29474]/20 p-6 shadow-sm space-y-4 scroll-mt-6"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center shrink-0">
              <DollarSign className="w-5 h-5 text-[#5A6355]" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="text-sm font-serif text-[#3D3730]">Rental rates by property</h3>
              <p className="text-xs text-[#5A6355]">
                Choose any property (including Big House) to set its rates. Live bookings use the{' '}
                <strong>active</strong> property’s rates
                {activeProperty ? ` (currently ${activeProperty.name})` : ''}.
              </p>
              <div className="space-y-1 max-w-md">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">
                  Property to edit rates
                </label>
                <select
                  value={ratesPropertyId ?? ''}
                  onChange={(e) => selectRatesProperty(e.target.value)}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isActive ? ' · Active' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {ratesProperty && showMonthlyRates && !showWeeklyRates && !showDailyRates && (
                <p className="text-xs text-[#6B4A32]">
                  {ratesProperty.name} is monthly rental only — weekly and daily rates are not used.
                </p>
              )}
              {ratesProperty && showDailyRates && !showWeeklyRates && !showMonthlyRates && (
                <p className="text-xs text-[#6B4A32]">
                  {ratesProperty.name} is daily rental only — monthly and weekly rates are not used.
                </p>
              )}
            </div>
          </div>

          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${showWeeklyRates || showDailyRates ? 'lg:grid-cols-4' : ''}`}>
            {showMonthlyRates && (
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Monthly ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ratesForm.monthly}
                  onChange={e => setRatesForm(p => ({ ...p, monthly: e.target.value }))}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
            )}
            {showWeeklyRates && (
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Weekly ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ratesForm.weekly}
                  onChange={e => setRatesForm(p => ({ ...p, weekly: e.target.value }))}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
            )}
            {showDailyRates && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Daily weekday ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={ratesForm.dailyWeekday}
                    onChange={e => setRatesForm(p => ({ ...p, dailyWeekday: e.target.value }))}
                    className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                  />
                  <p className="text-[10px] text-[#5A6355]/70">Sun–Thu</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Daily weekend ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={ratesForm.dailyWeekend}
                    onChange={e => setRatesForm(p => ({ ...p, dailyWeekend: e.target.value }))}
                    className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                  />
                  <p className="text-[10px] text-[#5A6355]/70">Fri–Sat</p>
                </div>
              </>
            )}
            <div className="space-y-1 sm:col-span-2 lg:col-span-full">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Rate notes</label>
              <textarea
                value={ratesForm.notes}
                onChange={e => setRatesForm(p => ({ ...p, notes: e.target.value }))}
                rows={2}
                placeholder="Deposits, stay rules, seasonal notes…"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
          </div>

          {(showDailyRates || showWeeklyRates) && (
            <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-[#3D3730]">Transient lodging tax</h4>
                <p className="text-xs text-[#5A6355] mt-1">
                  Applied to <strong>daily</strong> and <strong>weekly</strong> stays only (not monthly).
                  Enter percents (e.g. <code className="bg-white px-1 rounded border border-[#E2D9D0]">1.5</code> for 1.5%).
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">
                    State transient tax (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.001"
                    value={ratesForm.stateTransientTaxPercent}
                    onChange={e => setRatesForm(p => ({ ...p, stateTransientTaxPercent: e.target.value }))}
                    className="w-full px-4 py-3 bg-white border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">
                    County transient tax (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.001"
                    value={ratesForm.countyTransientTaxPercent}
                    onChange={e => setRatesForm(p => ({ ...p, countyTransientTaxPercent: e.target.value }))}
                    className="w-full px-4 py-3 bg-white border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#5A6355]">
                Combined tax on a sample $100 daily/weekly rent:{' '}
                <strong className="text-[#3D3730]">
                  {(
                    (parseFloat(ratesForm.stateTransientTaxPercent) || 0) +
                    (parseFloat(ratesForm.countyTransientTaxPercent) || 0)
                  ).toFixed(3)}
                  %
                </strong>
                {' '}→{' '}
                {formatMoney(
                  100 *
                    ((parseFloat(ratesForm.stateTransientTaxPercent) || 0) +
                      (parseFloat(ratesForm.countyTransientTaxPercent) || 0)) /
                      100
                )}{' '}
                tax
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={handleSaveRates}
            disabled={savingRates || isLoading || !ratesPropertyId}
            className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {savingRates
              ? 'Saving rates…'
              : ratesProperty
                ? `Save rates for ${ratesProperty.name}`
                : 'Save rental rates'}
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-serif text-[#3D3730]">
              {editingId ? 'Edit Property' : 'New Property'}
            </h3>
            <button type="button" onClick={resetForm} className="p-2 rounded-xl hover:bg-[#FBF9F7] text-[#5A6355]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Property name *</label>
              <input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Pine Flats RV Park"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Street address</label>
              <input
                value={form.address}
                onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                placeholder="123 Pine Road"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">City</label>
              <input
                value={form.city}
                onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">State</label>
                <input
                  value={form.state}
                  onChange={e => setForm(p => ({ ...p, state: e.target.value }))}
                  placeholder="OR"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">ZIP</label>
                <input
                  value={form.zip}
                  onChange={e => setForm(p => ({ ...p, zip: e.target.value }))}
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Phone</label>
              <input
                value={form.phone}
                onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Total sites / pads</label>
              <input
                type="number"
                min="1"
                value={form.totalSites}
                onChange={e => setForm(p => ({ ...p, totalSites: e.target.value }))}
                placeholder="25"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                rows={2}
                placeholder="Optional notes about this property"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[#5A6355] cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={e => setForm(p => ({ ...p, isActive: e.target.checked }))}
              className="rounded border-[#E2D9D0]"
            />
            Set as active property
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading}
              className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isLoading ? 'Saving…' : editingId ? 'Update Property' : 'Add Property'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-2 border border-[#E2D9D0] text-[#5A6355] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {properties.map(property => (
          <div
            key={property.id}
            className={`bg-white rounded-[32px] border p-6 shadow-sm space-y-4 ${
              property.isActive ? 'border-[#C29474] ring-1 ring-[#C29474]/30' : 'border-[#E2D9D0]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h3 className="text-lg font-serif text-[#3D3730] truncate">{property.name}</h3>
                  {property.isActive && (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold bg-[#E8F0E8] text-[#3D5A3D] border border-[#A8B2A6] px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3 h-3" />
                      Active
                    </span>
                  )}
                </div>
                <p className="text-sm text-[#5A6355] flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-70" />
                  <span>{formatLocation(property)}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-[#5A6355]">
              {property.totalSites != null && (
                <span className="inline-flex items-center gap-1 bg-[#FBF9F7] border border-[#E2D9D0] px-2.5 py-1 rounded-full">
                  <Hash className="w-3 h-3" />
                  {property.totalSites} sites
                </span>
              )}
              {property.phone && (
                <span className="inline-flex items-center gap-1 bg-[#FBF9F7] border border-[#E2D9D0] px-2.5 py-1 rounded-full">
                  <Phone className="w-3 h-3" />
                  {property.phone}
                </span>
              )}
              {property.email && (
                <span className="inline-flex items-center gap-1 bg-[#FBF9F7] border border-[#E2D9D0] px-2.5 py-1 rounded-full truncate max-w-full">
                  <Mail className="w-3 h-3 shrink-0" />
                  {property.email}
                </span>
              )}
            </div>

            {property.notes && (
              <p className="text-xs text-[#5A6355] leading-relaxed bg-[#FBF9F7] rounded-2xl px-3 py-2 border border-[#E2D9D0]">
                {property.notes}
              </p>
            )}

            {property.rentalRates && (
              <div className="text-xs text-[#5A6355] bg-[#FBF9F7] rounded-2xl px-3 py-2 border border-[#E2D9D0] space-y-1">
                <p className="font-semibold text-[#3D3730]">Rates on file</p>
                {(() => {
                  const allowed = getAllowedRentalTypes(property);
                  return (
                    <>
                      {allowed.includes('monthly') && (
                        <p>Monthly {formatMoney(property.rentalRates.monthly)}</p>
                      )}
                      {allowed.includes('weekly') && (
                        <p>Weekly {formatMoney(property.rentalRates.weekly)}</p>
                      )}
                      {allowed.includes('daily') && (
                        <p>
                          Daily {formatMoney(property.rentalRates.dailyWeekday)} weekday /{' '}
                          {formatMoney(property.rentalRates.dailyWeekend)} weekend
                        </p>
                      )}
                      {(allowed.includes('daily') || allowed.includes('weekly')) && (
                        <p className="text-[#6B4A32]">
                          Transient tax (daily/weekly): state{' '}
                          {property.rentalRates.stateTransientTaxPercent ?? 0}% · county{' '}
                          {property.rentalRates.countyTransientTaxPercent ?? 0}%
                        </p>
                      )}
                      {allowed.length === 1 && allowed[0] === 'monthly' && (
                        <p className="text-[#6B4A32]">Monthly rental only</p>
                      )}
                      {allowed.length === 1 && allowed[0] === 'daily' && (
                        <p className="text-[#6B4A32]">Daily rental only</p>
                      )}
                    </>
                  );
                })()}
                {property.rentalRates.notes && (
                  <p className="text-[#5A6355]/80 pt-0.5">{property.rentalRates.notes}</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {!property.isActive && (
                <button
                  type="button"
                  onClick={() => handleSetActive(property.id)}
                  disabled={isLoading}
                  className="text-xs font-semibold bg-[#5A6355] text-white px-3 py-2 rounded-xl hover:bg-[#3D3730] disabled:opacity-50"
                >
                  Set active
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  selectRatesProperty(property.id);
                  // Scroll rates editor into view
                  document.getElementById('property-rates-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="flex items-center gap-1.5 text-xs font-semibold border border-[#C29474]/50 text-[#6B4A32] bg-[#FBF5F0] px-3 py-2 rounded-xl hover:bg-[#F5E6DC]"
              >
                <DollarSign className="w-3.5 h-3.5" />
                Set rates
              </button>
              <button
                type="button"
                onClick={() => startEdit(property)}
                className="flex items-center gap-1.5 text-xs font-semibold border border-[#E2D9D0] text-[#5A6355] px-3 py-2 rounded-xl hover:bg-[#FBF9F7]"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(property.id)}
                disabled={isLoading || properties.length <= 1}
                className="flex items-center gap-1.5 text-xs font-semibold border border-red-200 text-red-700 px-3 py-2 rounded-xl hover:bg-red-50 disabled:opacity-40 ml-auto"
                title={properties.length <= 1 ? 'Cannot delete the only property' : 'Delete property'}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {properties.length === 0 && !showForm && (
        <div className="bg-white rounded-[32px] border border-dashed border-[#E2D9D0] p-12 text-center text-sm text-[#5A6355]">
          No properties yet. Click <strong>Add Property</strong> to create one.
        </div>
      )}
    </div>
  );
}
