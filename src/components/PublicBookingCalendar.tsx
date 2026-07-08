import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { RentalType } from '../../types';
import {
  rentAmountForType, calculateStayTotal, parseDateKey
} from '../../rentUtils';

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function toDateKey(date: Date) {
  return date.toISOString().split('T')[0];
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

interface PublicBookingCalendarProps {
  selectedRental: RentalType | null;
  availableSpots: number;
  selectedSiteLabel?: string | null;
  checkIn: string | null;
  checkOut: string | null;
  onDatesChange: (checkIn: string | null, checkOut: string | null) => void;
}

export function PublicBookingCalendar({
  selectedRental,
  availableSpots,
  selectedSiteLabel,
  checkIn,
  checkOut,
  onDatesChange,
}: PublicBookingCalendarProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const totalDays = daysInMonth(year, month);

  const calendarDays = useMemo(() => {
    const cells: Array<{ key: string; date: Date | null }> = [];
    for (let i = 0; i < firstDayOfWeek; i++) cells.push({ key: `pad-${i}`, date: null });
    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month, day);
      cells.push({ key: toDateKey(date), date });
    }
    return cells;
  }, [firstDayOfWeek, totalDays, year, month]);

  const checkInDate = checkIn ? parseDateKey(checkIn) : null;
  const checkOutDate = checkOut ? parseDateKey(checkOut) : null;

  const estimatedTotal = selectedRental && checkInDate && checkOutDate && checkOutDate > checkInDate
    ? calculateStayTotal(selectedRental, checkInDate, checkOutDate)
    : null;

  const nights = checkInDate && checkOutDate && checkOutDate > checkInDate
    ? Math.round((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const handleDayClick = (date: Date) => {
    if (date < today) return;
    const key = toDateKey(date);

    if (!checkIn || (checkIn && checkOut)) {
      onDatesChange(key, null);
      return;
    }

    const start = parseDateKey(checkIn);
    if (date <= start) {
      onDatesChange(key, null);
      return;
    }

    onDatesChange(checkIn, key);
  };

  const isInRange = (date: Date) => {
    if (!checkInDate || !checkOutDate) return false;
    return date > checkInDate && date < checkOutDate;
  };

  const monthLabel = viewDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="bg-white rounded-3xl border border-[#E2D9D0] p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div className="text-left">
            <h3 className="text-lg font-serif text-[#3D3730]">Select Your Dates</h3>
            <p className="text-xs text-[#5A6355]">
              {availableSpots} spots available · tap check-in, then check-out
              {selectedSiteLabel && <> · Site: <strong>{selectedSiteLabel}</strong></>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewDate(new Date(year, month - 1, 1))}
            className="p-2 rounded-xl border border-[#E2D9D0] hover:bg-[#FBF9F7] transition"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4 text-[#5A6355]" />
          </button>
          <span className="text-sm font-medium text-[#3D3730] min-w-[140px] text-center">{monthLabel}</span>
          <button
            onClick={() => setViewDate(new Date(year, month + 1, 1))}
            className="p-2 rounded-xl border border-[#E2D9D0] hover:bg-[#FBF9F7] transition"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4 text-[#5A6355]" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="text-center text-[10px] uppercase tracking-widest text-[#5A6355] py-2 font-medium">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map(cell => {
          if (!cell.date) {
            return <div key={cell.key} className="aspect-square" />;
          }

          const key = cell.key;
          const isPast = cell.date < today;
          const isCheckIn = checkIn === key;
          const isCheckOut = checkOut === key;
          const inRange = isInRange(cell.date);
          const isWeekend = cell.date.getDay() === 5 || cell.date.getDay() === 6;

          return (
            <button
              key={cell.key}
              disabled={isPast}
              onClick={() => handleDayClick(cell.date!)}
              className={`aspect-square rounded-xl text-sm font-medium transition relative ${
                isPast
                  ? 'text-[#C4BAB0] cursor-not-allowed'
                  : isCheckIn || isCheckOut
                    ? 'bg-[#C29474] text-white shadow-md'
                    : inRange
                      ? 'bg-[#F5E6DC] text-[#6B4A32]'
                      : 'hover:bg-[#FBF9F7] text-[#3D3730] border border-transparent hover:border-[#E2D9D0]'
              }`}
            >
              <span>{cell.date.getDate()}</span>
              {selectedRental === 'daily' && !isPast && (
                <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] ${isCheckIn || isCheckOut ? 'text-white/80' : isWeekend ? 'text-[#C29474]' : 'text-[#5A6355]'}`}>
                  {isWeekend ? '59' : '49'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-6 pt-4 border-t border-[#E2D9D0] grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <div className="bg-[#FBF9F7] rounded-2xl p-4 border border-[#E2D9D0]">
          <p className="text-xs uppercase tracking-widest text-[#5A6355] mb-1">Check-in</p>
          <p className="font-medium text-[#3D3730]">
            {checkIn ? parseDateKey(checkIn).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Select date'}
          </p>
        </div>
        <div className="bg-[#FBF9F7] rounded-2xl p-4 border border-[#E2D9D0]">
          <p className="text-xs uppercase tracking-widest text-[#5A6355] mb-1">Check-out</p>
          <p className="font-medium text-[#3D3730]">
            {checkOut ? parseDateKey(checkOut).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Select date'}
          </p>
        </div>
        <div className="bg-[#FBF9F7] rounded-2xl p-4 border border-[#E2D9D0]">
          <p className="text-xs uppercase tracking-widest text-[#5A6355] mb-1">Estimated Total</p>
          <p className="font-medium text-[#C29474]">
            {estimatedTotal != null
              ? `${formatCurrency(estimatedTotal)} · ${nights} night${nights === 1 ? '' : 's'}`
              : selectedRental
                ? formatCurrency(rentAmountForType(selectedRental))
                : 'Choose rental type'}
          </p>
        </div>
      </div>
    </div>
  );
}