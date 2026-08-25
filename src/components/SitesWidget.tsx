import { useEffect, useRef, useState } from 'react';
import { MapPin, RefreshCw, UserPlus, ImagePlus, Trash2, Users, Wrench, CalendarRange, Gauge, Link as LinkIcon, Save } from 'lucide-react';
import { Slot, SlotStatus, RentalType, StoredCustomer, MeterRecord } from '../../types';
import {
  ALL_RENTAL_TYPES,
  DEFAULT_RENTAL_RATES,
  rentAmountForType, formatDailyRateDescription, parseDateKey,
  type RentalRatesConfig,
} from '../../rentUtils';
import { fetchActiveRates, subscribeActiveRates } from '../lib/activeRates';
import { apiFetch } from '../lib/api';
import { EarlyDeparturePanel } from './EarlyDeparturePanel';

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

/** Same as tenant utilities — weekly overage billing */
const KWH_RATE = 0.24;

const STATUS_STYLES: Record<SlotStatus, string> = {
  available: 'bg-[#E8F0E8] border-[#A8B2A6] text-[#3D5A3D]',
  occupied: 'bg-[#F5E6DC] border-[#C29474] text-[#6B4A32]',
  reserved: 'bg-[#E8E4F0] border-[#8B7FA8] text-[#4A3D6B]',
  maintenance: 'bg-[#F0EBE6] border-[#B0A89E] text-[#5A534D]',
};

