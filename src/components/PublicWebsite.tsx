import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Photo, RentalType, Slot, ParkContact, BookingContactInfo, CustomerComment } from '../../types';

/** Public availability only — never includes guest/tenant contact fields */
const PUBLIC_HEADERS = { 'X-Pineflats-Client': 'public-website' };
import { DEFAULT_CONTACT } from '../../contactDefaults';
import {
  ArrowLeft, Map, Calendar, Phone, Mail, CheckCircle2, Sun, Clock, Home, MapPin,
  MessageSquare, X, Send, Star, Image as ImageIcon, Images, ScrollText, Play
} from 'lucide-react';
import {
  ALL_RENTAL_TYPES,
  DEFAULT_RENTAL_RATES,
  getDailyRentForDate, dailyRateLabel, formatDailyRateDescription,
  type RentalRatesConfig,
} from '../../rentUtils';
import { fetchActiveRates, subscribeActiveRates, type ActiveRates } from '../lib/activeRates';
import { PublicBookingCalendar } from './PublicBookingCalendar';
import { BookingContactPage } from './BookingContactPage';
import { BookingPaymentPage } from './BookingPaymentPage';

type BookingStep = 'browse' | 'contact' | 'payment' | 'confirmed';
type SiteTab = 'home' | 'book' | 'dates' | 'photos' | 'policy';
/** Snapshot so checkout / dates page survive availability polls after the site is filtered out */
type BookingSite = { id: string; label: string; imageUrl?: string };

