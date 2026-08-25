import { apiFetch } from '../lib/api';
import { useEffect, useRef, useState } from 'react';
import {
  Phone, Mail, MapPin, User, Save, Image as ImageIcon, Upload, Building2, Type, FileText,
} from 'lucide-react';
import { ParkContact } from '../../types';
import { DEFAULT_CONTACT } from '../../contactDefaults';

const EMPTY_FORM: ParkContact = {
  phone: '',
  email: '',
  contactName: '',
  address: '',
  tagline: '',
  businessName: '',
  logoUrl: '/logo.png',
  about: '',
};

export function ContactWidget({ onUpdate }: { onUpdate?: () => void }) {
  const [form, setForm] = useState<ParkContact>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const loadContact = async () => {
    const res = await apiFetch('/api/contact');
    if (res.ok) {
      const data = await res.json();
      setForm({ ...DEFAULT_CONTACT, ...data });
    }
  };

  useEffect(() => {
    loadContact();
  }, []);

  const update = (field: keyof ParkContact, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/contact', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm({ ...DEFAULT_CONTACT, ...(await res.json()) });
        onUpdate?.();
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not save business info');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    setLogoUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('logo', file);
      const res = await apiFetch('/api/contact/logo', { method: 'POST', body });
      if (res.ok) {
        const data = await res.json();
        setForm({ ...DEFAULT_CONTACT, ...data });
        onUpdate?.();
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Logo upload failed');
      }
    } catch {
      setError('Logo upload failed — could not reach the server.');
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const logoSrc = form.logoUrl || '/logo.png';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-serif text-[#3D3730]">Business profile</h2>
          <p className="text-sm text-[#5A6355] mt-1">
            Logo, name, contact details, and about text shown on the public website home page.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={isLoading || !form.phone.trim()}
          className="flex items-center gap-2 bg-[#C29474] text-white rounded-xl px-4 py-2 text-sm font-semibold shadow-lg shadow-black/10 transition-transform active:scale-95 disabled:opacity-40"
        >
          <Save className="w-4 h-4" />
          {saved ? 'Saved' : isLoading ? 'Saving…' : 'Save business info'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">{error}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Business logo only — website gallery is managed on the Media tab */}
        <div className="space-y-6">
          <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-[#5A6355]" />
              Business logo
            </h3>
            <div className="flex flex-col sm:flex-row items-center gap-5">
              <div className="w-36 h-36 rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] flex items-center justify-center overflow-hidden shrink-0 p-2">
                <img
                  src={`${logoSrc}${logoSrc.includes('?') ? '&' : '?'}v=${encodeURIComponent(logoSrc)}`}
                  alt="Business logo"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="flex-1 space-y-3 w-full">
                <p className="text-xs text-[#5A6355] leading-relaxed">
                  Appears on the public website header and home page. PNG or JPG, square works best.
                  Website photos and videos are managed under the <strong>Media</strong> tab.
                </p>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) void handleLogoUpload(f);
                  }}
                />
                <button
                  type="button"
                  disabled={logoUploading}
                  onClick={() => logoInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 w-full sm:w-auto bg-[#5A6355] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  {logoUploading ? 'Uploading…' : 'Upload new logo'}
                </button>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Logo URL</label>
                  <input
                    value={form.logoUrl ?? ''}
                    onChange={e => update('logoUrl', e.target.value)}
                    placeholder="/logo.png"
                    className="w-full px-3 py-2 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Business details */}
        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
          <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Business information</h3>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
              <Building2 className="w-3.5 h-3.5" />
              Business name
            </label>
            <input
              value={form.businessName ?? ''}
              onChange={e => update('businessName', e.target.value)}
              placeholder="Pine Flats RV Park"
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
              <Type className="w-3.5 h-3.5" />
              Tagline
            </label>
            <input
              value={form.tagline}
              onChange={e => update('tagline', e.target.value)}
              placeholder="Your home away from home."
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
              <FileText className="w-3.5 h-3.5" />
              About (home page)
            </label>
            <textarea
              value={form.about ?? ''}
              onChange={e => update('about', e.target.value)}
              rows={4}
              placeholder="Tell guests about your park…"
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355] resize-y min-h-[100px]"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
              <Phone className="w-3.5 h-3.5" />
              Phone number
            </label>
            <input
              value={form.phone}
              onChange={e => update('phone', e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
              <Mail className="w-3.5 h-3.5" />
              Email address
            </label>
            <input
              type="email"
              value={form.email}
              onChange={e => update('email', e.target.value)}
              placeholder="info@pineflatsrvpark.com"
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
              <User className="w-3.5 h-3.5" />
              Contact name / office
            </label>
            <input
              value={form.contactName}
              onChange={e => update('contactName', e.target.value)}
              placeholder="Pine Flats Office"
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
              <MapPin className="w-3.5 h-3.5" />
              Address
            </label>
            <input
              value={form.address ?? ''}
              onChange={e => update('address', e.target.value)}
              placeholder="123 Pine Road, Your City, ST 12345"
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