export function SitesWidget({ onUpdate }: { onUpdate: () => void }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [available, setAvailable] = useState(25);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [contactForm, setContactForm] = useState({
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    contactAddress: '',
    contactRvType: '',
    contactLicensePlate: '',
    contactEmergency: '',
    contactNotes: '',
    rentalType: 'monthly' as RentalType,
    rentAmount: '750',
    balanceDue: '750',
    paymentMethod: '',
  });
  const [formSaved, setFormSaved] = useState(false);
  const [loadingContact, setLoadingContact] = useState(false);
  const [customers, setCustomers] = useState<StoredCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [siteImageUrlInput, setSiteImageUrlInput] = useState('');
  const [siteDescription, setSiteDescription] = useState('');
  const [siteDescSaved, setSiteDescSaved] = useState(false);
  const [uploadingSlotId, setUploadingSlotId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [statusForm, setStatusForm] = useState({
    guestName: '',
    startDate: '',
    endDate: '',
    rentalType: 'monthly' as RentalType,
    note: '',
    paymentMethod: '',
    markPaid: false,
  });
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusPanel, setStatusPanel] = useState<'none' | 'reserve' | 'maintenance'>('none');
  const [meterReading, setMeterReading] = useState('');
  const [meterPrevious, setMeterPrevious] = useState('');
  const [meterDate, setMeterDate] = useState(new Date().toISOString().split('T')[0]);
  const [meterNote, setMeterNote] = useState('');
  const [meterBaseline, setMeterBaseline] = useState('0');
  const [meterError, setMeterError] = useState<string | null>(null);
  const [meterSaving, setMeterSaving] = useState(false);
  const [rates, setRates] = useState<RentalRatesConfig & { allowedRentalTypes?: RentalType[] }>({
    ...DEFAULT_RENTAL_RATES,
    allowedRentalTypes: ['daily', 'weekly', 'monthly'],
  });
  const pendingUploadSlotIdRef = useRef<string | null>(null);
  const sitePhotoInputRef = useRef<HTMLInputElement>(null);
  const gridPhotoInputRef = useRef<HTMLInputElement>(null);

  const loadSlots = async () => {
    const res = await apiFetch('/api/slots');
    if (res.ok) {
      const data = await res.json();
      setSlots(data.slots);
      setAvailable(data.available);
    }
  };

  const loadCustomers = async () => {
    const res = await apiFetch('/api/customers');
    if (res.ok) setCustomers(await res.json());
  };

  useEffect(() => {
    const applyRates = (active: Awaited<ReturnType<typeof fetchActiveRates>>) => {
      setRates(active);
      const allowed = active.allowedRentalTypes?.length
        ? active.allowedRentalTypes
        : [...ALL_RENTAL_TYPES];
      const defaultType = allowed[0] ?? 'monthly';
      setContactForm(prev => {
        const rentalType = allowed.includes(prev.rentalType) ? prev.rentalType : defaultType;
        const amount = String(rentAmountForType(rentalType, new Date(), active));
        // Refresh default amounts so new rates show in booking fields
        return {
          ...prev,
          rentalType,
          rentAmount: amount,
          balanceDue: amount,
        };
      });
      setStatusForm(prev => (
        allowed.includes(prev.rentalType) ? prev : { ...prev, rentalType: defaultType }
      ));
    };
    fetchActiveRates({ force: true }).then(applyRates);
    return subscribeActiveRates(() => {
      fetchActiveRates({ force: true }).then(applyRates);
    });
  }, []);

  const allowedRentalTypes = rates.allowedRentalTypes?.length
    ? rates.allowedRentalTypes
    : [...ALL_RENTAL_TYPES];

  useEffect(() => {
    loadSlots();
    loadCustomers();
  }, []);

  const applyCustomer = (customer: StoredCustomer) => {
    setSelectedCustomerId(customer.id);
    setContactForm(prev => ({
      ...prev,
      contactName: customer.name,
      contactPhone: customer.phone,
      contactEmail: customer.email,
      // Keep site address if already filled; customers store has no address field
      contactAddress: prev.contactAddress || '',
      contactRvType: customer.rvType ?? '',
      contactLicensePlate: customer.licensePlate ?? '',
      contactEmergency: customer.emergencyContact ?? '',
      contactNotes: customer.notes ?? '',
    }));
    setFormSaved(false);
  };

  const initMeterForm = (slot: Slot) => {
    const latest = slot.meterRecords?.[0];
    setMeterPrevious(String(latest?.reading ?? slot.previousMeterReading ?? 0));
    setMeterBaseline(String(slot.meterBaselineCredit ?? 0));
    setMeterReading('');
    setMeterNote('');
    setMeterDate(new Date().toISOString().split('T')[0]);
    setMeterError(null);
  };

  const loadContactForm = async (slot: Slot) => {
    const rentalType = slot.rentalType ?? 'monthly';
    const defaultRent = String(rentAmountForType(rentalType, new Date(), rates));
    initMeterForm(slot);

    if (slot.status === 'available') {
      const defaultType = (allowedRentalTypes[0] ?? 'monthly') as RentalType;
      const defaultRent = String(rentAmountForType(defaultType, new Date(), rates));
      setSelectedCustomerId('');
      setContactForm({
        contactName: '',
        contactPhone: '',
        contactEmail: '',
        contactAddress: '',
        contactRvType: '',
        contactLicensePlate: '',
        contactEmergency: '',
        contactNotes: '',
        rentalType: defaultType,
        rentAmount: defaultRent,
        balanceDue: defaultRent,
        paymentMethod: '',
      });
      setFormSaved(false);
      return;
    }

    let form = {
      contactName: slot.contactName ?? slot.tenantName ?? '',
      contactPhone: slot.contactPhone ?? '',
      contactEmail: slot.contactEmail ?? '',
      contactAddress: slot.contactAddress ?? '',
      contactRvType: slot.contactRvType ?? '',
      contactLicensePlate: slot.contactLicensePlate ?? '',
      contactEmergency: slot.contactEmergency ?? '',
      contactNotes: slot.contactNotes ?? slot.notes ?? '',
      rentalType,
      rentAmount: String(slot.rentAmount ?? defaultRent),
      balanceDue: String(slot.balanceDue ?? slot.rentAmount ?? defaultRent),
      paymentMethod: slot.paymentMethod ?? '',
    };

    if (slot.tenantId) {
      setLoadingContact(true);
      try {
        const [tRes, pRes] = await Promise.all([
          apiFetch(`/api/tenants/${slot.tenantId}`),
          apiFetch(`/api/tenants/${slot.tenantId}/payments`),
        ]);
        if (tRes.ok) {
          const tenant = await tRes.json();
          form = {
            ...form,
            contactName: form.contactName || tenant.name || '',
            contactPhone: form.contactPhone || tenant.phone || '',
            contactEmail: form.contactEmail || tenant.email || '',
            contactAddress: form.contactAddress || tenant.address || '',
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

  const initStatusForm = (slot: Slot) => {
    setStatusForm({
      guestName: slot.contactName || slot.tenantName || '',
      startDate: slot.startDate || '',
      endDate: slot.endDate || '',
      rentalType: slot.rentalType || 'monthly',
      note: slot.notes || '',
      paymentMethod: slot.paymentMethod || '',
      markPaid: !!slot.paymentMethod,
    });
    setStatusError(null);
    setStatusPanel(
      slot.status === 'reserved' ? 'reserve'
        : slot.status === 'maintenance' ? 'maintenance'
        : 'none'
    );
  };

  const handleSelectSlot = async (slot: Slot) => {
    setSelectedSlot(slot);
    setSiteImageUrlInput('');
    setSiteDescription(slot.siteDescription ?? '');
    setSiteDescSaved(false);
    initStatusForm(slot);
    await loadContactForm(slot);
  };

  const handleSaveSiteDescription = async () => {
    if (!selectedSlot) return;
    setIsLoading(true);
    setUploadError(null);
    try {
      const res = await apiFetch(`/api/slots/${selectedSlot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteDescription: siteDescription.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        await refreshSelectedSlot(updated);
        setSiteDescription(updated.siteDescription ?? '');
        setSiteDescSaved(true);
        setTimeout(() => setSiteDescSaved(false), 2500);
      } else {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || 'Could not save site description');
      }
    } catch {
      setUploadError('Network error — could not save description.');
    } finally {
      setIsLoading(false);
    }
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
      const res = await apiFetch(`/api/slots/${slotId}/photo`, { method: 'POST', body: form });
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
      const res = await apiFetch(`/api/slots/${selectedSlot.id}`, {
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
      const res = await apiFetch(`/api/slots/${selectedSlot.id}/photo`, { method: 'DELETE' });
      if (res.ok) await refreshSelectedSlot(await res.json());
    } finally {
      setIsLoading(false);
    }
  };

  const handleSlotUpdate = async (slot: Slot, status: SlotStatus, extra: Record<string, unknown> = {}) => {
    setStatusError(null);
    setIsLoading(true);
    try {
      const res = await apiFetch(`/api/slots/${slot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...extra }),
      });
      if (res.ok) {
        const updated = await res.json();
        await loadSlots();
        onUpdate();
        setSelectedSlot(updated);
        initStatusForm(updated);
        await loadContactForm(updated);
      } else {
        const data = await res.json().catch(() => ({}));
        setStatusError(data.error || 'Could not update site status');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveReservation = async () => {
    if (!selectedSlot) return;
    const { guestName, startDate, endDate, rentalType, note, markPaid, paymentMethod } = statusForm;
    if (!startDate || !endDate) {
      setStatusError('Check-in and check-out dates are required for a reservation.');
      return;
    }
    if (endDate <= startDate) {
      setStatusError('Check-out must be after check-in.');
      return;
    }
    if (markPaid && (rentalType === 'daily' || rentalType === 'weekly') && !paymentMethod.trim()) {
      setStatusError('Choose a payment method to mark this stay paid for the tax report.');
      return;
    }
    const name = guestName.trim() || 'Reserved guest';
    const rent = rentAmountForType(rentalType, new Date(), rates);
    await handleSlotUpdate(selectedSlot, 'reserved', {
      contactName: name,
      tenantName: name,
      startDate,
      endDate,
      rentalType,
      notes: note.trim() || undefined,
      bookedAt: selectedSlot.bookedAt || new Date().toISOString().split('T')[0],
      ...(markPaid && (rentalType === 'daily' || rentalType === 'weekly')
        ? {
            paymentMethod: paymentMethod.trim(),
            rentAmount: selectedSlot.rentAmount ?? rent,
            balanceDue: selectedSlot.balanceDue ?? rent,
          }
        : {}),
    });
    setStatusPanel('reserve');
  };

  const handleSaveMaintenance = async () => {
    if (!selectedSlot) return;
    const note = statusForm.note.trim();
    if (!note) {
      setStatusError('Add a maintenance note (e.g. plumbing, electric, pad repair).');
      return;
    }
    await handleSlotUpdate(selectedSlot, 'maintenance', {
      notes: note,
    });
    setStatusPanel('maintenance');
  };

  const handleMarkAvailable = async () => {
    if (!selectedSlot) return;
    await handleSlotUpdate(selectedSlot, 'available');
    setStatusPanel('none');
  };

  const handleRentalTypeChange = (rentalType: RentalType) => {
    const rentAmount = String(rentAmountForType(rentalType, new Date(), rates));
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
            contactAddress: contactForm.contactAddress.trim() || undefined,
            contactRvType: contactForm.contactRvType,
            contactLicensePlate: contactForm.contactLicensePlate,
            contactEmergency: contactForm.contactEmergency,
            contactNotes: contactForm.contactNotes,
            rentalType: contactForm.rentalType,
            rentAmount: parseFloat(contactForm.rentAmount) || 0,
            balanceDue: parseFloat(contactForm.balanceDue) || 0,
            // Paid daily/weekly → tax report (server records paid ledger when paymentMethod set)
            ...(contactForm.paymentMethod.trim()
              && (contactForm.rentalType === 'daily' || contactForm.rentalType === 'weekly')
              ? {
                  paymentMethod: contactForm.paymentMethod.trim(),
                  bookedAt: selectedSlot.bookedAt || new Date().toISOString().split('T')[0],
                  startDate: selectedSlot.startDate,
                  endDate: selectedSlot.endDate,
                }
              : {}),
          };

      const res = await apiFetch(`/api/slots/${selectedSlot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (selectedSlot.tenantId) {
        await apiFetch(`/api/tenants/${selectedSlot.tenantId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: contactForm.contactName,
            phone: contactForm.contactPhone,
            email: contactForm.contactEmail,
            address: contactForm.contactAddress.trim() || undefined,
            rvType: contactForm.contactRvType,
            licensePlate: contactForm.contactLicensePlate,
            emergencyContact: contactForm.contactEmergency,
            notes: contactForm.contactNotes,
            description: contactForm.contactNotes,
            rentalType: contactForm.rentalType,
          }),
        });
        await apiFetch(`/api/tenants/${selectedSlot.tenantId}/payments`, {
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

  const handleSaveSlotMeter = async () => {
    if (!selectedSlot) return;
    const reading = parseFloat(meterReading);
    if (!Number.isFinite(reading) || reading < 0) {
      setMeterError('Enter a valid meter reading (0 or greater).');
      return;
    }
    setMeterSaving(true);
    setMeterError(null);
    try {
      const res = await apiFetch(`/api/slots/${selectedSlot.id}/meter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reading,
          date: meterDate,
          note: meterNote.trim() || undefined,
          previousReading: meterPrevious === '' ? undefined : parseFloat(meterPrevious) || 0,
          baselineCredit: parseFloat(meterBaseline) || 0,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMeterError(data.error || 'Could not save meter reading');
        return;
      }
      const data = await res.json();
      const updated = data.slot as Slot;
      setSelectedSlot(updated);
      initMeterForm(updated);
      setContactForm(prev => ({
        ...prev,
        balanceDue: String(updated.balanceDue ?? prev.balanceDue),
      }));
      await loadSlots();
      onUpdate();
    } catch {
      setMeterError('Network error — could not save meter reading.');
    } finally {
      setMeterSaving(false);
    }
  };

  const handleSaveMeterBaseline = async () => {
    if (!selectedSlot) return;
    const baseline = parseFloat(meterBaseline);
    if (!Number.isFinite(baseline) || baseline < 0) {
      setMeterError('Included kWh must be 0 or greater.');
      return;
    }
    setMeterSaving(true);
    setMeterError(null);
    try {
      const res = await apiFetch(`/api/slots/${selectedSlot.id}/meter/baseline`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baselineCredit: baseline }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMeterError(data.error || 'Could not save included kWh');
        return;
      }
      const data = await res.json();
      const updated = data.slot as Slot;
      setSelectedSlot(updated);
      setContactForm(prev => ({
        ...prev,
        balanceDue: String(updated.balanceDue ?? prev.balanceDue),
      }));
      await loadSlots();
    } catch {
      setMeterError('Network error — could not save included kWh.');
    } finally {
      setMeterSaving(false);
    }
  };

  const handleDeleteSlotMeter = async (record: MeterRecord) => {
    if (!selectedSlot) return;
    if (!window.confirm(`Delete meter reading from ${record.date}? Overage will be recalculated.`)) return;
    setMeterSaving(true);
    setMeterError(null);
    try {
      const res = await apiFetch(`/api/slots/${selectedSlot.id}/meter/${record.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMeterError(data.error || 'Could not delete meter record');
        return;
      }
      const data = await res.json();
      const updated = data.slot as Slot;
      setSelectedSlot(updated);
      initMeterForm(updated);
      setContactForm(prev => ({
        ...prev,
        balanceDue: String(updated.balanceDue ?? prev.balanceDue),
      }));
      await loadSlots();
      onUpdate();
    } catch {
      setMeterError('Network error — could not delete meter record.');
    } finally {
      setMeterSaving(false);
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
      const res = await apiFetch(`/api/slots/${selectedSlot.id}/remove-tenant`, { method: 'POST' });
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
      const res = await apiFetch(`/api/slots/${selectedSlot.id}/add-tenant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...contactForm,
          rentAmount: parseFloat(contactForm.rentAmount) || 0,
          balanceDue: parseFloat(contactForm.balanceDue) || 0,
        }),
      });
      if (res.ok) {
        await apiFetch('/api/customers/upsert', {
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

  /** Occupied/reserved guest can become or switch to monthly or weekly tenant */
  const canSetTenantRental = (() => {
    if (!selectedSlot) return false;
    if (selectedSlot.status === 'available' || selectedSlot.status === 'maintenance') return false;
    return !!(
      selectedSlot.contactName
      || selectedSlot.tenantName
      || contactForm.contactName.trim()
      || selectedSlot.tenantId
    );
  })();

  const currentSlotRental =
    selectedSlot?.rentalType
    || contactForm.rentalType
    || (selectedSlot?.tenantId ? 'monthly' : undefined);

  const handleSetTenantRental = async (target: 'monthly' | 'weekly') => {
    if (!selectedSlot || !canSetTenantRental) return;
    const name =
      contactForm.contactName.trim() ||
      selectedSlot.contactName ||
      selectedSlot.tenantName ||
      'Guest';
    const prior = currentSlotRental || 'short-term/reserved';
    if (prior === target && selectedSlot.tenantId) {
      setStatusError(`Already a ${target} tenant. Change Rental Type and Save, or pick the other type.`);
      return;
    }
    const rent = rentAmountForType(target, new Date(), rates);
    if (
      !window.confirm(
        `Set ${name} as a ${target} tenant on ${selectedSlot.label}?\n\n` +
          `Current: ${prior}\n` +
          `${target === 'monthly' ? 'Monthly' : 'Weekly'} rent: $${rent.toFixed(2)} (editable after).\n` +
          'Contact info, stay dates, meters, and card references are kept.'
      )
    ) {
      return;
    }
    setIsLoading(true);
    setStatusError(null);
    try {
      const res = await apiFetch(`/api/slots/${selectedSlot.id}/convert-to-tenant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactName: contactForm.contactName.trim() || name,
          contactPhone: contactForm.contactPhone,
          contactEmail: contactForm.contactEmail,
          contactAddress: contactForm.contactAddress,
          contactRvType: contactForm.contactRvType,
          contactLicensePlate: contactForm.contactLicensePlate,
          contactEmergency: contactForm.contactEmergency,
          contactNotes: contactForm.contactNotes,
          rentalType: target,
          rentAmount: rent,
          balanceDue: rent,
          startDate: selectedSlot.startDate || contactForm.startDate || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatusError(data.error || `Could not set ${target} tenant`);
        return;
      }
      await loadCustomers();
      await loadSlots();
      onUpdate();
      if (data.slot) {
        setSelectedSlot(data.slot);
        await loadContactForm(data.slot);
      } else {
        setSelectedSlot(null);
      }
      window.alert(data.message || `${name} is now a ${target} tenant on ${selectedSlot.label}.`);
    } catch {
      setStatusError('Network error — could not update tenant rental type.');
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
        <button
          type="button"
          onClick={() => {
            void loadSlots();
            void loadCustomers();
            onUpdate();
          }}
          disabled={isLoading}
          className="flex items-center gap-2 text-sm bg-white border border-[#E2D9D0] text-[#5A6355] px-4 py-2 rounded-xl hover:bg-[#FBF9F7] transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
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
              {slot.status === 'available' && slot.siteDescription && (
                <div className="text-[10px] mt-1.5 opacity-80 leading-snug line-clamp-2">
                  {slot.siteDescription}
                </div>
              )}
              {slot.status === 'maintenance' && slot.notes && (
                <div className="text-[10px] mt-1 opacity-70 leading-snug line-clamp-2">{slot.notes}</div>
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

              <div>
                <h4 className="text-sm font-serif text-[#3D3730] border-b border-[#E2D9D0] pb-2 mb-3">
                  Site description
                </h4>
                <p className="text-xs text-[#5A6355] mb-3">
                  Short note about this pad (hookups, shade, pull-through, near bathhouse, etc.).
                  Saved on the site itself — not cleared when a guest leaves.
                </p>
                <textarea
                  value={siteDescription}
                  onChange={(e) => {
                    setSiteDescription(e.target.value.slice(0, 500));
                    setSiteDescSaved(false);
                  }}
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. 50 amp · pull-through · level pad · near laundry"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
                <div className="flex items-center justify-between gap-3 mt-2">
                  <span className="text-[10px] text-[#5A6355]">
                    {siteDescription.length}/500
                  </span>
                  <button
                    type="button"
                    onClick={handleSaveSiteDescription}
                    disabled={isLoading}
                    className="flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50 transition"
                  >
                    <Save className="w-4 h-4" />
                    {siteDescSaved ? 'Saved' : 'Save description'}
                  </button>
                </div>
              </div>

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
                            contactAddress: '',
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
                        {contactForm.contactAddress && <p className="text-[#5A6355]">{contactForm.contactAddress}</p>}
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
                    <div className="space-y-2 sm:col-span-2">
                      <label className="text-xs uppercase tracking-widest text-[#5A6355]">Address</label>
                      <input
                        value={contactForm.contactAddress}
                        onChange={e => { setContactForm(prev => ({ ...prev, contactAddress: e.target.value })); setFormSaved(false); }}
                        placeholder="Street, city, state, ZIP"
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
                        {allowedRentalTypes.includes('monthly') && (
                          <option value="monthly">Monthly (${rates.monthly.toFixed(2)})</option>
                        )}
                        {allowedRentalTypes.includes('weekly') && (
                          <option value="weekly">Weekly (${rates.weekly.toFixed(2)})</option>
                        )}
                        {allowedRentalTypes.includes('daily') && (
                          <option value="daily">Daily ({formatDailyRateDescription(rates)})</option>
                        )}
                      </select>
                      {contactForm.rentalType === 'daily' && allowedRentalTypes.includes('daily') && (
                        <p className="text-xs text-[#5A6355]">
                          Today&apos;s rate: ${rentAmountForType('daily', new Date(), rates).toFixed(2)}
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
                    {(contactForm.rentalType === 'daily' || contactForm.rentalType === 'weekly') && (
                      <div className="space-y-2 sm:col-span-3">
                        <label className="text-xs uppercase tracking-widest text-[#5A6355]">
                          Payment method (sets paid on tax report)
                        </label>
                        <select
                          value={contactForm.paymentMethod}
                          onChange={e => {
                            setContactForm(prev => ({ ...prev, paymentMethod: e.target.value }));
                            setFormSaved(false);
                          }}
                          className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                        >
                          <option value="">Not paid yet</option>
                          <option value="Cash">Cash</option>
                          <option value="Card">Card</option>
                          <option value="Check">Check</option>
                          <option value="Venmo">Venmo</option>
                          <option value="Zelle">Zelle</option>
                        </select>
                        <p className="text-[11px] text-[#5A6355]">
                          For daily/weekly stays: choose a method and Save to add this stay to the tax report.
                        </p>
                      </div>
                    )}
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

                {/* Weekly meter / electric overage */}
                {contactForm.rentalType === 'weekly' && selectedSlot.status !== 'available' && (
                  <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 sm:p-5 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-white border border-[#E2D9D0] flex items-center justify-center shrink-0">
                        <Gauge className="w-4 h-4 text-[#5A6355]" />
                      </div>
                      <div>
                        <h4 className="text-sm font-serif text-[#3D3730]">Meter reading — weekly overage</h4>
                        <p className="text-xs text-[#5A6355] mt-1">
                          Record kWh for this weekly stay. Overage = max(0, usage − included kWh) × ${KWH_RATE.toFixed(2)}/kWh,
                          then added to balance due with rent.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Previous (kWh)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={meterPrevious}
                          onChange={e => setMeterPrevious(e.target.value)}
                          className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">New reading (kWh)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={meterReading}
                          onChange={e => setMeterReading(e.target.value)}
                          placeholder="e.g. 12450"
                          className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Date</label>
                        <input
                          type="date"
                          value={meterDate}
                          onChange={e => setMeterDate(e.target.value)}
                          className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Included kWh</label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={meterBaseline}
                            onChange={e => setMeterBaseline(e.target.value)}
                            className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                          />
                          <button
                            type="button"
                            onClick={handleSaveMeterBaseline}
                            disabled={meterSaving}
                            className="shrink-0 px-3 py-2 rounded-xl text-xs font-semibold border border-[#E2D9D0] bg-white text-[#5A6355] hover:bg-[#F0EBE6] disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Note (optional)</label>
                      <input
                        type="text"
                        value={meterNote}
                        onChange={e => setMeterNote(e.target.value)}
                        placeholder="e.g. End of week reading"
                        className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                      />
                    </div>

                    {(() => {
                      const prev = parseFloat(meterPrevious) || 0;
                      const next = parseFloat(meterReading);
                      const usage = Number.isFinite(next) ? Math.max(0, next - prev) : (selectedSlot.currentMeterUsage ?? 0);
                      const baseline = parseFloat(meterBaseline) || 0;
                      const net = Math.max(0, usage - baseline);
                      const overage = Math.round(net * KWH_RATE * 100) / 100;
                      const rent = parseFloat(contactForm.rentAmount) || 0;
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div className="rounded-xl bg-white border border-[#E2D9D0] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">Usage</p>
                            <p className="font-medium text-[#3D3730]">{usage.toLocaleString()} kWh</p>
                          </div>
                          <div className="rounded-xl bg-white border border-[#E2D9D0] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">Billable</p>
                            <p className="font-medium text-[#3D3730]">{net.toLocaleString()} kWh</p>
                          </div>
                          <div className="rounded-xl bg-white border border-[#E2D9D0] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">Overage</p>
                            <p className="font-medium text-[#C29474]">{formatCurrency(overage)}</p>
                          </div>
                          <div className="rounded-xl bg-white border border-[#E2D9D0] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-widest text-[#5A6355]">Rent + overage</p>
                            <p className="font-medium text-[#3D3730]">{formatCurrency(rent + overage)}</p>
                          </div>
                        </div>
                      );
                    })()}

                    <button
                      type="button"
                      onClick={handleSaveSlotMeter}
                      disabled={meterSaving || !meterReading}
                      className="flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50 w-full sm:w-auto"
                    >
                      <Gauge className="w-4 h-4" />
                      {meterSaving ? 'Saving…' : 'Save meter reading'}
                    </button>

                    {meterError && (
                      <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{meterError}</p>
                    )}

                    {(selectedSlot.meterRecords?.length ?? 0) > 0 && (
                      <div className="space-y-2 pt-2 border-t border-[#E2D9D0]">
                        <p className="text-[10px] uppercase tracking-widest text-[#5A6355] font-semibold">Meter history</p>
                        <ul className="space-y-1.5">
                          {(selectedSlot.meterRecords ?? []).map(record => (
                            <li
                              key={record.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-xs bg-white border border-[#E2D9D0] rounded-xl px-3 py-2"
                            >
                              <span className="text-[#3D3730]">
                                {record.date} · {record.previousReading.toLocaleString()} → {record.reading.toLocaleString()} ·{' '}
                                <strong>{record.usage.toLocaleString()} kWh</strong>
                                {record.note ? ` · ${record.note}` : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeleteSlotMeter(record)}
                                disabled={meterSaving}
                                className="text-red-600 hover:underline font-semibold disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </li>
                          ))}
                        </ul>
                        {(selectedSlot.meterOverageCharge ?? 0) > 0 && (
                          <p className="text-xs text-[#5A6355]">
                            Current overage on site:{' '}
                            <strong className="text-[#C29474]">
                              {formatCurrency(selectedSlot.meterOverageCharge ?? 0)}
                            </strong>
                            {' '}· Balance due includes rent + overage
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {canSetTenantRental && (
                  <div className="rounded-2xl border-2 border-[#C29474] bg-[#FBF9F7] p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-white border border-[#E2D9D0] flex items-center justify-center shrink-0">
                        <UserPlus className="w-4 h-4 text-[#C29474]" />
                      </div>
                      <div>
                        <h4 className="text-sm font-serif text-[#3D3730]">
                          Tenant rental type
                        </h4>
                        <p className="text-xs text-[#5A6355] mt-1">
                          Set this guest as a <strong>monthly</strong> or <strong>weekly</strong>{' '}
                          tenant. Contact, stay dates, meters, and card refs are kept. Current type:{' '}
                          <strong className="capitalize">{currentSlotRental || 'unknown'}</strong>.
                          {' '}Monthly ${rentAmountForType('monthly', new Date(), rates).toFixed(2)} ·
                          Weekly ${rentAmountForType('weekly', new Date(), rates).toFixed(2)}.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      {allowedRentalTypes.includes('monthly') && currentSlotRental !== 'monthly' && (
                        <button
                          type="button"
                          onClick={() => handleSetTenantRental('monthly')}
                          disabled={isLoading}
                          className="flex-1 flex items-center justify-center gap-2 bg-[#C29474] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition disabled:opacity-50"
                        >
                          <UserPlus className="w-4 h-4" />
                          {isLoading ? 'Updating…' : 'Set as monthly tenant'}
                        </button>
                      )}
                      {allowedRentalTypes.includes('weekly') && currentSlotRental !== 'weekly' && (
                        <button
                          type="button"
                          onClick={() => handleSetTenantRental('weekly')}
                          disabled={isLoading}
                          className="flex-1 flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
                        >
                          <UserPlus className="w-4 h-4" />
                          {isLoading ? 'Updating…' : 'Set as weekly tenant'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

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

                {selectedSlot.tenantId && (selectedSlot.status === 'occupied' || selectedSlot.status === 'reserved') && (
                  <EarlyDeparturePanel
                    compact
                    tenantId={selectedSlot.tenantId}
                    tenantName={selectedSlot.tenantName || contactForm.contactName}
                    defaultPreviousReading={Number(selectedSlot.previousMeterReading) || 0}
                    defaultDepartureDate={
                      selectedSlot.endDate && selectedSlot.endDate !== 'ongoing'
                        ? selectedSlot.endDate
                        : new Date().toISOString().split('T')[0]
                    }
                    onApplied={async () => {
                      await loadSlots();
                      onUpdate();
                      const res = await apiFetch('/api/slots');
                      if (res.ok) {
                        const data = await res.json();
                        const slotsList = Array.isArray(data) ? data : data.slots ?? [];
                        const updated = slotsList.find((s: Slot) => s.id === selectedSlot.id);
                        if (updated) {
                          setSelectedSlot(updated);
                          await loadContactForm(updated);
                        }
                      }
                    }}
                  />
                )}
                </>
              )}
            </div>

            <div className="border-t border-[#E2D9D0] pt-5 space-y-4">
              <div>
                <p className="text-xs text-[#5A6355] mb-1 uppercase tracking-wider font-semibold">Site status</p>
                <p className="text-sm text-[#3D3730] capitalize mb-3">
                  Currently: <strong>{selectedSlot.status}</strong>
                  {selectedSlot.status === 'maintenance' && selectedSlot.notes
                    ? ` — ${selectedSlot.notes}`
                    : ''}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  disabled={isLoading || selectedSlot.status === 'available'}
                  onClick={handleMarkAvailable}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold border-2 transition ${STATUS_STYLES.available} ${selectedSlot.status === 'available' ? 'ring-2 ring-[#5A6355]' : ''} disabled:opacity-50`}
                >
                  Available
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => setStatusPanel(statusPanel === 'reserve' ? 'none' : 'reserve')}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold border-2 transition flex items-center justify-center gap-1 ${STATUS_STYLES.reserved} ${selectedSlot.status === 'reserved' || statusPanel === 'reserve' ? 'ring-2 ring-[#5A6355]' : ''}`}
                >
                  <CalendarRange className="w-3.5 h-3.5" />
                  {selectedSlot.status === 'reserved' ? 'Edit reserve' : 'Reserve'}
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => setStatusPanel(statusPanel === 'maintenance' ? 'none' : 'maintenance')}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold border-2 transition flex items-center justify-center gap-1 ${STATUS_STYLES.maintenance} ${selectedSlot.status === 'maintenance' || statusPanel === 'maintenance' ? 'ring-2 ring-[#5A6355]' : ''}`}
                >
                  <Wrench className="w-3.5 h-3.5" />
                  Maintenance
                </button>
                <button
                  type="button"
                  disabled={isLoading || selectedSlot.status === 'occupied'}
                  onClick={() => handleSlotUpdate(selectedSlot, 'occupied')}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold border-2 transition ${STATUS_STYLES.occupied} ${selectedSlot.status === 'occupied' ? 'ring-2 ring-[#5A6355]' : ''} disabled:opacity-50`}
                >
                  Occupied
                </button>
              </div>

              {statusPanel === 'reserve' && (
                <div className="rounded-2xl border border-[#8B7FA8]/40 bg-[#E8E4F0]/40 p-4 space-y-3">
                  <h4 className="text-sm font-serif text-[#4A3D6B]">
                    {selectedSlot.status === 'reserved' ? 'Change reservation' : 'New reservation'}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-[10px] uppercase tracking-widest text-[#4A3D6B]/80">Guest name</label>
                      <input
                        value={statusForm.guestName}
                        onChange={e => setStatusForm(p => ({ ...p, guestName: e.target.value }))}
                        placeholder="Guest or party name"
                        className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest text-[#4A3D6B]/80">Check-in *</label>
                      <input
                        type="date"
                        value={statusForm.startDate}
                        onChange={e => setStatusForm(p => ({ ...p, startDate: e.target.value }))}
                        className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest text-[#4A3D6B]/80">Check-out *</label>
                      <input
                        type="date"
                        value={statusForm.endDate}
                        min={statusForm.startDate || undefined}
                        onChange={e => setStatusForm(p => ({ ...p, endDate: e.target.value }))}
                        className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest text-[#4A3D6B]/80">Rental type</label>
                      <select
                        value={statusForm.rentalType}
                        onChange={e => setStatusForm(p => ({ ...p, rentalType: e.target.value as RentalType }))}
                        className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm"
                      >
                        {allowedRentalTypes.includes('daily') && <option value="daily">Daily</option>}
                        {allowedRentalTypes.includes('weekly') && <option value="weekly">Weekly</option>}
                        {allowedRentalTypes.includes('monthly') && <option value="monthly">Monthly</option>}
                      </select>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-[10px] uppercase tracking-widest text-[#4A3D6B]/80">Note (optional)</label>
                      <input
                        value={statusForm.note}
                        onChange={e => setStatusForm(p => ({ ...p, note: e.target.value }))}
                        placeholder="e.g. Phone hold, deposit pending"
                        className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm"
                      />
                    </div>
                    {(statusForm.rentalType === 'daily' || statusForm.rentalType === 'weekly') && (
                      <div className="sm:col-span-2 space-y-2 rounded-xl border border-[#C29474]/40 bg-white/70 p-3">
                        <label className="flex items-center gap-2 text-sm text-[#3D3730] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={statusForm.markPaid}
                            onChange={e => setStatusForm(p => ({
                              ...p,
                              markPaid: e.target.checked,
                              paymentMethod: e.target.checked ? (p.paymentMethod || 'Cash') : '',
                            }))}
                            className="rounded border-[#E2D9D0]"
                          />
                          Mark paid — add to tax report
                        </label>
                        {statusForm.markPaid && (
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-widest text-[#4A3D6B]/80">Payment method</label>
                            <select
                              value={statusForm.paymentMethod}
                              onChange={e => setStatusForm(p => ({ ...p, paymentMethod: e.target.value }))}
                              className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm"
                            >
                              <option value="Cash">Cash</option>
                              <option value="Card">Card</option>
                              <option value="Check">Check</option>
                              <option value="Venmo">Venmo</option>
                              <option value="Zelle">Zelle</option>
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveReservation}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 bg-[#4A3D6B] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3a2f55] disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {isLoading ? 'Saving…' : selectedSlot.status === 'reserved' ? 'Update reservation' : 'Reserve site'}
                  </button>
                </div>
              )}

              {statusPanel === 'maintenance' && (
                <div className="rounded-2xl border border-[#B0A89E] bg-[#F0EBE6]/60 p-4 space-y-3">
                  <h4 className="text-sm font-serif text-[#5A534D] flex items-center gap-2">
                    <Wrench className="w-4 h-4" />
                    Maintenance
                  </h4>
                  <p className="text-xs text-[#5A534D]/90">
                    Mark this site unavailable and record why (required).
                  </p>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-[#5A534D]/80">Maintenance note *</label>
                    <textarea
                      value={statusForm.note}
                      onChange={e => setStatusForm(p => ({ ...p, note: e.target.value }))}
                      placeholder="e.g. Water hookup repair, pad grading, electrical"
                      rows={3}
                      className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm resize-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveMaintenance}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 bg-[#5A534D] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3d3934] disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {isLoading ? 'Saving…' : 'Mark maintenance'}
                  </button>
                </div>
              )}

              {statusError && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  {statusError}
                </p>
              )}
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