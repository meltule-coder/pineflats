import { useEffect, useState, type ElementType } from 'react';
import {
  ArrowLeft, MapPin, Phone, Mail, Truck, CreditCard, User, FileText, Save, CheckCircle2, Trash2, Home
} from 'lucide-react';
import { RentalType, Slot, Tenant } from '../../types';
import { ReceiptLink } from './ReceiptLink';

interface TenantDetailPageProps {
  tenant: Tenant;
  onBack: () => void;
  onSave: (updates: Partial<Tenant>) => Promise<void>;
  onPayments: () => void;
  onViewReceipt?: () => void;
  onRemove: () => Promise<void>;
}

function InfoField({
  label,
  icon: Icon,
  value,
  onChange,
  placeholder,
  type = 'text',
  multiline = false,
}: {
  label: string;
  icon: ElementType;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] font-medium">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm text-[#3D3730] focus:outline-none focus:ring-1 focus:ring-[#5A6355] resize-none"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm text-[#3D3730] focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
        />
      )}
    </div>
  );
}

function formFromTenant(tenant: Tenant) {
  return {
    name: tenant.name ?? '',
    site: tenant.site ?? '',
    status: tenant.status ?? 'Active',
    rentalType: (tenant.rentalType ?? 'monthly') as RentalType,
    phone: tenant.phone ?? '',
    email: tenant.email ?? '',
    rvType: tenant.rvType ?? '',
    licensePlate: tenant.licensePlate ?? '',
    emergencyContact: tenant.emergencyContact ?? '',
    notes: tenant.notes ?? tenant.description ?? '',
    startDate: tenant.startDate ?? '',
    endDate: tenant.endDate ?? '',
  };
}

