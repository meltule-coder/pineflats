import { useEffect, useState, type FormEvent } from 'react';
import { Photo, RentalType, Slot, ParkContact, BookingContactInfo, CustomerComment } from '../../types';

/** Public availability only — never includes guest/tenant contact fields */
const PUBLIC_HEADERS = { 'X-Pineflats-Client': 'public-website' };
import { DEFAULT_CONTACT } from '../../contactDefaults';
import {
  ArrowLeft, Map, Calendar, Phone, Mail, CheckCircle2, Sun, Clock, Home, MapPin,
  MessageSquare, X, Send, Star
} from 'lucide-react';
import {
  WEEKLY_RENT, MONTHLY_RENT, DAILY_RENT_WEEKDAY, DAILY_RENT_WEEKEND,
  getDailyRentForDate, dailyRateLabel, formatDailyRateDescription
} from '../../rentUtils';
import { PublicBookingCalendar } from './PublicBookingCalendar';
import { BookingContactPage } from './BookingContactPage';
import { BookingPaymentPage } from './BookingPaymentPage';

type BookingStep = 'browse' | 'contact' | 'payment' | 'confirmed';

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function parseDate(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const RENTAL_OPTIONS: {
  type: RentalType;
  label: string;
  price: string;
  detail: string;
  icon: typeof Sun;
}[] = [
  {
    type: 'daily',
    label: 'Daily',
    price: formatDailyRateDescription(),
    detail: `Today (${dailyRateLabel()}): ${formatCurrency(getDailyRentForDate())}`,
    icon: Sun,
  },
  {
    type: 'weekly',
    label: 'Weekly',
    price: formatCurrency(WEEKLY_RENT),
    detail: 'Per week · prorated over 7 nights',
    icon: Clock,
  },
  {
    type: 'monthly',
    label: 'Monthly',
    price: formatCurrency(MONTHLY_RENT),
    detail: 'Per month · $750; partial stays prorated by month length',
    icon: Home,
  },
];

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
  onBack: () => void;
}) {
  const [selectedRental, setSelectedRental] = useState<RentalType | null>(null);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [availableSpots, setAvailableSpots] = useState(initialAvailable);
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [bookingStep, setBookingStep] = useState<BookingStep>('browse');
  const [bookingContact, setBookingContact] = useState<BookingContactInfo | null>(null);
  const [contactInfo, setContactInfo] = useState<ParkContact>(contact);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<CustomerComment[]>([]);
  const [commentName, setCommentName] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentRating, setCommentRating] = useState(5);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [commentSuccess, setCommentSuccess] = useState(false);
  const imagePhotos = photos.filter(p => p.mediaType !== 'video');
  const galleryMedia = photos.filter(p => {
    // Hero uses first image; gallery shows remaining images + all videos
    if (p.mediaType === 'video') return true;
    return imagePhotos[0]?.id !== p.id;
  });
  const coverPhoto =
    imagePhotos[0]?.url
    || 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=2000';

  const loadComments = () => {
    fetch('/api/comments', { headers: PUBLIC_HEADERS })
      .then(res => (res.ok ? res.json() : []))
      .then((data: CustomerComment[]) => setComments(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  useEffect(() => {
    // Public site bundle only — no tenants, customers, or private slot contact data
    fetch('/api/public/site', { headers: PUBLIC_HEADERS })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data) return;
        if (data.contact) setContactInfo(data.contact);
        if (data.photos) setPhotos(data.photos);
        if (data.availability) {
          setAvailableSpots(data.availability.available ?? 0);
          const slots = (data.availability.slots ?? []) as Slot[];
          setAvailableSlots(slots);
          setSelectedSiteId(prev => (prev && slots.some(s => s.id === prev) ? prev : null));
        }
      })
      .catch(() => {});
    loadComments();
  }, []);

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

  const selectedOption = RENTAL_OPTIONS.find(o => o.type === selectedRental);
  const selectedSite = availableSlots.find(s => s.id === selectedSiteId) ?? null;
  const canBook = !!selectedRental && !!checkIn && !!checkOut && !!selectedSiteId;

  const refreshAvailability = () => {
    fetch('/api/public/availability', { headers: PUBLIC_HEADERS })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data) return;
        setAvailableSpots(data.available ?? 0);
        const slots = (data.slots ?? []) as Slot[];
        setAvailableSlots(slots);
        setSelectedSiteId(prev => (prev && slots.some(s => s.id === prev) ? prev : null));
      })
      .catch(() => {});
  };

  const bookButtonLabel = !selectedRental
    ? 'Select a Rental Type Above'
    : !selectedSiteId
      ? 'Select a Site Below'
      : !checkIn || !checkOut
        ? 'Select Dates Below'
        : `Book ${selectedOption?.label} Stay · ${selectedSite?.label}`;

  const startBooking = () => {
    if (!canBook || !selectedRental || !selectedSiteId || !checkIn || !checkOut) return;
    setBookingStep('contact');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (bookingStep === 'contact' && selectedRental && selectedSite && checkIn && checkOut) {
    return (
      <BookingContactPage
        slotId={selectedSite.id}
        siteLabel={selectedSite.label}
        rentalLabel={selectedOption?.label ?? selectedRental}
        rentalType={selectedRental}
        checkIn={checkIn}
        checkOut={checkOut}
        onBack={() => setBookingStep('browse')}
        onContinue={contact => {
          setBookingContact(contact);
          setBookingStep('payment');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (bookingStep === 'payment' && selectedRental && selectedSite && checkIn && checkOut && bookingContact) {
    return (
      <BookingPaymentPage
        slotId={selectedSite.id}
        siteLabel={selectedSite.label}
        rentalLabel={selectedOption?.label ?? selectedRental}
        rentalType={selectedRental}
        checkIn={checkIn}
        checkOut={checkOut}
        contact={bookingContact}
        onBack={() => setBookingStep('contact')}
        onComplete={() => {
          setBookingStep('confirmed');
          setAvailableSlots(prev => prev.filter(s => s.id !== selectedSite.id));
          setAvailableSpots(n => Math.max(0, n - 1));
          refreshAvailability();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (bookingStep === 'confirmed' && selectedSite && bookingContact) {
    return (
      <div className="min-h-screen bg-[#F7F3F0] font-sans text-[#3D3730] flex items-center justify-center px-4">
        <div className="max-w-lg w-full bg-white rounded-[32px] border border-[#E2D9D0] p-8 shadow-sm text-center">
          <div className="w-16 h-16 bg-[#E8F0E8] rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-[#3D5A3D]" />
          </div>
          <h1 className="text-3xl font-serif mb-3">Reservation Confirmed!</h1>
          <p className="text-sm text-[#5A6355] mb-6">
            Thank you, <strong>{bookingContact.contactName}</strong>. Your stay at <strong>{selectedSite.label}</strong> is reserved.
            A confirmation will be sent to <strong>{bookingContact.contactEmail}</strong>.
          </p>
          <button
            onClick={() => {
              setBookingStep('browse');
              setBookingContact(null);
              setSelectedSiteId(null);
              setCheckIn(null);
              setCheckOut(null);
            }}
            className="w-full bg-[#C29474] text-white px-6 py-3 rounded-xl font-semibold hover:bg-[#A87A5C] transition"
          >
            Book Another Stay
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white font-sans text-gray-800 flex flex-col relative w-full overflow-y-auto">
      <div className="fixed top-4 left-4 z-50 flex flex-col items-start gap-2">
        <div className="flex items-center gap-2 bg-white/95 backdrop-blur-md border border-[#E2D9D0] rounded-2xl px-3 py-2 shadow-lg">
          <img
            src="/logo.svg"
            alt="Pine Flats logo"
            className="h-12 w-12 object-contain rounded-lg"
          />
          <div className="leading-tight">
            <p className="text-sm font-serif italic font-bold text-[#5A6355]">Pine Flats</p>
            <p className="text-[9px] uppercase tracking-widest text-[#5A6355] opacity-70">RV Park</p>
          </div>
        </div>
        <button
          onClick={onBack}
          className="flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2 rounded-full shadow-lg hover:bg-[#3D3730] transition border border-[#E2D9D0]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Return to Dashboard</span>
        </button>
      </div>

      <div className="fixed top-4 right-4 z-50 flex flex-col items-end gap-2 max-w-[min(100vw-2rem,22rem)]">
        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-2 flex-wrap justify-end">
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
              <span className="max-w-[160px] truncate sm:max-w-none">{contactInfo.email}</span>
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
          <div className="w-full sm:w-[22rem] bg-white/95 backdrop-blur-md border border-[#E2D9D0] rounded-2xl shadow-2xl overflow-hidden text-[#3D3730]">
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

            <div className="max-h-48 overflow-y-auto px-4 py-3 space-y-3 bg-white">
              {comments.length === 0 ? (
                <p className="text-xs text-[#5A6355] text-center py-4">
                  No comments yet — be the first to leave one!
                </p>
              ) : (
                comments.slice(0, 20).map(c => (
                  <div key={c.id} className="rounded-xl border border-[#F0EBE6] bg-[#FBF9F7] p-3">
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
                      <p className="text-[10px] text-[#A8B2A6] mt-1.5">
                        {new Date(c.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
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

      <section className="relative h-[60vh] md:h-[80vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <img src={coverPhoto} alt="Pine Flats RV Park" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/40"></div>
        </div>
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto text-white">
          <h1 className="text-4xl md:text-6xl font-serif font-bold mb-6 italic tracking-tight">Pine Flats RV Park</h1>
          <p className="text-lg md:text-xl font-light mb-8 opacity-90 max-w-2xl mx-auto">
            Your serene escape under the pines. 25 spots with full hookups and a welcoming community.
          </p>

          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 mb-4 max-w-2xl mx-auto">
            <div className="text-center mb-5">
              <div className="text-3xl font-serif font-bold text-[#C29474]">{availableSpots} Spots Available</div>
            </div>

            <p className="text-sm uppercase tracking-widest opacity-80 mb-4">Choose Your Rental</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              {RENTAL_OPTIONS.map(option => {
                const Icon = option.icon;
                const isSelected = selectedRental === option.type;
                return (
                  <button
                    key={option.type}
                    onClick={() => setSelectedRental(option.type)}
                    className={`text-left p-4 rounded-xl border-2 transition-all duration-300 hover:-translate-y-0.5 ${
                      isSelected
                        ? 'bg-[#C29474] border-[#C29474] text-white shadow-lg ring-2 ring-white/50'
                        : 'bg-white/15 border-white/30 text-white hover:bg-white/25'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="w-4 h-4 opacity-80" />
                      <span className="text-sm font-semibold uppercase tracking-wide">{option.label}</span>
                    </div>
                    <p className={`text-lg font-serif font-bold leading-tight ${isSelected ? 'text-white' : 'text-[#C29474]'}`}>
                      {option.type === 'daily' ? (
                        <>
                          <span className="block text-sm">{formatCurrency(DAILY_RENT_WEEKDAY)} Sun–Thu</span>
                          <span className="block text-sm">{formatCurrency(DAILY_RENT_WEEKEND)} Fri–Sat</span>
                        </>
                      ) : (
                        option.price
                      )}
                    </p>
                    <p className={`text-[10px] mt-2 leading-snug ${isSelected ? 'text-white/80' : 'text-white/60'}`}>
                      {option.detail}
                    </p>
                  </button>
                );
              })}
            </div>

            {selectedOption && (
              <p className="text-sm mb-4 opacity-90">
                Selected: <strong>{selectedOption.label}</strong>
                {selectedOption.type !== 'daily' && <> — {selectedOption.price}</>}
                {selectedOption.type === 'daily' && <> — {formatCurrency(getDailyRentForDate())} today</>}
                {selectedSite && <> · <strong>{selectedSite.label}</strong></>}
                {checkIn && checkOut && (
                  <> · {parseDate(checkIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {parseDate(checkOut).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
                )}
              </p>
            )}

            <button
              onClick={startBooking}
              disabled={!canBook}
              className="w-full bg-[#C29474] text-white px-6 py-3 rounded-xl text-lg font-semibold shadow-lg hover:-translate-y-1 transition duration-300 flex items-center justify-center gap-2 disabled:opacity-40 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-5 h-5" />
              {bookButtonLabel}
            </button>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-white">
        <div className="max-w-3xl mx-auto space-y-10">
          <div>
            <div className="text-center mb-8">
              <h2 className="text-3xl font-serif text-[#3D3730] mb-2">Choose Your Site</h2>
              <p className="text-sm text-[#5A6355]">
                {availableSlots.length > 0
                  ? `${availableSlots.length} spot${availableSlots.length === 1 ? '' : 's'} available — tap to select your preferred site.`
                  : 'No spots are currently available. Please check back soon or call us.'}
              </p>
            </div>

            {availableSlots.length > 0 ? (
              <div className="bg-white rounded-3xl border border-[#E2D9D0] p-6 shadow-sm">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  {availableSlots.map(slot => {
                    const isSelected = selectedSiteId === slot.id;
                    return (
                      <button
                        key={slot.id}
                        onClick={() => setSelectedSiteId(isSelected ? null : slot.id)}
                        className={`rounded-2xl border-2 text-left transition hover:-translate-y-0.5 overflow-hidden ${
                          isSelected
                            ? 'bg-[#C29474] border-[#C29474] text-white shadow-md ring-2 ring-[#C29474]/30'
                            : 'bg-[#FBF9F7] border-[#E2D9D0] text-[#3D3730] hover:border-[#C29474]'
                        }`}
                      >
                        {slot.imageUrl && (
                          <div className="aspect-[4/3] w-full overflow-hidden border-b border-black/5">
                            <img src={slot.imageUrl} alt={slot.label} className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="p-4">
                          <div className="flex items-center gap-1.5 mb-1">
                            <MapPin className={`w-3.5 h-3.5 ${isSelected ? 'text-white/80' : 'text-[#5A6355]'}`} />
                            <span className="font-serif font-bold text-sm">{slot.label}</span>
                          </div>
                          <div className={`text-[10px] uppercase tracking-wider ${isSelected ? 'text-white/80' : 'text-[#5A6355]'}`}>
                            {isSelected ? 'Selected' : 'Available'}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {selectedSite && (
                  <p className="mt-4 text-sm text-[#5A6355] text-center">
                    Your site: <strong className="text-[#3D3730]">{selectedSite.label}</strong>
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-[#FBF9F7] rounded-3xl border border-[#E2D9D0] p-8 text-center text-sm text-[#5A6355]">
                All 25 spots are currently occupied or reserved.
              </div>
            )}
          </div>

          <div>
            <div className="text-center mb-8">
              <h2 className="text-3xl font-serif text-[#3D3730] mb-2">Availability Calendar</h2>
              <p className="text-sm text-[#5A6355]">
                Pick your check-in and check-out dates after choosing a rental type and site.
              </p>
            </div>
            <PublicBookingCalendar
              selectedRental={selectedRental}
              availableSpots={availableSpots}
              selectedSiteLabel={selectedSite?.label ?? null}
              checkIn={checkIn}
              checkOut={checkOut}
              onDatesChange={(start, end) => {
                setCheckIn(start);
                setCheckOut(end);
              }}
            />

            <button
              onClick={startBooking}
              disabled={!canBook}
              className="mt-6 w-full bg-[#C29474] text-white px-6 py-4 rounded-xl text-lg font-semibold shadow-lg hover:-translate-y-0.5 transition duration-300 flex items-center justify-center gap-2 disabled:opacity-40 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-5 h-5" />
              {bookButtonLabel}
            </button>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 max-w-7xl mx-auto text-center">
        <h2 className="text-3xl font-serif text-[#3D3730] mb-12">Why Choose Pine Flats?</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          <div className="p-8 bg-[#FBF9F7] rounded-3xl border border-[#F0EBE6]">
            <Map className="w-12 h-12 text-[#5A6355] mx-auto mb-4 opacity-80" />
            <h3 className="text-xl font-serif mb-2">Prime Location</h3>
            <p className="text-gray-600 text-sm leading-relaxed">Nestled in a beautiful, wooded area close to hiking trails, lakes, and local attractions.</p>
          </div>
          <div className="p-8 bg-[#FBF9F7] rounded-3xl border border-[#F0EBE6]">
            <Calendar className="w-12 h-12 text-[#5A6355] mx-auto mb-4 opacity-80" />
            <h3 className="text-xl font-serif mb-2">Flexible Stays</h3>
            <p className="text-gray-600 text-sm leading-relaxed">Daily, weekly, or monthly — pick the stay that fits your schedule and budget.</p>
          </div>
          <div className="p-8 bg-[#FBF9F7] rounded-3xl border border-[#F0EBE6]">
            <Phone className="w-12 h-12 text-[#5A6355] mx-auto mb-4 opacity-80" />
            <h3 className="text-xl font-serif mb-2">Great Community</h3>
            <p className="text-gray-600 text-sm leading-relaxed">Join our friendly community of travelers and full-time RVers. On-site management ensures a peaceful stay.</p>
          </div>
        </div>
      </section>

      {galleryMedia.length > 0 && (
        <section className="py-20 px-4 bg-[#F7F3F0]">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-3xl font-serif text-[#3D3730] mb-4 text-center">Our Park</h2>
            <p className="text-sm text-[#5A6355] text-center mb-12">Photos and videos from Pine Flats</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {galleryMedia.map((item) => (
                <div key={item.id} className="rounded-2xl overflow-hidden bg-gray-200 shadow-sm border border-[#E2D9D0]">
                  <div className="aspect-[4/3] w-full bg-black/5">
                    {item.mediaType === 'video' ? (
                      <video
                        src={item.url}
                        className="w-full h-full object-cover"
                        controls
                        playsInline
                        preload="metadata"
                        title={item.caption}
                      >
                        Your browser does not support video playback.
                      </video>
                    ) : (
                      <img
                        src={item.url}
                        alt={item.caption}
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                      />
                    )}
                  </div>
                  {item.caption && (
                    <p className="px-4 py-3 text-sm text-[#5A6355] bg-white">{item.caption}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer className="mt-auto bg-[#3D3730] text-gray-300 py-12 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h3 className="text-2xl font-serif italic text-white mb-2">Pine Flats RV Park</h3>
            <p className="text-sm opacity-60">{contactInfo.tagline || DEFAULT_CONTACT.tagline}</p>
            {contactInfo.address && (
              <p className="text-xs opacity-50 mt-2">{contactInfo.address}</p>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-6">
            {contactInfo.email && (
              <a href={`mailto:${contactInfo.email}`} className="flex items-center gap-2 hover:text-white transition">
                <Mail className="w-4 h-4" />
                {contactInfo.contactName || contactInfo.email}
              </a>
            )}
            {contactInfo.phone && (
              <a href={phoneHref(contactInfo.phone)} className="flex items-center gap-2 hover:text-white transition">
                <Phone className="w-4 h-4" />
                {contactInfo.phone}
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}