import { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Slot } from '../../types';

/**
 * Local bookings capacity (no Google Calendar).
 */
export function CalendarWidget() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const TOTAL_CAPACITY = 25;

  const loadSlots = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/slots');
      if (res.ok) {
        const data = await res.json();
        setSlots(Array.isArray(data.slots) ? data.slots : []);
      }
    } catch (err) {
      console.error('Failed to load sites', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSlots();
  }, []);

  const activeBookings = slots.filter(
    (s) => s.status === 'occupied' || s.status === 'reserved'
  );
  const availableSpots = slots.filter((s) => s.status === 'available').length;
  const activeBookingsCount = activeBookings.length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-serif text-[#3D3730]">Bookings &amp; capacity</h2>
        <button
          type="button"
          onClick={() => void loadSlots()}
          className="text-[#5A6355] hover:text-[#3D3730] flex items-center gap-1 text-sm bg-[#EDE7E1] px-3 py-1.5 rounded-lg transition-colors border border-[#E2D9D0]"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 border border-[#E2D9D0] bg-white p-6 rounded-[32px] shadow-sm flex flex-col items-center justify-center text-center">
          <h3 className="text-[#5A6355] text-sm uppercase font-bold tracking-widest opacity-80 mb-6">
            Live capacity
          </h3>

          <div className="flex gap-4 w-full">
            <div className="flex-1 bg-[#FBF9F7] border border-[#F0EBE6] rounded-[24px] p-6">
              <div className="text-4xl font-serif text-[#C29474] mb-2">{availableSpots}</div>
              <div className="text-xs uppercase tracking-widest opacity-60 font-bold">
                Available
                <br />
                Spots
              </div>
            </div>
            <div className="flex-1 bg-[#FBF9F7] border border-[#F0EBE6] rounded-[24px] p-6">
              <div className="text-4xl font-serif text-[#5A6355] mb-2">{activeBookingsCount}</div>
              <div className="text-xs uppercase tracking-widest opacity-60 font-bold">
                Active
                <br />
                Bookings
              </div>
            </div>
          </div>

          <div className="mt-8 text-xs text-[#5A6355]">
            Total capacity: <strong>{TOTAL_CAPACITY} sites</strong>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-[32px] shadow-sm border border-[#E2D9D0] overflow-hidden">
          <div className="p-6 border-b border-[#E2D9D0] flex items-center justify-between">
            <h3 className="font-serif text-[#3D3730] text-lg">Occupied &amp; reserved sites</h3>
            <CalendarIcon className="text-[#C29474] w-5 h-5 opacity-50" />
          </div>
          <div className="divide-y divide-[#E2D9D0]/50 max-h-[400px] overflow-y-auto">
            {isLoading && activeBookings.length === 0 ? (
              <div className="p-12 text-center text-[#5A6355] animate-pulse">Loading…</div>
            ) : activeBookings.length === 0 ? (
              <div className="p-12 text-center text-[#5A6355]">
                No occupied or reserved sites right now.
              </div>
            ) : (
              activeBookings
                .slice()
                .sort((a, b) => a.number - b.number)
                .map((slot) => (
                  <div
                    key={slot.id}
                    className="p-4 hover:bg-[#FBF9F7] transition flex gap-4 items-center"
                  >
                    <div className="flex-shrink-0 w-12 h-12 bg-[#EDE7E1] rounded-xl flex flex-col items-center justify-center text-[#5A6355] border border-[#E2D9D0]">
                      <span className="text-[10px] uppercase font-bold tracking-wider">Site</span>
                      <span className="text-lg font-serif leading-none mt-0.5">{slot.number}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-bold text-[#3D3730] truncate">
                        {slot.tenantName || slot.contactName || slot.label}
                      </h4>
                      <p className="text-xs text-[#5A6355] mt-1 pr-4 truncate capitalize">
                        {slot.status}
                        {slot.endDate ? ` · through ${slot.endDate}` : ''}
                      </p>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