const PARK_POLICIES: { title: string; body: string }[] = [
  {
    title: 'Check-in & check-out',
    body: 'Check-in is after 1:00 PM and check-out is by 11:00 AM unless arranged with the office. Late check-outs may be charged an extra day when the site is needed for the next guest.',
  },
  {
    title: 'Quiet hours',
    body: 'Quiet hours are 10:00 PM – 7:00 AM. Please keep music, generators, and conversations at a respectful volume so everyone can rest.',
  },
  {
    title: 'Speed & driving',
    body: 'Speed limit is 5 mph throughout the park. Children and pets are often near the roads — drive slowly and carefully.',
  },
  {
    title: 'Pets',
    body: 'Pets are welcome when leashed and under control. Clean up after pets immediately. Aggressive animals and pets left unattended outdoors are not permitted.',
  },
  {
    title: 'Sites & utilities',
    body: 'Please keep your site neat and free of clutter. Do not dig trenches or alter the pad. Report utility issues to management promptly. Use only approved adapters for electrical connections.',
  },
  {
    title: 'Trash & recycling',
    body: 'Place trash in sealed bags in designated dumpsters. Do not leave trash outside overnight. Recycle where bins are provided.',
  },
  {
    title: 'Visitors',
    body: 'Guests are responsible for their visitors. Day visitors should leave by quiet hours. Overnight visitors must be registered with the office and may incur additional fees if space is used.',
  },
  {
    title: 'Fires & smoking',
    body: 'Open ground fires are only allowed in designated fire rings when conditions permit. Never leave a fire unattended. Dispose of cigarettes in ash containers — not on the ground.',
  },
  {
    title: 'Sewage & dump',
    body: 'Use dump stations or sewer connections as directed. No dumping of gray or black water on the ground. Keep hoses sealed and free of leaks.',
  },
  {
    title: 'Respect the park',
    body: 'Please respect other guests, staff, and park property. Damage, illegal activity, or repeated policy violations may result in removal without refund.',
  },
];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function parseDate(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function buildRentalOptions(rates: RentalRatesConfig, allowed: RentalType[] = [...ALL_RENTAL_TYPES]) {
  const options = [
    {
      type: 'daily' as const,
      label: 'Daily + tax',
      price: formatDailyRateDescription(rates),
      detail: `Today (${dailyRateLabel()}): ${formatCurrency(getDailyRentForDate(new Date(), rates))}`,
      icon: Sun,
    },
    {
      type: 'weekly' as const,
      label: 'Weekly + tax',
      price: formatCurrency(rates.weekly),
      detail: 'Choose this for any stays over 7 days',
      icon: Clock,
    },
    {
      type: 'monthly' as const,
      label: 'Monthly',
      price: formatCurrency(rates.monthly),
      detail: 'Choose this for stays over 30 days',
      icon: Home,
    },
  ];
  return options.filter(o => allowed.includes(o.type));
}

function phoneHref(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits ? `tel:${digits}` : '#';
}

export function PublicWebsite({
  photos: initialPhotos,
  availableSpots: initialAvailable,
  contact = DEFAULT_CONTACT,
  onBack,
}: {
  photos: Photo[];
  /** @deprecated unused — availability loads from public API only */
  tenants?: unknown;
  availableSpots: number;
  contact?: ParkContact;
  /** When omitted (live public site), hide back-to-dashboard control */
  onBack?: () => void;
}) {
  const [selectedRental, setSelectedRental] = useState<RentalType | null>(null);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [availableSpots, setAvailableSpots] = useState(initialAvailable);
  /** Anonymized reserved/occupied ranges for calendar greying */
  const [siteBlocks, setSiteBlocks] = useState<
    Array<{ slotId: string; siteNumber: number; start: string; end: string }>
  >([]);
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [bookingStep, setBookingStep] = useState<BookingStep>('browse');
  /**
   * Locked site for dates → contact → payment.
   * Availability polls re-filter the site list by date; without this lock the
   * selected site can vanish and checkout never opens.
   */
  const [bookingSite, setBookingSite] = useState<BookingSite | null>(null);
  const [bookingContact, setBookingContact] = useState<BookingContactInfo | null>(null);
  const [bookingEmailSent, setBookingEmailSent] = useState(false);
  const [dateConflict, setDateConflict] = useState(false);
  const [contactInfo, setContactInfo] = useState<ParkContact>(contact);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<CustomerComment[]>([]);
  const [commentName, setCommentName] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentRating, setCommentRating] = useState(5);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [commentSuccess, setCommentSuccess] = useState(false);
  const [rates, setRates] = useState<ActiveRates>({
    ...DEFAULT_RENTAL_RATES,
    allowedRentalTypes: [...ALL_RENTAL_TYPES],
  });
  const [siteTab, setSiteTab] = useState<SiteTab>('home');
  const [lightbox, setLightbox] = useState<{ url: string; isVideo: boolean; caption?: string } | null>(null);
  const checkInRef = useRef(checkIn);
  const checkOutRef = useRef(checkOut);
  const bookingStepRef = useRef(bookingStep);
  const bookingSiteRef = useRef(bookingSite);
  const siteTabRef = useRef(siteTab);
  checkInRef.current = checkIn;
  checkOutRef.current = checkOut;
  bookingStepRef.current = bookingStep;
  bookingSiteRef.current = bookingSite;
  siteTabRef.current = siteTab;
  const rentalOptions = buildRentalOptions(rates, rates.allowedRentalTypes);
  const isVideoMedia = (p: Photo) =>
    p.mediaType === 'video'
    || /\.(mp4|webm|ogg|mov)(\?|$)/i.test(p.url || '');
  const imagePhotos = photos.filter(p => !isVideoMedia(p));
  /** Public gallery: published photos and videos */
  const photoGallery = photos;
  const videoCount = photos.filter(isVideoMedia).length;
  const coverPhoto =
    imagePhotos[0]?.url
    || 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=2000';
  const businessName =
    (contactInfo.businessName || DEFAULT_CONTACT.businessName || 'Pine Flats RV Park').trim();
  const logoSrc = (contactInfo.logoUrl || DEFAULT_CONTACT.logoUrl || '/logo.png').trim() || '/logo.png';
  const aboutText =
    (contactInfo.about || DEFAULT_CONTACT.about || '').trim();

  const fetchOpts: RequestInit = {
    headers: PUBLIC_HEADERS,
    cache: 'no-store',
  };

  const loadComments = () => {
    fetch('/api/comments', fetchOpts)
      .then(res => (res.ok ? res.json() : []))
      .then((data: CustomerComment[]) => setComments(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const availabilityQueryFrom = useCallback((ci: string | null, co: string | null) => {
    const params = new URLSearchParams();
    if (ci && co && co > ci) {
      params.set('checkIn', ci);
      params.set('checkOut', co);
    }
    const q = params.toString();
    return q ? `?${q}` : '';
  }, []);

  const applyAvailability = useCallback((data: {
    available?: number;
    slots?: Slot[];
    blocks?: Array<{ slotId: string; siteNumber: number; start: string; end: string }>;
  }) => {
    setAvailableSpots(data.available ?? 0);
    const slots = (data.slots ?? []) as Slot[];
    setAvailableSlots(slots);
    if (Array.isArray(data.blocks)) setSiteBlocks(data.blocks);

    const lockedId = bookingSiteRef.current?.id ?? null;
    const onDatesOrCheckout =
      bookingStepRef.current !== 'browse' || siteTabRef.current === 'dates';
    const hasDates = !!(checkInRef.current && checkOutRef.current);

    // Never clear the locked site on the dates/checkout pages — that made the
    // page look frozen (calendar wiped / Book did nothing).
    if (lockedId && onDatesOrCheckout) {
      const stillOpen = slots.some(s => s.id === lockedId);
      setSelectedSiteId(lockedId);
      setDateConflict(hasDates && !stillOpen);
      return;
    }

    setSelectedSiteId(prev => (prev && slots.some(s => s.id === prev) ? prev : null));
    setDateConflict(false);
  }, []);

  const refreshAvailability = useCallback(() => {
    const q = availabilityQueryFrom(checkInRef.current, checkOutRef.current);
    fetch(`/api/public/availability${q}`, fetchOpts)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data) return;
        applyAvailability(data);
      })
      .catch(() => {});
  }, [availabilityQueryFrom, applyAvailability]);

  const loadPublicSite = useCallback(() => {
    const q = availabilityQueryFrom(checkInRef.current, checkOutRef.current);
    fetch(`/api/public/site${q}`, fetchOpts)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data) return;
        if (data.contact) setContactInfo(data.contact);
        if (data.photos) setPhotos(data.photos);
        if (data.availability) {
          applyAvailability(data.availability);
        }
      })
      .catch(() => {});
  }, [availabilityQueryFrom, applyAvailability]);

  useEffect(() => {
    // Public site bundle only — no tenants, customers, or private slot contact data
    loadPublicSite();
    const applyRates = (active: ActiveRates) => {
      setRates(active);
      setSelectedRental(prev => {
        if (prev && active.allowedRentalTypes.includes(prev)) return prev;
        return active.allowedRentalTypes.length === 1 ? active.allowedRentalTypes[0] : null;
      });
    };
    fetchActiveRates({ force: true }).then(applyRates);
    const unsubRates = subscribeActiveRates(() => {
      // Do not wipe rental type mid-checkout
      if (bookingStepRef.current !== 'browse') return;
      fetchActiveRates({ force: true }).then(applyRates);
    });
    // Public page also refreshes rates when tab is focused (admin may have changed them)
    const refreshRatesOnFocus = () => {
      if (bookingStepRef.current !== 'browse') return;
      fetchActiveRates({ force: true }).then(applyRates);
    };
    window.addEventListener('focus', refreshRatesOnFocus);
    loadComments();

    // Keep space availability in sync after website/phone bookings (any device).
    // Skip polling on the dates/checkout screens so refreshes cannot fight the UI.
    const poll = window.setInterval(() => {
      if (bookingStepRef.current !== 'browse') return;
      if (siteTabRef.current === 'dates') return;
      refreshAvailability();
    }, 5000);
    const onFocus = () => {
      if (bookingStepRef.current !== 'browse') return;
      if (siteTabRef.current === 'dates') return;
      refreshAvailability();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (bookingStepRef.current !== 'browse') return;
      if (siteTabRef.current === 'dates') return;
      refreshAvailability();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('focus', refreshRatesOnFocus);
      document.removeEventListener('visibilitychange', onVisible);
      unsubRates();
    };
  }, [loadPublicSite, refreshAvailability]);

  // When guests pick dates on the book list, re-filter sites.
  // On the dates page we only refresh to update conflict state — site stays locked.
  useEffect(() => {
    if (bookingStep !== 'browse') return;
    refreshAvailability();
  }, [checkIn, checkOut, bookingStep, refreshAvailability]);

  const submitComment = async (e: FormEvent) => {
    e.preventDefault();
    setCommentError('');
    setCommentSuccess(false);
    if (!commentName.trim() || !commentText.trim()) {
      setCommentError('Please enter your name and a comment.');
      return;
    }
    setCommentSubmitting(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { ...PUBLIC_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: commentName.trim(),
          comment: commentText.trim(),
          rating: commentRating,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCommentError(data.error || 'Could not post comment. Try again.');
        return;
      }
      const created = await res.json();
      setComments(prev => [created, ...prev]);
      setCommentName('');
      setCommentText('');
      setCommentRating(5);
      setCommentSuccess(true);
      setTimeout(() => setCommentSuccess(false), 3000);
    } catch {
      setCommentError('Could not post comment. Try again.');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const selectedOption = rentalOptions.find(o => o.type === selectedRental);
  const selectedSiteFromList = availableSlots.find(s => s.id === selectedSiteId) ?? null;
  /** Prefer locked dates/checkout site so polls cannot blank the calendar page */
  const selectedSite =
    bookingSite
      ? {
          id: bookingSite.id,
          label:
            availableSlots.find(s => s.id === bookingSite.id)?.label || bookingSite.label,
          imageUrl:
            availableSlots.find(s => s.id === bookingSite.id)?.imageUrl || bookingSite.imageUrl,
        }
      : selectedSiteFromList;
  const canBook =
    !!selectedRental
    && !!checkIn
    && !!checkOut
    && !!selectedSiteId
    && !!selectedSite
    && !dateConflict;

  const bookButtonLabel = !selectedRental
    ? 'Select a Rental Type Above'
    : !selectedSiteId
      ? 'Select a Site Below'
      : !checkIn || !checkOut
        ? 'Select Dates Below'
        : dateConflict
          ? 'Dates unavailable — pick other nights'
          : `Book ${selectedOption?.label} Stay · ${selectedSite?.label}`;

  const resetBrowseSelection = () => {
    setBookingStep('browse');
    setBookingSite(null);
    setBookingContact(null);
    setBookingEmailSent(false);
    setSelectedSiteId(null);
    setCheckIn(null);
    setCheckOut(null);
    setDateConflict(false);
    setSiteTab('book');
  };

  const startBooking = () => {
    if (!selectedRental || !checkIn || !checkOut) return;
    if (dateConflict) return;
    const id = selectedSiteId || bookingSite?.id;
    if (!id) return;
    const fromList = availableSlots.find(s => s.id === id);
    const label = fromList?.label || bookingSite?.label;
    if (!label) return;
    // Always proceed with the locked snapshot — do not depend on the filtered list
    setDateConflict(false);
    setBookingSite({
      id,
      label,
      imageUrl: fromList?.imageUrl || bookingSite?.imageUrl,
    });
    setSelectedSiteId(id);
    setBookingStep('contact');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Checkout steps: require locked bookingSite so a poll cannot unmount payment
  if (bookingStep === 'contact' && selectedRental && bookingSite && checkIn && checkOut) {
    return (
      <BookingContactPage
        slotId={bookingSite.id}
        siteLabel={bookingSite.label}
        rentalLabel={selectedOption?.label ?? selectedRental}
        rentalType={selectedRental}
        checkIn={checkIn}
        checkOut={checkOut}
        rates={rates}
        onBack={() => {
          // Keep locked site + dates so calendar page still works after Back
          setBookingStep('browse');
          setSiteTab('dates');
        }}
        onContinue={contact => {
          setBookingContact(contact);
          setBookingStep('payment');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (
    bookingStep === 'payment' &&
    selectedRental &&
    bookingSite &&
    checkIn &&
    checkOut &&
    bookingContact
  ) {
    return (
      <BookingPaymentPage
        slotId={bookingSite.id}
        siteLabel={bookingSite.label}
        rentalLabel={selectedOption?.label ?? selectedRental}
        rentalType={selectedRental}
        checkIn={checkIn}
        checkOut={checkOut}
        contact={bookingContact}
        rates={rates}
        onBack={() => setBookingStep('contact')}
        onComplete={(result) => {
          setBookingEmailSent(!!result?.emailSent);
          setBookingStep('confirmed');
          setAvailableSlots(prev => prev.filter(s => s.id !== bookingSite.id));
          setAvailableSpots(n => Math.max(0, n - 1));
          refreshAvailability();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  // Defensive: step stuck without required data — recover instead of blanking to browse mid-flow
  if (bookingStep === 'payment' || bookingStep === 'contact') {
    return (
      <div className="min-h-screen bg-[#F7F3F0] font-sans text-[#3D3730] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-[32px] border border-[#E2D9D0] p-8 shadow-sm text-center space-y-4">
          <h1 className="text-2xl font-serif">Checkout interrupted</h1>
          <p className="text-sm text-[#5A6355]">
            Your payment page could not load completely. Your site may still be held — contact the
            park if you already submitted details, or start the booking again.
          </p>
          <button
            type="button"
            onClick={resetBrowseSelection}
            className="w-full bg-[#C29474] text-white px-6 py-3 rounded-xl font-semibold hover:bg-[#A87A5C] transition"
          >
            Back to availability
          </button>
        </div>
      </div>
    );
  }

  if (bookingStep === 'confirmed' && bookingSite && bookingContact) {
    return (
      <div className="min-h-screen bg-[#F7F3F0] font-sans text-[#3D3730] flex items-center justify-center px-4">
        <div className="max-w-lg w-full bg-white rounded-[32px] border border-[#E2D9D0] p-8 shadow-sm text-center">
          <div className="w-16 h-16 bg-[#E8F0E8] rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-[#3D5A3D]" />
          </div>
          <h1 className="text-3xl font-serif mb-3">Reservation Confirmed!</h1>
          <p className="text-sm text-[#5A6355] mb-6">
            Thank you, <strong>{bookingContact.contactName}</strong>. Your stay at{' '}
            <strong>{bookingSite.label}</strong> is reserved.
            {bookingEmailSent ? (
              <> A receipt has been emailed to <strong>{bookingContact.contactEmail}</strong> and to Pine Flats.</>
            ) : (
              <> A receipt will be sent to <strong>{bookingContact.contactEmail}</strong> and Pine Flats.</>
            )}
          </p>
          <button
            type="button"
            onClick={resetBrowseSelection}
            className="w-full bg-[#C29474] text-white px-6 py-3 rounded-xl font-semibold hover:bg-[#A87A5C] transition"
          >
            Book Another Stay
          </button>
        </div>
      </div>
    );
  }

  /** Scroll window + any overflow container to the top (instant — reliable on page change) */
  const scrollPageToTop = useCallback(() => {
    const jump = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      // Root layout uses overflow-y-auto — scroll that node too
      const root = document.getElementById('public-site-root');
      if (root) root.scrollTop = 0;
      const anchor = document.getElementById('calendar-page-top');
      if (anchor) {
        anchor.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    };
    jump();
    requestAnimationFrame(() => {
      jump();
      requestAnimationFrame(jump);
    });
    // One more pass after layout paints (images/headers)
    window.setTimeout(jump, 50);
    window.setTimeout(jump, 150);
  }, []);

  const goTab = (tab: SiteTab) => {
    setSiteTab(tab);
    setLightbox(null);
    scrollPageToTop();
  };

  /** After picking a site, open the calendar page for that site */
  const selectSiteAndOpenCalendar = (slotId: string) => {
    const slot = availableSlots.find(s => s.id === slotId);
    setSelectedSiteId(slotId);
    setCheckIn(null);
    setCheckOut(null);
    setDateConflict(false);
    // Lock immediately so the first date-filtered poll cannot wipe the pick
    setBookingSite({
      id: slotId,
      label: slot?.label || `Site`,
      imageUrl: slot?.imageUrl,
    });
    setSiteTab('dates');
    setLightbox(null);
    scrollPageToTop();
  };

  // Whenever calendar page opens, force top of page (after React paints)
  useEffect(() => {
    if (siteTab !== 'dates') return;
    scrollPageToTop();
  }, [siteTab, selectedSiteId, scrollPageToTop]);

  return (
    <div
      id="public-site-root"
      className="min-h-screen bg-white font-sans text-gray-800 flex flex-col relative w-full overflow-x-hidden overflow-y-auto pb-20 md:pb-0"
    >
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-[#E2D9D0] shadow-sm">
        <div className="flex items-center justify-between gap-2 px-3 py-2 safe-top">
          <button
            type="button"
            onClick={() => goTab('home')}
            className="flex items-center min-w-0 rounded-xl border border-[#E2D9D0] bg-white p-1 shadow-sm"
            aria-label={`${businessName} home`}
          >
            <img
              src={logoSrc}
              alt={businessName}
              className="h-11 w-auto max-w-[9.5rem] object-contain rounded-lg bg-white shrink-0"
            />
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            {contactInfo.phone && (
              <a
                href={phoneHref(contactInfo.phone)}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-[#5A6355] text-white shadow-sm"
                aria-label={`Call ${contactInfo.phone}`}
              >
                <Phone className="w-4 h-4" />
              </a>
            )}
            {contactInfo.email && (
              <a
                href={`mailto:${contactInfo.email}`}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-[#5A6355] text-white shadow-sm"
                aria-label={`Email ${contactInfo.email}`}
              >
                <Mail className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              onClick={() => setCommentsOpen(open => !open)}
              className={`relative flex items-center justify-center w-10 h-10 rounded-full shadow-sm ${
                commentsOpen ? 'bg-[#C29474] text-white' : 'bg-[#5A6355] text-white'
              }`}
              aria-expanded={commentsOpen}
              aria-label="Customer comments"
            >
              <MessageSquare className="w-4 h-4" />
              {comments.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-0.5 rounded-full bg-white text-[#5A6355] text-[9px] font-bold flex items-center justify-center">
                  {comments.length > 9 ? '9+' : comments.length}
                </span>
              )}
            </button>
          </div>
        </div>
        {onBack && (
          <button
            onClick={onBack}
            className="w-full flex items-center justify-center gap-2 bg-[#5A6355] text-white px-3 py-2 text-xs font-medium"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Return to Dashboard
          </button>
        )}
      </header>

      {/* Desktop top: nav left + logo center + contact right */}
      <div className="hidden md:block">
        <div className="fixed top-4 left-4 z-50 flex flex-col items-start gap-2">
          <nav
            className="flex items-center gap-1 bg-white/95 backdrop-blur-md border border-[#E2D9D0] rounded-full p-1 shadow-lg"
            aria-label="Website sections"
          >
            <button
              type="button"
              onClick={() => goTab('home')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition ${
                siteTab === 'home'
                  ? 'bg-[#5A6355] text-white shadow-sm'
                  : 'text-[#5A6355] hover:bg-[#F7F3F0]'
              }`}
            >
              <Home className="w-4 h-4 shrink-0" />
              Home
            </button>
            <button
              type="button"
              onClick={() => goTab('book')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition ${
                siteTab === 'book' || siteTab === 'dates'
                  ? 'bg-[#C29474] text-white shadow-sm'
                  : 'text-[#5A6355] hover:bg-[#F7F3F0]'
              }`}
            >
              <Calendar className="w-4 h-4 shrink-0" />
              Book
            </button>
            <button
              type="button"
              onClick={() => goTab('photos')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition ${
                siteTab === 'photos'
                  ? 'bg-[#C29474] text-white shadow-sm'
                  : 'text-[#5A6355] hover:bg-[#F7F3F0]'
              }`}
            >
              <Images className="w-4 h-4 shrink-0" />
              Photos
              {photoGallery.length > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center ${
                    siteTab === 'photos' ? 'bg-white/25' : 'bg-[#EDE7E1] text-[#5A6355]'
                  }`}
                >
                  {photoGallery.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => goTab('policy')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition ${
                siteTab === 'policy'
                  ? 'bg-[#5A6355] text-white shadow-sm'
                  : 'text-[#5A6355] hover:bg-[#F7F3F0]'
              }`}
            >
              <ScrollText className="w-4 h-4 shrink-0" />
              Policy
            </button>
          </nav>
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2 rounded-full shadow-lg hover:bg-[#3D3730] transition border border-[#E2D9D0]"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">Return to Dashboard</span>
            </button>
          )}
        </div>
      </div>

      <div className="fixed top-auto bottom-[4.75rem] right-3 left-3 md:top-4 md:bottom-auto md:left-auto md:right-4 z-50 flex flex-col items-stretch md:items-end gap-2 max-w-none md:max-w-[min(100vw-2rem,22rem)] pointer-events-none">
        <div className="hidden md:flex flex-row items-center gap-2 flex-wrap justify-end pointer-events-auto">
          {contactInfo.phone && (
            <a
              href={phoneHref(contactInfo.phone)}
              className="flex items-center gap-2 bg-[#5A6355]/95 backdrop-blur-md border border-[#E2D9D0] text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg hover:bg-[#3D3730] transition"
            >
              <Phone className="w-4 h-4 shrink-0" />
              <span>{contactInfo.phone}</span>
            </a>
          )}
          {contactInfo.email && (
            <a
              href={`mailto:${contactInfo.email}`}
              className="flex items-center gap-2 bg-[#5A6355]/95 backdrop-blur-md border border-[#E2D9D0] text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg hover:bg-[#3D3730] transition"
            >
              <Mail className="w-4 h-4 shrink-0" />
              <span className="max-w-[200px] truncate">{contactInfo.email}</span>
            </a>
          )}
          <button
            type="button"
            onClick={() => setCommentsOpen(open => !open)}
            className={`flex items-center gap-2 backdrop-blur-md border px-4 py-2 rounded-full text-sm font-medium shadow-lg transition ${
              commentsOpen
                ? 'bg-[#C29474] border-[#C29474] text-white'
                : 'bg-[#5A6355]/95 border-[#E2D9D0] text-white hover:bg-[#3D3730]'
            }`}
            aria-expanded={commentsOpen}
            aria-label="Customer comments"
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>Comments</span>
            {comments.length > 0 && (
              <span className="bg-white/25 text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                {comments.length}
              </span>
            )}
          </button>
        </div>

        {commentsOpen && (
          <div className="pointer-events-auto w-full md:w-[22rem] max-h-[min(70vh,28rem)] bg-white/98 backdrop-blur-md border border-[#E2D9D0] rounded-2xl shadow-2xl overflow-hidden text-[#3D3730] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2D9D0] bg-[#F7F3F0]">
              <div>
                <h3 className="text-sm font-serif font-semibold">Guest Comments</h3>
                <p className="text-[11px] text-[#5A6355]">Share your experience at Pine Flats</p>
              </div>
              <button
                type="button"
                onClick={() => setCommentsOpen(false)}
                className="p-1.5 rounded-full hover:bg-[#E2D9D0] transition"
                aria-label="Close comments"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 max-h-40 md:max-h-48 overflow-y-auto px-4 py-3 space-y-3 bg-white overscroll-contain">
              {comments.length === 0 ? (
                <p className="text-xs text-[#5A6355] text-center py-4">
                  No comments yet — be the first to leave one!
                </p>
              ) : (
                comments.slice(0, 20).map(c => (
                  <div key={c.id} className="rounded-xl border border-[#F0EBE6] bg-[#FBF9F7] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold truncate">{c.name}</span>
                      {c.rating != null && (
                        <span className="flex items-center gap-0.5 shrink-0">
                          {Array.from({ length: 5 }, (_, i) => (
                            <Star
                              key={i}
                              className={`w-3 h-3 ${i < (c.rating ?? 0) ? 'text-[#C29474] fill-[#C29474]' : 'text-[#E2D9D0]'}`}
                            />
                          ))}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#5A6355] leading-relaxed whitespace-pre-wrap">{c.comment}</p>
                    {c.createdAt && (
                      <p className="text-[10px] text-[#A8B2A6]">
                        {new Date(c.createdAt).toLocaleDateString('en-US', {
                          month: 'numeric',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    )}
                    {c.adminReply && (
                      <div className="rounded-lg border border-[#A8B2A6]/40 bg-[#E8F0E8]/70 px-2.5 py-2 mt-1">
                        <p className="text-[10px] uppercase tracking-wider text-[#3D5A3D] font-semibold mb-0.5">
                          {c.adminReplyName || 'Pine Flats'}
                          {c.adminReplyAt
                            ? ` · ${new Date(c.adminReplyAt).toLocaleDateString('en-US', {
                                month: 'numeric',
                                day: 'numeric',
                                year: 'numeric',
                              })}`
                            : ''}
                        </p>
                        <p className="text-xs text-[#3D3730] leading-relaxed whitespace-pre-wrap">
                          {c.adminReply}
                        </p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <form onSubmit={submitComment} className="px-4 py-3 border-t border-[#E2D9D0] bg-[#F7F3F0] space-y-2.5">
              <input
                type="text"
                value={commentName}
                onChange={e => setCommentName(e.target.value)}
                placeholder="Your name"
                maxLength={80}
                className="w-full rounded-xl border border-[#E2D9D0] bg-white px-3 py-2 text-sm outline-none focus:border-[#C29474] focus:ring-1 focus:ring-[#C29474]/40"
              />
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Write a comment..."
                rows={3}
                maxLength={1000}
                className="w-full rounded-xl border border-[#E2D9D0] bg-white px-3 py-2 text-sm outline-none resize-none focus:border-[#C29474] focus:ring-1 focus:ring-[#C29474]/40"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1" role="group" aria-label="Rating">
                  {Array.from({ length: 5 }, (_, i) => {
                    const value = i + 1;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setCommentRating(value)}
                        className="p-0.5"
                        aria-label={`${value} star${value === 1 ? '' : 's'}`}
                      >
                        <Star
                          className={`w-4 h-4 transition ${
                            value <= commentRating ? 'text-[#C29474] fill-[#C29474]' : 'text-[#E2D9D0]'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
                <button
                  type="submit"
                  disabled={commentSubmitting}
                  className="flex items-center gap-1.5 bg-[#C29474] text-white px-3 py-1.5 rounded-full text-xs font-semibold hover:bg-[#A87A5C] transition disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {commentSubmitting ? 'Posting…' : 'Post'}
                </button>
              </div>
              {commentError && <p className="text-[11px] text-red-600">{commentError}</p>}
              {commentSuccess && <p className="text-[11px] text-[#3D5A3D]">Thanks! Your comment was posted.</p>}
            </form>
          </div>
        )}
      </div>

      {siteTab === 'photos' ? (
        <section className="flex-1 pt-4 md:pt-40 pb-8 md:pb-16 px-3 sm:px-4 bg-[#F7F3F0] min-h-screen">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-6 md:mb-10">
              <div className="inline-flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-[#EDE7E1] mb-3 md:mb-4">
                <ImageIcon className="w-6 h-6 md:w-7 md:h-7 text-[#5A6355]" />
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-serif text-[#3D3730] mb-2">Photos &amp; Video</h1>
              <p className="text-sm text-[#5A6355] max-w-xl mx-auto px-1">
                A look at life at Pine Flats — sites, beautiful scenery
                {videoCount > 0 ? ', video tours,' : ','} and our community.
              </p>
            </div>

            {photoGallery.length === 0 ? (
              <div className="bg-white rounded-2xl md:rounded-[32px] border border-dashed border-[#E2D9D0] p-8 md:p-12 text-center text-sm text-[#5A6355]">
                No photos or videos have been published yet. Check back soon.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-5">
                {photoGallery.map((item) => {
                  const video = isVideoMedia(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setLightbox({
                        url: item.url,
                        isVideo: video,
                        caption: item.caption,
                      })}
                      className="group text-left rounded-2xl overflow-hidden bg-white shadow-sm border border-[#E2D9D0] hover:shadow-md hover:-translate-y-0.5 transition"
                    >
                      <div className="aspect-[4/3] w-full bg-[#EDE7E1] overflow-hidden relative">
                        {video ? (
                          <>
                            <video
                              src={item.url}
                              muted
                              playsInline
                              preload="metadata"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/35 transition">
                              <span className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                                <Play className="w-5 h-5 text-[#5A6355] ml-0.5" fill="currentColor" />
                              </span>
                            </span>
                          </>
                        ) : (
                          <img
                            src={item.url}
                            alt={item.caption || 'Pine Flats photo'}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        )}
                      </div>
                      {item.caption ? (
                        <p className="px-4 py-3 text-sm text-[#5A6355]">
                          {video && <span className="font-semibold text-[#C29474] mr-1">Video ·</span>}
                          {item.caption}
                        </p>
                      ) : (
                        <p className="px-4 py-3 text-xs text-[#A8B2A6]">
                          {video ? 'Park Video' : 'Pine Flats RV Park'}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-12 text-center">
              <button
                type="button"
                onClick={() => goTab('home')}
                className="inline-flex items-center gap-2 bg-[#C29474] text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-lg hover:bg-[#A87A5C] transition"
              >
                <Home className="w-4 h-4" />
                Back to Home
              </button>
            </div>
          </div>

          {lightbox && (
            <div
              className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-label={lightbox.isVideo ? 'Video preview' : 'Photo preview'}
              onClick={() => setLightbox(null)}
            >
              <button
                type="button"
                className="absolute top-4 right-4 p-2 rounded-full bg-white/15 text-white hover:bg-white/25 transition"
                onClick={() => setLightbox(null)}
                aria-label="Close"
              >
                <X className="w-6 h-6" />
              </button>
              {lightbox.isVideo ? (
                <video
                  src={lightbox.url}
                  controls
                  autoPlay
                  playsInline
                  className="max-w-full max-h-[90vh] rounded-lg shadow-2xl bg-black"
                  onClick={e => e.stopPropagation()}
                >
                  Your browser does not support this video.
                </video>
              ) : (
                <img
                  src={lightbox.url}
                  alt={lightbox.caption || 'Enlarged park photo'}
                  className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                  onClick={e => e.stopPropagation()}
                />
              )}
            </div>
          )}
        </section>
      ) : siteTab === 'policy' ? (
        <section className="flex-1 pt-4 md:pt-40 pb-8 md:pb-16 px-3 sm:px-4 bg-[#F7F3F0] min-h-screen">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-6 md:mb-10">
              <div className="inline-flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-[#EDE7E1] mb-3 md:mb-4">
                <ScrollText className="w-6 h-6 md:w-7 md:h-7 text-[#5A6355]" />
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-serif text-[#3D3730] mb-2">Park Policy</h1>
              <p className="text-sm text-[#5A6355] max-w-xl mx-auto px-1">
                Please review these guidelines so everyone can enjoy a safe, peaceful stay at Pine Flats.
              </p>
            </div>

            <div className="space-y-4">
              {PARK_POLICIES.map((item, index) => (
                <article
                  key={item.title}
                  className="bg-white rounded-2xl border border-[#E2D9D0] shadow-sm p-5 sm:p-6"
                >
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 w-8 h-8 rounded-full bg-[#EDE7E1] text-[#5A6355] text-xs font-bold flex items-center justify-center">
                      {index + 1}
                    </span>
                    <div>
                      <h2 className="text-lg font-serif text-[#3D3730] mb-1.5">{item.title}</h2>
                      <p className="text-sm text-[#5A6355] leading-relaxed">{item.body}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <p className="mt-8 text-center text-xs text-[#5A6355]">
              Questions? Contact the office
              {contactInfo.phone ? (
                <>
                  {' '}at{' '}
                  <a href={phoneHref(contactInfo.phone)} className="text-[#C29474] font-semibold hover:underline">
                    {contactInfo.phone}
                  </a>
                </>
              ) : null}
              {contactInfo.email ? (
                <>
                  {contactInfo.phone ? ' or ' : ' at '}
                  <a href={`mailto:${contactInfo.email}`} className="text-[#C29474] font-semibold hover:underline">
                    {contactInfo.email}
                  </a>
                </>
              ) : null}
              .
            </p>

            <div className="mt-10 text-center">
              <button
                type="button"
                onClick={() => goTab('home')}
                className="inline-flex items-center gap-2 bg-[#C29474] text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-lg hover:bg-[#A87A5C] transition"
              >
                <Home className="w-4 h-4" />
                Back to Home
              </button>
            </div>
          </div>
        </section>
      ) : siteTab === 'dates' ? (
        <>
          {/* Calendar page — opens after customer picks a site */}
          <section
            id="calendar-page-top"
            className="pt-4 md:pt-28 pb-10 md:pb-16 px-3 sm:px-4 bg-[#F7F3F0] min-h-screen scroll-mt-0"
          >
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => goTab('book')}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[#5A6355] hover:text-[#3D3730] transition"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Change site
                </button>
                <p className="text-xs text-[#5A6355]">
                  {selectedSite?.label || 'Select dates'}
                </p>
              </div>

              {selectedSite ? (
                <div className="bg-white border border-[#E2D9D0] rounded-2xl md:rounded-3xl overflow-hidden shadow-sm">
                  {'imageUrl' in selectedSite && selectedSite.imageUrl ? (
                    <div className="aspect-[21/9] w-full bg-[#EDE7E1]">
                      <img
                        src={selectedSite.imageUrl as string}
                        alt={selectedSite.label}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : null}
                  <div className="p-5 sm:p-6 text-center border-b border-[#E2D9D0]">
                    <p className="text-[11px] uppercase tracking-widest text-[#5A6355] font-semibold mb-1">
                      Your site
                    </p>
                    <h1 className="text-2xl sm:text-3xl font-serif text-[#3D3730]">
                      {selectedSite.label}
                    </h1>
                    {selectedOption && (
                      <p className="text-sm text-[#5A6355] mt-2">
                        {selectedOption.label}
                        {selectedOption.type !== 'daily' && <> · {selectedOption.price}</>}
                      </p>
                    )}
                    {!selectedRental && (
                      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-3 inline-block">
                        Tip: pick a rental type on the previous page for accurate rates.
                      </p>
                    )}
                  </div>

                  <div className="p-4 sm:p-6">
                    <h2 className="text-xl font-serif text-[#3D3730] text-center mb-2">
                      Choose your dates
                    </h2>
                    <p className="text-sm text-[#5A6355] text-center mb-6">
                      Select check-in and check-out on the calendar below.
                    </p>
                    <PublicBookingCalendar
                      selectedRental={selectedRental}
                      availableSpots={availableSpots}
                      selectedSiteLabel={selectedSite.label}
                      selectedSiteId={selectedSite.id}
                      blockedRanges={siteBlocks
                        .filter(b => b.slotId === selectedSite.id)
                        .map(b => ({ start: b.start, end: b.end }))}
                      checkIn={checkIn}
                      checkOut={checkOut}
                      rates={rates}
                      onDatesChange={(start, end) => {
                        setCheckIn(start);
                        setCheckOut(end);
                      }}
                    />

                    {checkIn && checkOut && (
                      <p className="text-sm text-center text-[#5A6355] mt-4">
                        {parseDate(checkIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' – '}
                        {parseDate(checkOut).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}

                    {dateConflict && checkIn && checkOut && (
                      <p className="mt-4 text-sm text-center text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                        Those dates are not available for {selectedSite?.label || 'this site'}.
                        Pick different nights on the calendar, or choose another site.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={startBooking}
                      disabled={!canBook}
                      className="mt-6 w-full bg-[#C29474] text-white px-6 py-4 rounded-xl text-lg font-semibold shadow-lg hover:-translate-y-0.5 transition duration-300 flex items-center justify-center gap-2 disabled:opacity-40 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                      {dateConflict
                        ? 'Dates unavailable — pick other nights'
                        : bookButtonLabel}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-[#E2D9D0] rounded-3xl p-8 text-center shadow-sm">
                  <p className="text-sm text-[#5A6355] mb-4">No site selected yet.</p>
                  <button
                    type="button"
                    onClick={() => goTab('book')}
                    className="inline-flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold"
                  >
                    Choose a site
                  </button>
                </div>
              )}
            </div>
          </section>
        </>
      ) : siteTab === 'book' ? (
        <>
          {/* Booking page — rental type + site grid (calendar opens on site select) */}
          <section className="pt-4 md:pt-28 pb-4 px-3 sm:px-4 bg-[#F7F3F0]">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => goTab('home')}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[#5A6355] hover:text-[#3D3730] transition"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Home
                </button>
                <p className="text-xs text-[#5A6355]">
                  {availableSpots} spot{availableSpots === 1 ? '' : 's'} available
                </p>
              </div>
              <div className="bg-white border border-[#E2D9D0] rounded-2xl md:rounded-3xl p-4 sm:p-5 md:p-6 shadow-sm text-[#3D3730]">
                <h1 className="text-2xl sm:text-3xl font-serif text-center text-[#3D3730] mb-1">Book Your Stay</h1>
                <p className="text-[11px] sm:text-sm uppercase tracking-widest text-[#5A6355] mb-4 text-center font-semibold">
                  1 · Choose Your Rental
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-2">
                  {rentalOptions.map(option => {
                    const Icon = option.icon;
                    const isSelected = selectedRental === option.type;
                    return (
                      <button
                        key={option.type}
                        type="button"
                        onClick={() => setSelectedRental(option.type)}
                        className={`text-left p-3 sm:p-4 rounded-xl border-2 transition-all duration-300 active:scale-[0.98] ${
                          isSelected
                            ? 'bg-[#C29474] border-[#C29474] text-white shadow-lg ring-2 ring-[#C29474]/30'
                            : 'bg-[#FBF9F7] border-[#E2D9D0] text-[#3D3730] hover:border-[#C29474]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Icon className="w-4 h-4 opacity-80 shrink-0" />
                          <span className="text-xs sm:text-sm font-semibold uppercase tracking-wide">{option.label}</span>
                        </div>
                        <p className={`text-base sm:text-lg font-serif font-bold leading-tight ${isSelected ? 'text-white' : 'text-[#C29474]'}`}>
                          {option.type === 'daily' ? (
                            <>
                              <span className="block text-xs sm:text-sm">{formatCurrency(rates.dailyWeekday)} Sun–Thu</span>
                              <span className="block text-xs sm:text-sm">{formatCurrency(rates.dailyWeekend)} Fri–Sat</span>
                            </>
                          ) : (
                            option.price
                          )}
                        </p>
                        <p className={`text-[10px] mt-1.5 leading-snug ${isSelected ? 'text-white/85' : 'text-[#5A6355]/80'}`}>
                          {option.detail}
                        </p>
                      </button>
                    );
                  })}
                </div>
                {selectedOption && (
                  <p className="text-xs sm:text-sm mt-3 text-center text-[#5A6355]">
                    Selected: <strong className="text-[#3D3730]">{selectedOption.label}</strong>
                    {selectedOption.type !== 'daily' && <> — {selectedOption.price}</>}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="py-10 md:py-16 px-3 sm:px-4 bg-white">
            <div className="max-w-5xl mx-auto">
              <div className="text-center mb-6 md:mb-8">
                <h2 className="text-2xl sm:text-3xl font-serif text-[#3D3730] mb-2">2 · Choose Your Site</h2>
                <p className="text-sm text-[#5A6355] px-1">
                  {availableSlots.length > 0
                    ? 'Tap a site to open the calendar and pick your dates.'
                    : 'No spots are currently available. Please check back soon or call us.'}
                </p>
              </div>

              {availableSlots.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {availableSlots.map(slot => (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => selectSiteAndOpenCalendar(slot.id)}
                      className="group text-left rounded-3xl border-2 border-[#E2D9D0] bg-white overflow-hidden transition hover:-translate-y-0.5 hover:border-[#C29474] shadow-sm"
                    >
                      <div className="aspect-[4/3] w-full overflow-hidden bg-[#EDE7E1] relative">
                        {slot.imageUrl ? (
                          <img
                            src={slot.imageUrl}
                            alt={`${slot.label} photo`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#5A6355]/60">
                            <MapPin className="w-8 h-8" />
                            <span className="text-xs uppercase tracking-wider">No photo yet</span>
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex items-center gap-1.5 mb-1">
                          <MapPin className="w-4 h-4 shrink-0 text-[#5A6355]" />
                          <span className="font-serif font-bold text-base text-[#3D3730]">{slot.label}</span>
                        </div>
                        <p className="text-xs text-[#C29474] font-semibold flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          Available · tap for calendar
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bg-[#FBF9F7] rounded-3xl border border-[#E2D9D0] p-8 text-center text-sm text-[#5A6355]">
                  All 25 spots are currently occupied or reserved.
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          {/* Home — welcome only (no booking form) */}
          <section className="relative w-full overflow-hidden">
            <div className="absolute inset-0">
              <img
                src={coverPhoto}
                alt={businessName}
                className="w-full h-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-black/25" />
            </div>

            <div className="relative z-10 flex flex-col justify-center min-h-[min(80vh,760px)] sm:min-h-[min(78vh,800px)] pt-20 sm:pt-24 md:pt-28 pb-10 sm:pb-12 md:pb-16 px-3 sm:px-4">
              <div className="text-center text-white max-w-3xl mx-auto space-y-3">
                <div className="flex justify-center mb-2">
                  <div className="rounded-2xl bg-white/95 border border-white/50 shadow-xl p-3 sm:p-4">
                    <img
                      src={logoSrc}
                      alt={businessName}
                      className="h-28 w-auto sm:h-36 md:h-40 max-w-[min(90vw,20rem)] object-contain"
                    />
                  </div>
                </div>
                <h1 className="sr-only">{businessName}</h1>
                <p className="text-base sm:text-lg md:text-xl text-[#E8C4A8] font-serif italic drop-shadow-md">
                  {contactInfo.tagline || DEFAULT_CONTACT.tagline}
                </p>
                {aboutText && (
                  <p className="text-sm sm:text-base text-white/90 max-w-xl mx-auto leading-relaxed drop-shadow">
                    {aboutText}
                  </p>
                )}
                {contactInfo.address && (
                  <p className="flex items-center justify-center gap-1.5 text-sm text-white/85">
                    <MapPin className="w-4 h-4 shrink-0 opacity-80" />
                    <span>{contactInfo.address}</span>
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-white/90 pt-1">
                  {contactInfo.phone && (
                    <a href={phoneHref(contactInfo.phone)} className="inline-flex items-center gap-1.5 hover:text-white transition">
                      <Phone className="w-3.5 h-3.5" />
                      {contactInfo.phone}
                    </a>
                  )}
                  {contactInfo.email && (
                    <a href={`mailto:${contactInfo.email}`} className="inline-flex items-center gap-1.5 hover:text-white transition max-w-[16rem] truncate">
                      <Mail className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{contactInfo.email}</span>
                    </a>
                  )}
                </div>
                <p className="text-xl sm:text-2xl font-serif font-bold text-[#E8C4A8] drop-shadow-md pt-1">
                  {availableSpots} Spot{availableSpots === 1 ? '' : 's'} Available
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => goTab('book')}
                    className="inline-flex items-center gap-2 bg-[#C29474] text-white px-6 py-3 rounded-full text-sm font-semibold shadow-lg hover:bg-[#A87A5C] transition"
                  >
                    <Calendar className="w-4 h-4" />
                    Book Your Stay
                  </button>
                  <button
                    type="button"
                    onClick={() => goTab('photos')}
                    className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-md border border-white/40 text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-white/25 transition"
                  >
                    <Images className="w-4 h-4" />
                    View Photos
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="py-12 md:py-20 px-3 sm:px-4 bg-[#FBF9F7] border-t border-[#F0EBE6]">
            <div className="max-w-7xl mx-auto text-center">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#C29474] font-semibold mb-2">About the park</p>
              <h2 className="text-2xl sm:text-3xl font-serif text-[#3D3730] mb-3">Why Choose {businessName}?</h2>
              <p className="text-sm text-[#5A6355] max-w-2xl mx-auto mb-8 md:mb-12 leading-relaxed">
                {aboutText ||
                  `A peaceful 25-site RV park with beautiful scenery${contactInfo.address ? ` at ${contactInfo.address}` : ''}. Book online in minutes.`}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
                <div className="p-5 sm:p-8 bg-white rounded-2xl md:rounded-3xl border border-[#E2D9D0] shadow-sm">
                  <Map className="w-10 h-10 md:w-12 md:h-12 text-[#5A6355] mx-auto mb-3 md:mb-4 opacity-80" />
                  <h3 className="text-lg md:text-xl font-serif mb-2">Prime Location</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">Nestled in a beautiful, wooded area close to hiking trails, lakes, and local attractions.</p>
                </div>
                <div className="p-5 sm:p-8 bg-white rounded-2xl md:rounded-3xl border border-[#E2D9D0] shadow-sm">
                  <Calendar className="w-10 h-10 md:w-12 md:h-12 text-[#5A6355] mx-auto mb-3 md:mb-4 opacity-80" />
                  <h3 className="text-lg md:text-xl font-serif mb-2">Flexible Stays</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">
                    {rates.allowedRentalTypes.length === 1 && rates.allowedRentalTypes[0] === 'monthly'
                      ? 'Monthly stays with prorated partial months — pick the stay that fits your schedule.'
                      : rates.allowedRentalTypes.length === 1 && rates.allowedRentalTypes[0] === 'daily'
                        ? 'Daily stays with weekday and weekend rates — pick the nights that fit your trip.'
                        : 'Daily, weekly, or monthly — pick the stay that fits your schedule and budget.'}
                  </p>
                </div>
                <div className="p-5 sm:p-8 bg-white rounded-2xl md:rounded-3xl border border-[#E2D9D0] shadow-sm">
                  <Phone className="w-10 h-10 md:w-12 md:h-12 text-[#5A6355] mx-auto mb-3 md:mb-4 opacity-80" />
                  <h3 className="text-lg md:text-xl font-serif mb-2">Great Community</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">Join our friendly community of travelers and full-time RVers. On-site management ensures a peaceful stay.</p>
                </div>
              </div>
              <div className="mt-10">
                <button
                  type="button"
                  onClick={() => goTab('book')}
                  className="inline-flex items-center gap-2 bg-[#C29474] text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-lg hover:bg-[#A87A5C] transition"
                >
                  <Calendar className="w-4 h-4" />
                  Book Your Stay
                </button>
              </div>
            </div>
          </section>

          <section className="py-12 md:py-16 px-3 sm:px-4 bg-white border-t border-[#E2D9D0]">
            <div className="max-w-3xl mx-auto text-center space-y-4">
              <h2 className="text-2xl sm:text-3xl font-serif text-[#3D3730]">Visit &amp; Contact</h2>
              <p className="text-sm text-[#5A6355] leading-relaxed">
                Questions about sites, rates, or long-term stays? Reach the office anytime.
              </p>
              <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3 pt-2">
                {contactInfo.phone && (
                  <a
                    href={phoneHref(contactInfo.phone)}
                    className="inline-flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-[#3D3730] transition"
                  >
                    <Phone className="w-4 h-4" />
                    {contactInfo.phone}
                  </a>
                )}
                {contactInfo.email && (
                  <a
                    href={`mailto:${contactInfo.email}`}
                    className="inline-flex items-center gap-2 border border-[#E2D9D0] text-[#5A6355] px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-[#F7F3F0] transition"
                  >
                    <Mail className="w-4 h-4" />
                    {contactInfo.email}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => goTab('book')}
                  className="inline-flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-[#A87A5C] transition"
                >
                  <Calendar className="w-4 h-4" />
                  Book online
                </button>
              </div>
              {contactInfo.address && (
                <p className="text-xs text-[#8A847C] pt-2 flex items-center justify-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  {contactInfo.address}
                </p>
              )}
            </div>
          </section>

          {photoGallery.length > 0 && (
            <section className="py-12 px-4 bg-[#F7F3F0] border-t border-[#E2D9D0]">
              <div className="max-w-3xl mx-auto text-center">
                <Images className="w-10 h-10 text-[#5A6355] mx-auto mb-3 opacity-80" />
                <h2 className="text-2xl font-serif text-[#3D3730] mb-2">See Our Photos</h2>
                <p className="text-sm text-[#5A6355] mb-6">
                  Browse {photoGallery.length} photo{photoGallery.length === 1 ? '' : 's'} from the park.
                </p>
                <button
                  type="button"
                  onClick={() => goTab('photos')}
                  className="inline-flex items-center gap-2 bg-[#C29474] text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-lg hover:bg-[#A87A5C] transition"
                >
                  <Images className="w-4 h-4" />
                  Open Photos
                </button>
              </div>
            </section>
          )}
        </>
      )}

      <footer className="mt-auto bg-[#3D3730] text-gray-300 py-10 md:py-12 px-4 pb-24 md:pb-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h3 className="text-xl md:text-2xl font-serif italic text-white mb-2">{businessName}</h3>
            <p className="text-sm opacity-60">{contactInfo.tagline || DEFAULT_CONTACT.tagline}</p>
            {contactInfo.address && (
              <p className="text-xs opacity-50 mt-2">{contactInfo.address}</p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap justify-center items-center gap-3 sm:gap-6 text-sm">
            {contactInfo.email && (
              <a href={`mailto:${contactInfo.email}`} className="flex items-center gap-2 hover:text-white transition max-w-full">
                <Mail className="w-4 h-4 shrink-0" />
                <span className="truncate">{contactInfo.contactName || contactInfo.email}</span>
              </a>
            )}
            {contactInfo.phone && (
              <a href={phoneHref(contactInfo.phone)} className="flex items-center gap-2 hover:text-white transition">
                <Phone className="w-4 h-4 shrink-0" />
                {contactInfo.phone}
              </a>
            )}
            <button
              type="button"
              onClick={() => goTab('policy')}
              className="flex items-center gap-2 hover:text-white transition"
            >
              <ScrollText className="w-4 h-4" />
              Park Policy
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white/98 backdrop-blur-md border-t border-[#E2D9D0] shadow-[0_-4px_20px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]"
        aria-label="Main navigation"
      >
        <div className="grid grid-cols-4 gap-0 max-w-lg mx-auto">
          <button
            type="button"
            onClick={() => goTab('home')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] text-[11px] font-semibold transition ${
              siteTab === 'home' ? 'text-[#5A6355]' : 'text-[#8A847C]'
            }`}
          >
            <Home className={`w-5 h-5 ${siteTab === 'home' ? 'text-[#5A6355]' : ''}`} />
            Home
          </button>
          <button
            type="button"
            onClick={() => goTab('book')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] text-[11px] font-semibold transition ${
              siteTab === 'book' || siteTab === 'dates' ? 'text-[#C29474]' : 'text-[#8A847C]'
            }`}
          >
            <Calendar className={`w-5 h-5 ${siteTab === 'book' || siteTab === 'dates' ? 'text-[#C29474]' : ''}`} />
            Book
          </button>
          <button
            type="button"
            onClick={() => goTab('photos')}
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] text-[11px] font-semibold transition ${
              siteTab === 'photos' ? 'text-[#C29474]' : 'text-[#8A847C]'
            }`}
          >
            <Images className="w-5 h-5" />
            Photos
            {photoGallery.length > 0 && (
              <span className="absolute top-1.5 right-[18%] min-w-[1rem] h-4 px-1 rounded-full bg-[#C29474] text-white text-[9px] font-bold flex items-center justify-center">
                {photoGallery.length > 99 ? '99+' : photoGallery.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => goTab('policy')}
            className={`flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] text-[11px] font-semibold transition ${
              siteTab === 'policy' ? 'text-[#5A6355]' : 'text-[#8A847C]'
            }`}
          >
            <ScrollText className="w-5 h-5" />
            Policy
          </button>
        </div>
      </nav>
    </div>
  );
}