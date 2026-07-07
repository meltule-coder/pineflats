import { useState, type ElementType } from 'react';
import {
  ArrowLeft, MapPin, Phone, Mail, Truck, CreditCard, User, FileText, Save, CheckCircle2
} from 'lucide-react';
import { Tenant } from '../../types';
import { ReceiptLink } from './ReceiptLink';

interface TenantDetailPageProps {
  tenant: Tenant;
  onBack: () => void;
  onSave: (updates: Partial<Tenant>) => Promise<void>;
  onPayments: () => void;
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

export function TenantDetailPage({ tenant, onBack, onSave, onPayments }: TenantDetailPageProps) {
  const [form, setForm] = useState({
    phone: tenant.phone ?? '',
    email: tenant.email ?? '',
    rvType: tenant.rvType ?? '',
    licensePlate: tenant.licensePlate ?? '',
    emergencyContact: tenant.emergencyContact ?? '',
    notes: tenant.notes ?? tenant.description ?? '',
    startDate: tenant.startDate ?? '',
    endDate: tenant.endDate ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (key: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...form, description: form.notes });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
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
              <img src={tenant.imageUrl} alt={tenant.name} className="w-full h-64 md:h-full object-cover" />
            ) : (
              <div className="w-full h-64 md:h-full bg-[#E2D9D0] flex items-center justify-center">
                <User className="w-16 h-16 text-[#5A6355] opacity-40" />
              </div>
            )}
          </div>

          <div className="flex-1 p-6 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-3xl font-serif text-[#3D3730] mb-2">{tenant.name}</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FBF9F7] border border-[#F0EBE6] text-sm font-mono text-[#5A6355]">
                    <MapPin className="w-3.5 h-3.5" />
                    Space {tenant.site}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E8F0E8] border border-[#A8B2A6] text-sm text-[#3D5A3D] capitalize">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {tenant.status}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ReceiptLink spaceNumber={tenant.site} />
                <button
                  onClick={onPayments}
                  className="flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition"
                >
                  <CreditCard className="w-4 h-4" />
                  Payments
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
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
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-5">
                <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Stay Details</h3>
                <InfoField
                  label="Start Date"
                  icon={FileText}
                  value={form.startDate}
                  onChange={v => update('startDate', v)}
                  placeholder="e.g. 03/06/2026"
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