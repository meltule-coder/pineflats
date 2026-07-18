import { useEffect, useRef, useState } from 'react';
import { MapPin, RefreshCw, ExternalLink, LogOut, Grid3x3, FileText, Save, UserPlus, ImagePlus, Trash2, Link as LinkIcon, Users } from 'lucide-react';
import { ReceiptLink } from './ReceiptLink';
import { Slot, SlotStatus, RentalType, StoredCustomer } from '../../types';
import { rentAmountForType, formatDailyRateDescription, parseDateKey } from '../../rentUtils';

function formatStayDate(key: string) {
  try {
    return parseDateKey(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return key;
  }
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}
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
  const [receiptDocs, setReceiptDocs] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [selectedReceiptDocId, setSelectedReceiptDocId] = useState('');
  const [receiptError, setReceiptError] = useState<string | null>(null);
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
  const [loadingContact, setLoadingContact] = useState(false);
  const [customers, setCustomers] = useState<StoredCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [siteImageUrlInput, setSiteImageUrlInput] = useState('');
  const [uploadingSlotId, setUploadingSlotId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const pendingUploadSlotIdRef = useRef<string | null>(null);
  const sitePhotoInputRef = useRef<HTMLInputElement>(null);
  const gridPhotoInputRef = useRef<HTMLInputElement>(null);

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
    setReceiptError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/receipts/config', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ docUrl: receiptDocUrl }),
      });
      if (res.ok) {
        await loadReceiptConfig();
      } else {
        const data = await res.json().catch(() => ({}));
        setReceiptError(data.error ?? 'Failed to link receipt doc');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadReceiptDocs = async () => {
    setIsLoading(true);
    setReceiptError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/docs/list', { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setReceiptError(data.error ?? 'Failed to load Google Docs');
        return;
      }
      const data = await res.json();
      setReceiptDocs(data.documents ?? []);
      if (data.documents?.length) {
        setSelectedReceiptDocId(data.documents[0].id);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectReceiptDoc = async () => {
    if (!selectedReceiptDocId) return;
    setIsLoading(true);
    setReceiptError(null);
    try {
      const headers = await authHeaders();
      const selected = receiptDocs.find(doc => doc.id === selectedReceiptDocId);
      const res = await fetch('/api/docs/connect', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: selectedReceiptDocId, docUrl: selected?.url }),
      });
      if (res.ok) {
        await loadReceiptConfig();
      } else {
        const data = await res.json().catch(() => ({}));
        setReceiptError(data.error ?? 'Failed to connect Google Doc');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateReceiptDoc = async () => {
    setIsLoading(true);
    setReceiptError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/docs/setup', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        await loadReceiptConfig();
      } else {
        const data = await res.json().catch(() => ({}));
        setReceiptError(data.error ?? 'Failed to create Google Doc');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const loadCustomers = async () => {
    const res = await fetch('/api/customers');
    if (res.ok) setCustomers(await res.json());
  };

  useEffect(() => {
    loadSlots();
    loadCustomers();
    loadSheetStatus();
    loadReceiptConfig();
    initAuth(
      (_user, t) => setToken(t),
      () => setToken(null)
    );
  }, []);

  const applyCustomer = (customer: StoredCustomer) => {
    setSelectedCustomerId(customer.id);
    setContactForm(prev => ({
      ...prev,
      contactName: customer.name,
      contactPhone: customer.phone,
      contactEmail: customer.email,
      contactRvType: customer.rvType ?? '',
      contactLicensePlate: customer.licensePlate ?? '',
      contactEmergency: customer.emergencyContact ?? '',
      contactNotes: customer.notes ?? '',
    }));
    setFormSaved(false);
  };

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

  const loadContactForm = async (slot: Slot) => {
    const rentalType = slot.rentalType ?? 'monthly';
    const defaultRent = String(rentAmountForType(rentalType));

    if (slot.status === 'available') {
      setSelectedCustomerId('');
      setContactForm({
        contactName: '',
        contactPhone: '',
        contactEmail: '',
        contactRvType: '',
        contactLicensePlate: '',
        contactEmergency: '',
        contactNotes: '',
        rentalType: 'monthly',
        rentAmount: String(rentAmountForType('monthly')),
        balanceDue: String(rentAmountForType('monthly')),
      });
      setFormSaved(false);
      return;
    }

    let form = {
      contactName: slot.contactName ?? slot.tenantName ?? '',
      contactPhone: slot.contactPhone ?? '',
      contactEmail: slot.contactEmail ?? '',
      contactRvType: slot.contactRvType ?? '',
      contactLicensePlate: slot.contactLicensePlate ?? '',
      contactEmergency: slot.contactEmergency ?? '',
      contactNotes: slot.contactNotes ?? slot.notes ?? '',
      rentalType,
      rentAmount: String(slot.rentAmount ?? defaultRent),
      balanceDue: String(slot.balanceDue ?? slot.rentAmount ?? defaultRent),
    };

    if (slot.tenantId) {
      setLoadingContact(true);
      try {
        const [tRes, pRes] = await Promise.all([
          fetch(`/api/tenants/${slot.tenantId}`),
          fetch(`/api/tenants/${slot.tenantId}/payments`),
        ]);
        if (tRes.ok) {
          const tenant = await tRes.json();
          form = {
            ...form,
            contactName: form.contactName || tenant.name || '',
            contactPhone: form.contactPhone || tenant.phone || '',
            contactEmail: form.contactEmail || tenant.email || '',
            contactRvType: form.contactRvType || tenant.rvType || '',
            contactLicensePlate: form.contactLicensePlate || tenant.licensePlate || '',
            contactEmergency: form.contactEmergency || tenant.emergencyContact || '',
            contactNotes: form.contactNotes || tenant.notes || tenant.description || '',
            rentalType: (slot.rentalType ?? tenant.rentalType ?? form.rentalType) as RentalType,
          };
        }
        if (pRes.ok) {
          const payment = await pRes.json();
          form = {
            ...form,
            rentalType: (payment.rentalType ?? form.rentalType) as RentalType,
            rentAmount: String(payment.rentAmount ?? form.rentAmount),
            balanceDue: String(payment.balanceDue ?? form.balanceDue),
          };
        }
      } finally {
        setLoadingContact(false);
      }
    }

    setContactForm(form);
    setFormSaved(false);
  };

  const handleSelectSlot = async (slot: Slot) => {
    setSelectedSlot(slot);
    setSiteImageUrlInput('');
    await loadContactForm(slot);
  };

  const refreshSelectedSlot = async (updated: Slot) => {
    setSelectedSlot(updated);
    await loadSlots();
    onUpdate();
  };

  const handleSitePhotoUpload = async (file: File, slotId: string) => {
    setUploadingSlotId(slotId);
    setUploadError(null);
    setIsLoading(true);
    try {
      const form = new FormData();
      form.append('photo', file);
      const res = await fetch(`/api/slots/${slotId}/photo`, { method: 'POST', body: form });
      if (res.ok) {
        const updated = await res.json();
        await loadSlots();
        onUpdate();
        if (selectedSlot?.id === slotId) setSelectedSlot(updated);
      } else {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || `Upload failed (${res.status}). Restart the dev server if this persists.`);
      }
    } catch {
      setUploadError('Upload failed — could not reach the server.');
    } finally {
      setIsLoading(false);
      setUploadingSlotId(null);
      pendingUploadSlotIdRef.current = null;
      if (sitePhotoInputRef.current) sitePhotoInputRef.current.value = '';
      if (gridPhotoInputRef.current) gridPhotoInputRef.current.value = '';
    }
  };

  const openPhotoPicker = (slotId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    pendingUploadSlotIdRef.current = slotId;
    setUploadError(null);
    gridPhotoInputRef.current?.click();
  };

  const handleSitePhotoFromUrl = async () => {
    if (!selectedSlot || !siteImageUrlInput.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/slots/${selectedSlot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: siteImageUrlInput.trim() }),
      });
      if (res.ok) {
        await refreshSelectedSlot(await res.json());
        setSiteImageUrlInput('');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveSitePhoto = async () => {
    if (!selectedSlot?.imageUrl) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/slots/${selectedSlot.id}/photo`, { method: 'DELETE' });
      if (res.ok) await refreshSelectedSlot(await res.json());
    } finally {
      setIsLoading(false);
    }
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
      const payload = selectedSlot.status === 'available'
        ? {
            rentalType: contactForm.rentalType,
            rentAmount: parseFloat(contactForm.rentAmount) || 0,
            balanceDue: parseFloat(contactForm.balanceDue) || 0,
          }
        : {
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
          };

      const res = await fetch(`/api/slots/${selectedSlot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (selectedSlot.tenantId) {
        await fetch(`/api/tenants/${selectedSlot.tenantId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: contactForm.contactName,
            phone: contactForm.contactPhone,
            email: contactForm.contactEmail,
            rvType: contactForm.contactRvType,
            licensePlate: contactForm.contactLicensePlate,
            emergencyContact: contactForm.contactEmergency,
            notes: contactForm.contactNotes,
            description: contactForm.contactNotes,
            rentalType: contactForm.rentalType,
          }),
        });
        await fetch(`/api/tenants/${selectedSlot.tenantId}/payments`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rentalType: contactForm.rentalType,
            rentAmount: parseFloat(contactForm.rentAmount) || 0,
            balanceDue: parseFloat(contactForm.balanceDue) || 0,
          }),
        });
        onUpdate();
      }

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

  const handleRemoveTenant = async () => {
    if (!selectedSlot) return;
    const name = selectedSlot.tenantName || selectedSlot.contactName || contactForm.contactName || 'this tenant';
    if (!window.confirm(`Remove ${name} from ${selectedSlot.label}? This frees the site and deletes the tenant record.`)) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/slots/${selectedSlot.id}/remove-tenant`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSelectedSlot(data.slot ?? null);
        await loadSlots();
        onUpdate();
        if (data.slot) {
          await loadContactForm(data.slot);
        } else {
          setSelectedSlot(null);
        }
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
        await fetch('/api/customers/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: contactForm.contactName,
            phone: contactForm.contactPhone,
            email: contactForm.contactEmail,
            rvType: contactForm.contactRvType,
            licensePlate: contactForm.contactLicensePlate,
            emergencyContact: contactForm.contactEmergency,
            notes: contactForm.contactNotes,
          }),
        });
        await loadCustomers();
        await loadSlots();
        onUpdate();
        setSelectedSlot(null);
        setSelectedCustomerId('');
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
          <h3 className="text-xl font-serif text-[#3D3730] mb-3">Connect Google Account</h3>
          <p className="text-[#5A6355] mb-8 text-sm leading-relaxed">
            Sign in with the manager&apos;s Google account to sync site data in Google Sheets and connect numbered receipt pages in Google Docs.
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
          <div className="flex-1">
            <h3 className="text-sm font-serif text-[#3D3730]">Numbered Receipt Google Doc</h3>
            <p className="text-xs text-[#5A6355]">Connect a Google Doc from the manager account — each space opens its matching page number</p>
          </div>
          {receiptConnected && receiptDocUrl && (
            <a
              href={receiptDocUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs bg-[#FBF9F7] border border-[#E2D9D0] text-[#5A6355] px-3 py-2 rounded-xl hover:bg-white transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Doc
            </a>
          )}
        </div>

        {token ? (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={handleCreateReceiptDoc}
              disabled={isLoading}
              className="flex items-center gap-2 text-sm bg-[#5A6355] text-white px-4 py-2 rounded-xl hover:bg-[#3D3730] transition disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              Create Receipt Doc
            </button>
            <button
              onClick={handleLoadReceiptDocs}
              disabled={isLoading}
              className="flex items-center gap-2 text-sm bg-white border border-[#E2D9D0] text-[#5A6355] px-4 py-2 rounded-xl hover:bg-[#FBF9F7] transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Browse My Docs
            </button>
          </div>
        ) : (
          <p className="text-xs text-[#5A6355] mb-4">
            Sign in with Google above to create or browse receipt documents under the manager account.
          </p>
        )}

        {receiptDocs.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <select
              value={selectedReceiptDocId}
              onChange={e => setSelectedReceiptDocId(e.target.value)}
              className="flex-1 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            >
              {receiptDocs.map(doc => (
                <option key={doc.id} value={doc.id}>{doc.name}</option>
              ))}
            </select>
            <button
              onClick={handleConnectReceiptDoc}
              disabled={isLoading || !selectedReceiptDocId}
              className="flex items-center justify-center gap-2 bg-[#C29474] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition disabled:opacity-50"
            >
              <LinkIcon className="w-4 h-4" />
              Connect Doc
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="url"
            value={receiptDocUrl}
            onChange={e => setReceiptDocUrl(e.target.value)}
            placeholder="Or paste a Google Doc URL (https://docs.google.com/document/d/...)"
            className="flex-1 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
          <button
            onClick={handleSaveReceiptDoc}
            disabled={isLoading || !receiptDocUrl}
            className="flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Link by URL
          </button>
        </div>

        {receiptConnected && (
          <p className="text-xs text-[#3D5A3D] mt-3">Receipt doc linked — each space opens its numbered page.</p>
        )}
        {receiptError && (
          <p className="text-xs text-red-600 mt-3">{receiptError}</p>
        )}
      </div>

      <input
        ref={gridPhotoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          const slotId = pendingUploadSlotIdRef.current;
          if (file && slotId) handleSitePhotoUpload(file, slotId);
        }}
      />

      {uploadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {uploadError}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {slots.map(slot => (
          <div
            key={slot.id}
            className={`rounded-2xl border-2 text-left transition hover:scale-[1.02] overflow-hidden ${STATUS_STYLES[slot.status]}`}
          >
            {slot.status === 'available' && (
              slot.imageUrl ? (
                <button
                  type="button"
                  onClick={e => openPhotoPicker(slot.id, e)}
                  className="relative aspect-[4/3] w-full overflow-hidden border-b border-black/5 group"
                  title="Change site photo"
                >
                  <img src={slot.imageUrl} alt={slot.label} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
                    <span className="text-[10px] uppercase tracking-wider text-white opacity-0 group-hover:opacity-100 font-semibold">
                      {uploadingSlotId === slot.id ? 'Uploading…' : 'Change photo'}
                    </span>
                  </div>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={e => openPhotoPicker(slot.id, e)}
                  disabled={uploadingSlotId === slot.id}
                  className="aspect-[4/3] w-full border-b border-dashed border-black/10 bg-white/30 flex flex-col items-center justify-center gap-1.5 text-[#5A6355] hover:bg-white/50 transition disabled:opacity-60"
                  title="Add site photo"
                >
                  <ImagePlus className="w-5 h-5 opacity-60" />
                  <span className="text-[10px] uppercase tracking-wider font-semibold">
                    {uploadingSlotId === slot.id ? 'Uploading…' : 'Add photo'}
                  </span>
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => handleSelectSlot(slot)}
              className="p-4 w-full text-left active:scale-[0.98] transition"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <MapPin className="w-3.5 h-3.5 opacity-60" />
                <span className="font-serif font-bold text-sm">{slot.label}</span>
              </div>
              <div className="text-[10px] uppercase tracking-wider opacity-70">{slot.status}</div>
              {slot.status === 'reserved' && slot.startDate && slot.endDate && (
                <div className="text-[10px] mt-1 opacity-70 leading-snug">
                  {formatStayDate(slot.startDate)} – {formatStayDate(slot.endDate)}
                </div>
              )}
              {slot.status !== 'available' && (slot.contactName || slot.tenantName) && (
                <div className="text-xs mt-1 truncate opacity-80">{slot.contactName || slot.tenantName}</div>
              )}
            </button>
          </div>
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
            className="bg-white rounded-[32px] p-6 w-full max-w-2xl shadow-2xl border border-[#E2D9D0] max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-xl font-serif text-[#3D3730] mb-1">{selectedSlot.label}</h3>
            <p className="text-sm text-[#5A6355] mb-1 capitalize">Currently: {selectedSlot.status}</p>
            {selectedSlot.tenantName && selectedSlot.status === 'occupied' && (
              <p className="text-sm text-[#5A6355] mb-1">Tenant: <strong className="text-[#3D3730]">{selectedSlot.tenantName}</strong></p>
            )}
            {selectedSlot.status === 'reserved' && selectedSlot.startDate && selectedSlot.endDate && (
              <div className="bg-[#E8E4F0] border border-[#8B7FA8]/40 rounded-2xl p-4 mb-4">
                <p className="text-[10px] uppercase tracking-widest text-[#4A3D6B] font-semibold mb-2">Website Reservation</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[#4A3D6B]/70 mb-0.5">Check-in</p>
                    <p className="font-medium text-[#3D3730]">{formatStayDate(selectedSlot.startDate)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[#4A3D6B]/70 mb-0.5">Check-out</p>
                    <p className="font-medium text-[#3D3730]">{formatStayDate(selectedSlot.endDate)}</p>
                  </div>
                  {selectedSlot.rentalType && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[#4A3D6B]/70 mb-0.5">Rental</p>
                      <p className="font-medium text-[#3D3730] capitalize">{selectedSlot.rentalType}</p>
                    </div>
                  )}
                  {selectedSlot.rentAmount != null && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[#4A3D6B]/70 mb-0.5">Paid</p>
                      <p className="font-medium text-[#3D3730]">{formatCurrency(selectedSlot.rentAmount)}</p>
                    </div>
                  )}
                  {selectedSlot.paymentMethod && (
                    <div className="col-span-2">
                      <p className="text-[10px] uppercase tracking-wider text-[#4A3D6B]/70 mb-0.5">Payment</p>
                      <p className="font-medium text-[#3D3730]">{selectedSlot.paymentMethod}</p>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-[#4A3D6B]/80 mt-3">Visible here until check-out date, then the site returns to available.</p>
              </div>
            )}

            {selectedSlot.status !== 'reserved' && selectedSlot.startDate && selectedSlot.endDate && (
              <p className="text-sm text-[#5A6355] mb-4">
                Stay: <strong className="text-[#3D3730]">{formatStayDate(selectedSlot.startDate)}</strong> – <strong className="text-[#3D3730]">{formatStayDate(selectedSlot.endDate)}</strong>
              </p>
            )}
            {(!selectedSlot.startDate || selectedSlot.status === 'reserved') && <div className="mb-0" />}
            {!selectedSlot.startDate && selectedSlot.status !== 'reserved' && <div className="mb-4" />}

            <div className="space-y-5 mb-6">
              {selectedSlot.status === 'available' && (
                <div>
                  <h4 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4">Site Photo</h4>
                  <div className="space-y-4">
                    <input
                      ref={sitePhotoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file && selectedSlot) handleSitePhotoUpload(file, selectedSlot.id);
                      }}
                    />

                    <button
                      type="button"
                      onClick={() => sitePhotoInputRef.current?.click()}
                      disabled={uploadingSlotId === selectedSlot.id}
                      className="w-full rounded-2xl border border-[#E2D9D0] aspect-[16/9] bg-[#FBF9F7] overflow-hidden relative group disabled:opacity-60"
                    >
                      {selectedSlot.imageUrl ? (
                        <>
                          <img
                            src={selectedSlot.imageUrl}
                            alt={`${selectedSlot.label} photo`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
                            <span className="text-sm text-white opacity-0 group-hover:opacity-100 font-medium">
                              {uploadingSlotId === selectedSlot.id ? 'Uploading…' : 'Choose new photo'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-[#5A6355] gap-2 border border-dashed border-[#E2D9D0] rounded-2xl">
                          <ImagePlus className="w-8 h-8 opacity-40" />
                          <p className="text-sm font-medium">
                            {uploadingSlotId === selectedSlot.id ? 'Uploading…' : 'Click to choose a photo'}
                          </p>
                          <p className="text-xs opacity-60">Uploads immediately when selected</p>
                        </div>
                      )}
                    </button>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        value={siteImageUrlInput}
                        onChange={e => setSiteImageUrlInput(e.target.value)}
                        placeholder="Or paste image URL"
                        className="flex-1 px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      />
                      <button
                        onClick={handleSitePhotoFromUrl}
                        disabled={isLoading || !siteImageUrlInput.trim()}
                        className="flex items-center justify-center gap-2 bg-[#5A6355] text-white px-4 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
                      >
                        <LinkIcon className="w-4 h-4" />
                        Add URL
                      </button>
                    </div>

                    {selectedSlot.imageUrl && (
                      <button
                        onClick={handleRemoveSitePhoto}
                        disabled={isLoading}
                        className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        Remove photo
                      </button>
                    )}
                  </div>
                </div>
              )}

              {loadingContact ? (
                <div className="py-8 text-center text-sm text-[#5A6355]">Loading contact & payment info…</div>
              ) : (
                <>
                {selectedSlot.status === 'available' ? (
                  <div>
                    <h4 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-4 flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#5A6355]" />
                      Returning Customer
                    </h4>
                    <p className="text-xs text-[#5A6355] mb-4">
                      Available sites do not store contact info. Select a returning customer, or add customers under <strong>Bookings → Returning Customers</strong>.
                    </p>
                    <select
                      value={selectedCustomerId}
                      onChange={e => {
                        const id = e.target.value;
                        setSelectedCustomerId(id);
                        const customer = customers.find(c => c.id === id);
                        if (customer) applyCustomer(customer);
                        else {
                          setContactForm(prev => ({
                            ...prev,
                            contactName: '',
                            contactPhone: '',
                            contactEmail: '',
                            contactRvType: '',
                            contactLicensePlate: '',
                            contactEmergency: '',
                            contactNotes: '',
                          }));
                        }
                        setFormSaved(false);
                      }}
                      className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                    >
                      <option value="">Select a returning customer…</option>
                      {customers.map(customer => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}{customer.phone ? ` · ${customer.phone}` : ''}
                        </option>
                      ))}
                    </select>
                    {contactForm.contactName && (
                      <div className="mt-4 p-4 rounded-2xl bg-[#FBF9F7] border border-[#E2D9D0] text-sm space-y-1">
                        <p className="font-medium text-[#3D3730]">{contactForm.contactName}</p>
                        {contactForm.contactPhone && <p className="text-[#5A6355]">{contactForm.contactPhone}</p>}
                        {contactForm.contactEmail && <p className="text-[#5A6355]">{contactForm.contactEmail}</p>}
                        {contactForm.contactRvType && <p className="text-[#5A6355]">{contactForm.contactRvType}</p>}
                      </div>
                    )}
                  </div>
                ) : (
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
                )}

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
                  {selectedSlot.status === 'available' && (
                    <button
                      onClick={handleAddTenant}
                      disabled={isLoading || !selectedCustomerId || !contactForm.contactName.trim()}
                      className="flex-1 flex items-center justify-center gap-2 bg-[#C29474] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition disabled:opacity-50"
                    >
                      <UserPlus className="w-4 h-4" />
                      Add as Tenant
                    </button>
                  )}
                  {(selectedSlot.status === 'occupied' || selectedSlot.tenantId || selectedSlot.tenantName) && (
                    <button
                      onClick={handleRemoveTenant}
                      disabled={isLoading}
                      className="flex-1 flex items-center justify-center gap-2 bg-white border border-red-300 text-red-700 px-5 py-3 rounded-xl text-sm font-semibold hover:bg-red-50 transition disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove Tenant
                    </button>
                  )}
                </div>
                </>
              )}
            </div>

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