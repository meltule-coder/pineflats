import { useEffect, useState } from 'react';
import { MapPin, RefreshCw, ExternalLink, LogOut, Grid3x3, FileText, Save, UserPlus } from 'lucide-react';
import { ReceiptLink } from './ReceiptLink';
import { Slot, SlotStatus, RentalType } from '../../types';
import { rentAmountForType, formatDailyRateDescription } from '../../rentUtils';
import { googleSignIn, getAccessToken, initAuth, logout } from '../lib/auth';

const STATUS_STYLES: Record<SlotStatus, string> = {
  available: 'bg-[#E8F0E8] border-[#A8B2A6] text-[#3D5A3D]',
  occupied: 'bg-[#F5E6DC] border-[#C29474] text-[#6B4A32]',
  reserved: 'bg-[#E8E4F0] border-[#8B7FA8] text-[#4A3D6B]',
  maintenance: 'bg-[#F0EBE6] border-[#B0A89E] text-[#5A534D]',
};

export function SitesWidget({ onUpdate }: { onUpdate: () => void }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [available, setAvailable] = useState(25);
  const [token, setToken] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [sheetConnected, setSheetConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [receiptDocUrl, setReceiptDocUrl] = useState('');
  const [receiptConnected, setReceiptConnected] = useState(false);
  const [contactForm, setContactForm] = useState({
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    contactRvType: '',
    contactLicensePlate: '',
    contactEmergency: '',
    contactNotes: '',
    rentalType: 'monthly' as RentalType,
    rentAmount: '750',
    balanceDue: '750',
  });
  const [formSaved, setFormSaved] = useState(false);

  const loadSlots = async () => {
    const res = await fetch('/api/slots');
    if (res.ok) {
      const data = await res.json();
      setSlots(data.slots);
      setAvailable(data.available);
    }
  };

  const loadSheetStatus = async () => {
    const res = await fetch('/api/sheets/status');
    if (res.ok) {
      const data = await res.json();
      setSheetConnected(data.connected);
      setSheetUrl(data.url);
    }
  };

  const loadReceiptConfig = async () => {
    const res = await fetch('/api/receipts/config');
    if (res.ok) {
      const data = await res.json();
      setReceiptDocUrl(data.receiptDocUrl ?? '');
      setReceiptConnected(!!data.receiptDocId);
    }
  };

  const handleSaveReceiptDoc = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/receipts/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docUrl: receiptDocUrl }),
      });
      if (res.ok) await loadReceiptConfig();
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSlots();
    loadSheetStatus();
    loadReceiptConfig();
    initAuth(
      (_user, t) => setToken(t),
      () => setToken(null)
    );
  }, []);

  const authHeaders = async () => {
    const t = token || await getAccessToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const result = await googleSignIn();
      if (result) setToken(result.accessToken);
    } catch (err) {
      console.error('Sign in failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetupSheet = async () => {
    setIsLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/sheets/setup', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        setSheetUrl(data.url);
        setSheetConnected(true);
      }
    } catch (err) {
      console.error('Sheet setup failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncTo = async () => {
    setIsLoading(true);
    try {
      const headers = await authHeaders();
      await fetch('/api/sheets/sync-to', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncFrom = async () => {
    setIsLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/sheets/sync-from', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        await loadSlots();
        onUpdate();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const loadContactForm = (slot: Slot) => {
    const defaultRent = String(rentAmountForType(slot.rentalType ?? 'monthly'));
    setContactForm({
      contactName: slot.contactName ?? '',
      contactPhone: slot.contactPhone ?? '',
      contactEmail: slot.contactEmail ?? '',
      contactRvType: slot.contactRvType ?? '',
      contactLicensePlate: slot.contactLicensePlate ?? '',
      contactEmergency: slot.contactEmergency ?? '',
      contactNotes: slot.contactNotes ?? '',
      rentalType: slot.rentalType ?? 'monthly',
      rentAmount: String(slot.rentAmount ?? defaultRent),
      balanceDue: String(slot.balanceDue ?? slot.rentAmount ?? defaultRent),
    });
    setFormSaved(false);
  };

  const handleSelectSlot = (slot: Slot) => {
    setSelectedSlot(slot);
    loadContactForm(slot);
  };

  const handleSlotUpdate = async (slot: Slot, status: SlotStatus) => {
    const res = await fetch(`/api/slots/${slot.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      await loadSlots();
      onUpdate();
      setSelectedSlot(null);
    }
  };

  const handleRentalTypeChange = (rentalType: RentalType) => {
    const rentAmount = String(rentAmountForType(rentalType));
    setContactForm(prev => ({ ...prev, rentalType, rentAmount, balanceDue: rentAmount }));
    setFormSaved(false);
  };

  const handleSaveContactPayment = async () => {
    if (!selectedSlot) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/slots/${selectedSlot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactName: contactForm.contactName,
          contactPhone: contactForm.contactPhone,
          contactEmail: contactForm.contactEmail,
          contactRvType: contactForm.contactRvType,
          contactLicensePlate: contactForm.contactLicensePlate,
          contactEmergency: contactForm.contactEmergency,
          contactNotes: contactForm.contactNotes,
          rentalType: contactForm.rentalType,
          rentAmount: parseFloat(contactForm.rentAmount) || 0,
          balanceDue: parseFloat(contactForm.balanceDue) || 0,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedSlot(updated);
        await loadSlots();
        setFormSaved(true);
        setTimeout(() => setFormSaved(false), 2500);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddTenant = async () => {
    if (!selectedSlot || !contactForm.contactName.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/slots/${selectedSlot.id}/add-tenant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...contactForm,
          rentAmount: parseFloat(contactForm.rentAmount) || 0,
          balanceDue: parseFloat(contactForm.balanceDue) || 0,
        }),
      });
      if (res.ok) {
        await loadSlots();
        onUpdate();
        setSelectedSlot(null);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-serif text-[#3D3730]">Site Database</h2>
          <p className="text-sm text-[#5A6355] mt-1">
            {available} of 25 spots available
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm bg-white border border-[#E2D9D0] text-[#5A6355] px-4 py-2 rounded-xl hover:bg-[#FBF9F7] transition"
            >
              <ExternalLink className="w-4 h-4" />
              Open Google Sheet
            </a>
          )}
          {sheetConnected && token && (
            <>
              <button
                onClick={handleSyncTo}
                disabled={isLoading}
                className="flex items-center gap-2 text-sm bg-[#5A6355] text-white px-4 py-2 rounded-xl hover:bg-[#3D3730] transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Push to Sheets
              </button>
              <button
                onClick={handleSyncFrom}
                disabled={isLoading}
                className="flex items-center gap-2 text-sm bg-[#C29474] text-white px-4 py-2 rounded-xl hover:bg-[#A87A5E] transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Pull from Sheets
              </button>
            </>
          )}
        </div>
      </div>

      {!token ? (
        <div className="bg-white rounded-[32px] p-8 shadow-sm border border-[#E2D9D0] text-center max-w-2xl">
          <div className="w-16 h-16 bg-[#EDE7E1] text-[#5A6355] rounded-full flex items-center justify-center mx-auto mb-6 border border-[#E2D9D0]">
            <Grid3x3 className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-serif text-[#3D3730] mb-3">Connect Google Database</h3>
          <p className="text-[#5A6355] mb-8 text-sm leading-relaxed">
            Sign in with Google to create a spreadsheet with all 25 sites. You can edit slots directly in Google Sheets and sync changes back to the app.
          </p>
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="flex items-center gap-3 bg-white border border-[#E2D9D0] text-[#3D3730] px-6 py-3 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] transition shadow-sm mx-auto"
          >
            {isLoading ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
              </svg>
            )}
            Sign in with Google
          </button>
        </div>
      ) : !sheetConnected ? (
        <div className="bg-white rounded-[32px] p-8 shadow-sm border border-[#E2D9D0] text-center max-w-2xl">
          <h3 className="text-xl font-serif text-[#3D3730] mb-3">Create Your Site Database</h3>
          <p className="text-[#5A6355] mb-6 text-sm">
            This will create a Google Sheet with all 25 sites that you can edit anytime.
          </p>
          <button
            onClick={handleSetupSheet}
            disabled={isLoading}
            className="bg-[#5A6355] text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
          >
            {isLoading ? 'Creating...' : 'Create Google Sheet Database'}
          </button>
          <button onClick={logout} className="mt-4 flex items-center justify-center gap-2 text-xs text-red-500 hover:bg-red-50 px-4 py-2 rounded-xl transition mx-auto">
            <LogOut className="w-3 h-3" /> Sign out
          </button>
        </div>
      ) : null}

      <div className="bg-white rounded-[32px] p-6 shadow-sm border border-[#E2D9D0]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center">
            <FileText className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">Numbered Receipt Google Doc</h3>
            <p className="text-xs text-[#5A6355]">Link each space to its matching receipt page number</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="url"
            value={receiptDocUrl}
            onChange={e => setReceiptDocUrl(e.target.value)}
            placeholder="Paste your Google Doc URL (https://docs.google.com/document/d/...)"
            className="flex-1 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
          <button
            onClick={handleSaveReceiptDoc}
            disabled={isLoading || !receiptDocUrl}
            className="flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Link Receipts
          </button>
        </div>
        {receiptConnected && (
          <p className="text-xs text-[#3D5A3D] mt-3">Receipt doc linked — each space opens its numbered page.</p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {slots.map(slot => (
          <button
            key={slot.id}
            onClick={() => handleSelectSlot(slot)}
            className={`p-4 rounded-2xl border-2 text-left transition hover:scale-[1.02] active:scale-[0.98] ${STATUS_STYLES[slot.status]}`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin className="w-3.5 h-3.5 opacity-60" />
              <span className="font-serif font-bold text-sm">{slot.label}</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider opacity-70">{slot.status}</div>
            {slot.tenantName && (
              <div className="text-xs mt-1 truncate opacity-80">{slot.tenantName}</div>
            )}
            {slot.status === 'available' && slot.contactName && (
              <div className="text-xs mt-1 truncate opacity-80">{slot.contactName}</div>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-[#5A6355]">
        {(['available', 'occupied', 'reserved', 'maintenance'] as SlotStatus[]).map(status => (
          <div key={status} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full border ${STATUS_STYLES[status]}`} />
            <span className="capitalize">{status}</span>
          </div>
        ))}
      </div>

      {selectedSlot && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setSelectedSlot(null)}>
          <div
            className={`bg-white rounded-[32px] p-6 w-full shadow-2xl border border-[#E2D9D0] max-h-[90vh] overflow-y-auto ${selectedSlot.status === 'available' ? 'max-w-2xl' : 'max-w-sm'}`}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-xl font-serif text-[#3D3730] mb-1">{selectedSlot.label}</h3>
            <p className="text-sm text-[#5A6355] mb-4 capitalize">Currently: {selectedSlot.status}</p>
            {selectedSlot.tenantName && (
              <p className="text-sm mb-4">Tenant: <strong>{selectedSlot.tenantName}</strong></p>
            )}

            {selectedSlot.status === 'available' && (
              <div className="space-y-5 mb-6">
                <div>
                  <h4 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4">Contact Information</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2 sm:col-span-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">Name</label>
                      <input
                        value={contactForm.contactName}
                        onChange={e => { setContactForm(prev => ({ ...prev, contactName: e.target.value })); setFormSaved(false); }}
                        placeholder="Full name"
                        className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">Phone</label>
                      <input
                        value={contactForm.contactPhone}
                        onChange={e => { setContactForm(prev => ({ ...prev, contactPhone: e.target.value })); setFormSaved(false); }}
                        placeholder="Phone number"
                        className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">Email</label>
                      <input
                        type="email"
                        value={contactForm.contactEmail}
                        onChange={e => { setContactForm(prev => ({ ...prev, contactEmail: e.target.value })); setFormSaved(false); }}
                        placeholder="Email address"
                        className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">RV Type</label>
                      <input
                        value={contactForm.contactRvType}
                        onChange={e => { setContactForm(prev => ({ ...prev, contactRvType: e.target.value })); setFormSaved(false); }}
                        placeholder="e.g. Travel trailer"
                        className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">License Plate</label>
                      <input
                        value={contactForm.contactLicensePlate}
                        onChange={e => { setContactForm(prev => ({ ...prev, contactLicensePlate: e.target.value })); setFormSaved(false); }}
                        placeholder="License plate"
                        className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">Emergency Contact</label>
                      <input
                        value={contactForm.contactEmergency}
                        onChange={e => { setContactForm(prev => ({ ...prev, contactEmergency: e.target.value })); setFormSaved(false); }}
                        placeholder="Emergency contact"
                        className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">Notes</label>
                      <textarea
                        value={contactForm.contactNotes}
                        onChange={e => { setContactForm(prev => ({ ...prev, contactNotes: e.target.value })); setFormSaved(false); }}
                        placeholder="Additional notes"
                        rows={2}
                        className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355] resize-none"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4">Payment Information</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">Rental Type</label>
                      <select
                        value={contactForm.rentalType}
                        onChange={e => handleRentalTypeChange(e.target.value as RentalType)}
                        className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      >
                        <option value="monthly">Monthly ($750)</option>
                        <option value="weekly">Weekly ($250)</option>
                        <option value="daily">Daily ({formatDailyRateDescription()})</option>
                      </select>
                      {contactForm.rentalType === 'daily' && (
                        <p className="text-xs text-[#5A6355]">
                          Today&apos;s rate: ${rentAmountForType('daily').toFixed(2)}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">Rent Due ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={contactForm.rentAmount}
                        onChange={e => { setContactForm(prev => ({ ...prev, rentAmount: e.target.value })); setFormSaved(false); }}
                        className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">Balance Due ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={contactForm.balanceDue}
                        onChange={e => { setContactForm(prev => ({ ...prev, balanceDue: e.target.value })); setFormSaved(false); }}
                        className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleSaveContactPayment}
                    disabled={isLoading}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {formSaved ? 'Saved' : 'Save Contact & Payment'}
                  </button>
                  <button
                    onClick={handleAddTenant}
                    disabled={isLoading || !contactForm.contactName.trim()}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#C29474] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition disabled:opacity-50"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add as Tenant
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-[#5A6355] mb-4 uppercase tracking-wider">Change status</p>
            {receiptConnected && (
              <div className="mb-4">
                <ReceiptLink spaceNumber={String(selectedSlot.number)} variant="button" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {(['available', 'occupied', 'reserved', 'maintenance'] as SlotStatus[]).map(status => (
                <button
                  key={status}
                  onClick={() => handleSlotUpdate(selectedSlot, status)}
                  className={`px-3 py-2 rounded-xl text-xs font-medium capitalize border-2 transition ${STATUS_STYLES[status]} ${selectedSlot.status === status ? 'ring-2 ring-[#5A6355]' : ''}`}
                >
                  {status}
                </button>
              ))}
            </div>
            <button onClick={() => setSelectedSlot(null)} className="mt-4 w-full text-sm text-[#5A6355] hover:text-[#3D3730] py-2">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}