import { useState } from 'react';
import { Photo, Tenant, RentalType } from '../../types';
import {
  ArrowLeft, Map, Calendar, Phone, Mail, CheckCircle2, Sun, Clock, Home
} from 'lucide-react';
import {
  WEEKLY_RENT, MONTHLY_RENT, DAILY_RENT_WEEKDAY, DAILY_RENT_WEEKEND,
  getDailyRentForDate, dailyRateLabel, formatDailyRateDescription
} from '../../rentUtils';
import { PublicBookingCalendar } from './PublicBookingCalendar';

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
    detail: 'Per week · 7-night stay',
    icon: Clock,
  },
  {
    type: 'monthly',
    label: 'Monthly',
    price: formatCurrency(MONTHLY_RENT),
    detail: 'Pro-rated if under 30 days',
    icon: Home,
  },
];

export function PublicWebsite({ photos, tenants, availableSpots, onBack }: { photos: Photo[], tenants: Tenant[], availableSpots: number, onBack: () => void }) {
  const [selectedRental, setSelectedRental] = useState<RentalType | null>(null);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const coverPhoto = photos.length > 0 ? photos[0].url : 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=2000';

  const selectedOption = RENTAL_OPTIONS.find(o => o.type === selectedRental);

  return (
    <div className="min-h-screen bg-white font-sans text-gray-800 flex flex-col relative w-full overflow-y-auto">
      <div className="fixed top-4 left-4 z-50">
        <button
          onClick={onBack}
          className="flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2 rounded-full shadow-lg hover:bg-[#3D3730] transition border border-[#E2D9D0]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Return to Dashboard</span>
        </button>
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
                {checkIn && checkOut && (
                  <> · {parseDate(checkIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {parseDate(checkOut).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
                )}
              </p>
            )}

            <button
              disabled={!selectedRental || !checkIn || !checkOut}
              className="w-full bg-[#C29474] text-white px-6 py-3 rounded-xl text-lg font-semibold shadow-lg hover:-translate-y-1 transition duration-300 flex items-center justify-center gap-2 disabled:opacity-40 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-5 h-5" />
              {!selectedRental
                ? 'Select a Rental Type Above'
                : !checkIn || !checkOut
                  ? 'Select Dates Below'
                  : `Book ${selectedOption?.label} Stay`}
            </button>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-[#F7F3F0]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-serif text-[#3D3730] mb-3">Rental Rates</h2>
          <p className="text-[#5A6355] text-sm mb-10">Tap your preferred stay length to select it above, then book your spot.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-3xl border border-[#E2D9D0] p-6 shadow-sm">
              <Sun className="w-10 h-10 text-[#C29474] mx-auto mb-3" />
              <h3 className="text-xl font-serif text-[#3D3730] mb-2">Daily</h3>
              <p className="text-2xl font-serif text-[#C29474] mb-1">{formatCurrency(DAILY_RENT_WEEKDAY)}</p>
              <p className="text-xs text-[#5A6355] mb-3">Sunday – Thursday</p>
              <p className="text-2xl font-serif text-[#C29474] mb-1">{formatCurrency(DAILY_RENT_WEEKEND)}</p>
              <p className="text-xs text-[#5A6355] mb-4">Friday – Saturday</p>
              <button
                onClick={() => setSelectedRental('daily')}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition ${
                  selectedRental === 'daily'
                    ? 'bg-[#C29474] text-white'
                    : 'bg-[#FBF9F7] text-[#5A6355] border border-[#E2D9D0] hover:bg-[#EDE7E1]'
                }`}
              >
                {selectedRental === 'daily' ? 'Selected' : 'Choose Daily'}
              </button>
            </div>
            <div className="bg-white rounded-3xl border border-[#E2D9D0] p-6 shadow-sm">
              <Clock className="w-10 h-10 text-[#C29474] mx-auto mb-3" />
              <h3 className="text-xl font-serif text-[#3D3730] mb-2">Weekly</h3>
              <p className="text-3xl font-serif text-[#C29474] mb-2">{formatCurrency(WEEKLY_RENT)}</p>
              <p className="text-xs text-[#5A6355] mb-4">Per week</p>
              <button
                onClick={() => setSelectedRental('weekly')}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition ${
                  selectedRental === 'weekly'
                    ? 'bg-[#C29474] text-white'
                    : 'bg-[#FBF9F7] text-[#5A6355] border border-[#E2D9D0] hover:bg-[#EDE7E1]'
                }`}
              >
                {selectedRental === 'weekly' ? 'Selected' : 'Choose Weekly'}
              </button>
            </div>
            <div className="bg-white rounded-3xl border border-[#E2D9D0] p-6 shadow-sm">
              <Home className="w-10 h-10 text-[#C29474] mx-auto mb-3" />
              <h3 className="text-xl font-serif text-[#3D3730] mb-2">Monthly</h3>
              <p className="text-3xl font-serif text-[#C29474] mb-2">{formatCurrency(MONTHLY_RENT)}</p>
              <p className="text-xs text-[#5A6355] mb-4">$750/mo · pro-rated under 30 days</p>
              <button
                onClick={() => setSelectedRental('monthly')}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition ${
                  selectedRental === 'monthly'
                    ? 'bg-[#C29474] text-white'
                    : 'bg-[#FBF9F7] text-[#5A6355] border border-[#E2D9D0] hover:bg-[#EDE7E1]'
                }`}
              >
                {selectedRental === 'monthly' ? 'Selected' : 'Choose Monthly'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-serif text-[#3D3730] mb-2">Availability Calendar</h2>
            <p className="text-sm text-[#5A6355]">
              Pick your check-in and check-out dates after choosing a rental type.
            </p>
          </div>
          <PublicBookingCalendar
            selectedRental={selectedRental}
            availableSpots={availableSpots}
            checkIn={checkIn}
            checkOut={checkOut}
            onDatesChange={(start, end) => {
              setCheckIn(start);
              setCheckOut(end);
            }}
          />
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

      {photos.length > 1 && (
        <section className="py-20 px-4 bg-[#F7F3F0]">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-3xl font-serif text-[#3D3730] mb-12 text-center">Our Park</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {photos.slice(1).map((photo) => (
                <div key={photo.id} className="aspect-[4/3] rounded-2xl overflow-hidden bg-gray-200">
                  <img src={photo.url} alt={photo.caption} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
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
            <p className="text-sm opacity-60">Your home away from home.</p>
          </div>
          <div className="flex gap-6">
            <a href="#" className="flex items-center gap-2 hover:text-white transition"><Mail className="w-4 h-4" /> Contact</a>
            <a href="#" className="flex items-center gap-2 hover:text-white transition"><Phone className="w-4 h-4" /> 555-0199</a>
          </div>
        </div>
      </footer>
    </div>
  );
}