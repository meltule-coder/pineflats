import { useEffect, useState } from 'react';
import { Phone, Mail, MapPin, User, Save } from 'lucide-react';
import { ParkContact } from '../../types';

const EMPTY_FORM: ParkContact = {
  phone: '',
  email: '',
  contactName: '',
  address: '',
  tagline: '',
};

export function ContactWidget({ onUpdate }: { onUpdate?: () => void }) {
  const [form, setForm] = useState<ParkContact>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadContact = async () => {
    const res = await fetch('/api/contact');
    if (res.ok) setForm(await res.json());
  };

  useEffect(() => {
    loadContact();
  }, []);

  const update = (field: keyof ParkContact, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm(await res.json());
        onUpdate?.();
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-serif text-[#3D3730]">Website Contact Info</h2>
          <p className="text-sm text-[#5A6355] mt-1">
            Updates the phone number and contact details shown on the public website footer.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={isLoading || !form.phone.trim()}
          className="flex items-center gap-2 bg-[#C29474] text-white rounded-xl px-4 py-2 text-sm font-semibold shadow-lg shadow-black/10 transition-transform active:scale-95 disabled:opacity-40"
        >
          <Save className="w-4 h-4" />
          {saved ? 'Saved' : 'Save Contact Info'}
        </button>
      </div>

      <div className="max-w-2xl">
        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
          <h3 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2">Contact Details</h3>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
              <Phone className="w-3.5 h-3.5" />
              Phone Number
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
              Email Address
            </label>
            <input
              type="email"
              value={form.email}
              onChange={e => update('email', e.target.value)}
              placeholder="info@pineflatsrv.com"
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
              <User className="w-3.5 h-3.5" />
              Contact Name / Office
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

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-[#5A6355]">Footer Tagline</label>
            <input
              value={form.tagline}
              onChange={e => update('tagline', e.target.value)}
              placeholder="Your home away from home."
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}