export function TenantDetailPage({ tenant, onBack, onSave, onPayments, onViewReceipt, onRemove }: TenantDetailPageProps) {
  const [form, setForm] = useState(() => formFromTenant(tenant));
  const [siteOptions, setSiteOptions] = useState<Slot[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(formFromTenant(tenant));
    setSaved(false);
    setError('');
    setConfirmRemove(false);
  }, [tenant.id, tenant.name, tenant.site, tenant.phone, tenant.email, tenant.rvType, tenant.licensePlate, tenant.emergencyContact, tenant.notes, tenant.description, tenant.startDate, tenant.endDate, tenant.status, tenant.rentalType]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/slots');
        if (!res.ok) return;
        const data = await res.json();
        const slots: Slot[] = Array.isArray(data) ? data : (data.slots ?? []);
        if (cancelled) return;
        const current = String(tenant.site);
        setSiteOptions(
          slots
            .filter((s) => s.status === 'available' || String(s.number) === current)
            .sort((a, b) => a.number - b.number)
        );
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [tenant.site, tenant.id]);

  const update = (key: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setSaved(false);
    setError('');
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Tenant name is required.');
      return;
    }
    if (!form.site.trim()) {
      setError('Site is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        name: form.name.trim(),
        site: form.site.trim(),
        status: form.status.trim() || 'Active',
        rentalType: form.rentalType,
        phone: form.phone.trim(),
        email: form.email.trim(),
        rvType: form.rvType.trim(),
        licensePlate: form.licensePlate.trim(),
        emergencyContact: form.emergencyContact.trim(),
        notes: form.notes.trim(),
        description: form.notes.trim(),
        startDate: form.startDate.trim() || undefined,
        endDate: form.endDate.trim() || 'ongoing',
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save tenant info');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-[#5A6355] hover:text-[#3D3730] transition text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Tenants
      </button>

      <div className="bg-white rounded-[32px] border border-[#E2D9D0] shadow-sm overflow-hidden">
        <div className="flex flex-col md:flex-row">
          <div className="md:w-72 shrink-0">
            {tenant.imageUrl ? (
              <img src={tenant.imageUrl} alt={form.name || tenant.name} className="w-full h-64 md:h-full object-cover" />
            ) : (
              <div className="w-full h-64 md:h-full bg-[#E2D9D0] flex items-center justify-center">
                <User className="w-16 h-16 text-[#5A6355] opacity-40" />
              </div>
            )}
          </div>

          <div className="flex-1 p-6 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] font-medium">
                    <User className="w-3.5 h-3.5" />
                    Tenant Name
                  </label>
                  <input
                    value={form.name}
                    onChange={e => update('name', e.target.value)}
                    placeholder="Full name"
                    className="w-full max-w-md text-2xl md:text-3xl font-serif text-[#3D3730] px-4 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                  />
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] font-medium">
                      <MapPin className="w-3.5 h-3.5" />
                      Space
                    </label>
                    <select
                      value={form.site}
                      onChange={e => update('site', e.target.value)}
                      className="px-3 py-2 rounded-xl bg-[#FBF9F7] border border-[#F0EBE6] text-sm font-mono text-[#5A6355] focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                    >
                      {form.site && !siteOptions.some(s => String(s.number) === form.site) && (
                        <option value={form.site}>Space {form.site} (current)</option>
                      )}
                      {siteOptions.map(s => (
                        <option key={s.id} value={String(s.number)}>
                          Space {s.number}
                          {String(s.number) === String(tenant.site) ? ' (current)' : ' · available'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355] font-medium">
                      <Home className="w-3.5 h-3.5" />
                      Rental
                    </label>
                    <select
                      value={form.rentalType}
                      onChange={e => update('rentalType', e.target.value)}
                      className="px-3 py-2 rounded-xl bg-[#FBF9F7] border border-[#F0EBE6] text-sm text-[#5A6355] focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="weekly">Weekly</option>
                      <option value="daily">Daily</option>
                    </select>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#E8F0E8] border border-[#A8B2A6] text-sm text-[#3D5A3D] capitalize">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {form.status}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ReceiptLink
                  spaceNumber={form.site || tenant.site}
                  onViewReceipt={onViewReceipt}
                />
                <button
                  onClick={onPayments}
                  className="flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition"
                >
                  <CreditCard className="w-4 h-4" />
                  Payments
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || removing}
                  className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
                >
                  {saved ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Saved
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      {saving ? 'Saving...' : 'Save Info'}
                    </>
                  )}
                </button>
                <button
                  onClick={handleRemove}
                  disabled={removing || saving}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50 ${
                    confirmRemove
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-white border border-red-300 text-red-700 hover:bg-red-50'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                  {removing
                    ? 'Removing...'
                    : confirmRemove
                      ? 'Confirm Remove'
                      : 'Remove Tenant'}
                </button>
                {confirmRemove && !removing && (
                  <button
                    onClick={() => setConfirmRemove(false)}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium text-[#5A6355] hover:bg-[#F0EBE6] transition"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
            {confirmRemove && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
                This will permanently remove <strong>{form.name || tenant.name}</strong> and free up Space {form.site || tenant.site}.
              </p>
            )}
            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
                {error}
              </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-5">
                <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Stay Details</h3>
                <InfoField
                  label="Status"
                  icon={CheckCircle2}
                  value={form.status}
                  onChange={v => update('status', v)}
                  placeholder="e.g. Active"
                />
                <InfoField
                  label="Start Date"
                  icon={FileText}
                  value={form.startDate}
                  onChange={v => update('startDate', v)}
                  placeholder="e.g. 2026-03-06 or 03/06/2026"
                />
                <InfoField
                  label="End Date"
                  icon={FileText}
                  value={form.endDate}
                  onChange={v => update('endDate', v)}
                  placeholder="e.g. ongoing"
                />
              </div>

              <div className="space-y-5">
                <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Contact Information</h3>
                <InfoField
                  label="Phone"
                  icon={Phone}
                  value={form.phone}
                  onChange={v => update('phone', v)}
                  placeholder="(555) 555-0100"
                  type="tel"
                />
                <InfoField
                  label="Email"
                  icon={Mail}
                  value={form.email}
                  onChange={v => update('email', v)}
                  placeholder="tenant@email.com"
                  type="email"
                />
                <InfoField
                  label="Emergency Contact"
                  icon={User}
                  value={form.emergencyContact}
                  onChange={v => update('emergencyContact', v)}
                  placeholder="Name & phone number"
                />
              </div>

              <div className="space-y-5">
                <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">RV / Unit Details</h3>
                <InfoField
                  label="RV Type"
                  icon={Truck}
                  value={form.rvType}
                  onChange={v => update('rvType', v)}
                  placeholder="e.g. Travel Trailer, Fifth Wheel"
                />
                <InfoField
                  label="License Plate"
                  icon={CreditCard}
                  value={form.licensePlate}
                  onChange={v => update('licensePlate', v)}
                  placeholder="Plate number"
                />
              </div>

              <div className="space-y-5">
                <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Notes</h3>
                <InfoField
                  label="Tenant Notes"
                  icon={FileText}
                  value={form.notes}
                  onChange={v => update('notes', v)}
                  placeholder="Hookup needs, pet info, special requests..."
                  multiline
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
