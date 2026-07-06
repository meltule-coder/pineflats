import { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, Link as LinkIcon, RefreshCw, LogOut } from 'lucide-react';
import { googleSignIn, getAccessToken, initAuth, logout } from '../lib/auth';

export function CalendarWidget() {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);

  // Hardcoded total capacity
  const TOTAL_CAPACITY = 25;

  useEffect(() => {
    initAuth(
      (user, t) => {
        setToken(t);
        setNeedsAuth(false);
      },
      () => {
        setToken(null);
        setNeedsAuth(true);
      }
    );
  }, []);

  useEffect(() => {
    if (token) {
      fetchEvents();
    }
  }, [token]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setNeedsAuth(false);
      }
    } catch (err) {
      console.error('Login failed:', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setToken(null);
    setNeedsAuth(true);
    setEvents([]);
  };

  const fetchEvents = async () => {
    if (!token) return;
    setIsLoadingEvents(true);
    try {
      const timeMin = new Date().toISOString();
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&maxResults=10&singleEvents=true&orderBy=startTime`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setEvents(data.items || []);
      }
    } catch (err) {
      console.error('Failed to fetch events', err);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const activeBookingsCount = events.length;
  const availableSpots = Math.max(0, TOTAL_CAPACITY - activeBookingsCount);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-serif text-[#3D3730]">Bookings & Calendar</h2>
        {token && (
          <button 
            onClick={fetchEvents}
            className="text-[#5A6355] hover:text-[#3D3730] flex items-center gap-1 text-sm bg-[#EDE7E1] px-3 py-1.5 rounded-lg transition-colors border border-[#E2D9D0]"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingEvents ? 'animate-spin' : ''}`} />
            Refresh Sync
          </button>
        )}
      </div>

      {!token ? (
        <div className="bg-white rounded-[32px] p-8 shadow-sm border border-[#E2D9D0] text-center max-w-2xl mx-auto flex flex-col items-center">
          <div className="w-16 h-16 bg-[#EDE7E1] text-[#5A6355] rounded-full flex items-center justify-center mb-6 border border-[#E2D9D0]">
            <CalendarIcon className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-serif text-[#3D3730] mb-3">Connect to Google Calendar</h3>
          <p className="text-[#5A6355] mb-8 text-sm leading-relaxed">
            Sync with your future reservations automatically. Once connected, the system will track your current bookings against the 25 total spots and keep your availability up to date on your public website.
          </p>
          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="flex items-center gap-3 bg-white border border-[#E2D9D0] text-[#3D3730] px-6 py-3 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] transition shadow-sm w-full sm:w-auto justify-center"
          >
            {isLoggingIn ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                <path fill="none" d="M0 0h48v48H0z"></path>
              </svg>
            )}
            Sign in with Google
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 border border-[#E2D9D0] bg-white p-6 rounded-[32px] shadow-sm flex flex-col items-center justify-center text-center">
             <h3 className="text-[#5A6355] text-sm uppercase font-bold tracking-widest opacity-80 mb-6">Live Capacity</h3>
             
             <div className="flex gap-4 w-full">
                <div className="flex-1 bg-[#FBF9F7] border border-[#F0EBE6] rounded-[24px] p-6">
                  <div className="text-4xl font-serif text-[#C29474] mb-2">{availableSpots}</div>
                  <div className="text-xs uppercase tracking-widest opacity-60 font-bold">Available<br/>Spots</div>
                </div>
                <div className="flex-1 bg-[#FBF9F7] border border-[#F0EBE6] rounded-[24px] p-6">
                   <div className="text-4xl font-serif text-[#5A6355] mb-2">{activeBookingsCount}</div>
                   <div className="text-xs uppercase tracking-widest opacity-60 font-bold">Active<br/>Bookings</div>
                </div>
             </div>
             
             <div className="mt-8 text-xs text-[#5A6355]">
               Total Capacity: <strong>{TOTAL_CAPACITY} Sites</strong>
             </div>

             <button onClick={handleLogout} className="mt-6 flex items-center justify-center gap-2 text-xs text-red-500 hover:bg-red-50 px-4 py-2 rounded-xl transition">
               <LogOut className="w-3 h-3" />
               Disconnect Calendar
             </button>
          </div>

          <div className="lg:col-span-2 bg-white rounded-[32px] shadow-sm border border-[#E2D9D0] overflow-hidden">
             <div className="p-6 border-b border-[#E2D9D0] flex items-center justify-between">
                <h3 className="font-serif text-[#3D3730] text-lg">Upcoming Reservations from Calendar</h3>
                <LinkIcon className="text-[#C29474] w-5 h-5 opacity-50" />
             </div>
             <div className="divide-y divide-[#E2D9D0]/50 max-h-[400px] overflow-y-auto">
               {isLoadingEvents && events.length === 0 ? (
                 <div className="p-12 text-center text-[#5A6355] animate-pulse">Syncing events...</div>
               ) : events.length === 0 ? (
                 <div className="p-12 text-center text-[#5A6355]">No upcoming reservations found on this calendar.</div>
               ) : (
                 events.map((evt, idx) => {
                   const start = evt.start?.dateTime ? new Date(evt.start.dateTime) : (evt.start?.date ? new Date(evt.start.date) : null);
                   const end = evt.end?.dateTime ? new Date(evt.end.dateTime) : (evt.end?.date ? new Date(evt.end.date) : null);
                   
                   return (
                     <div key={idx} className="p-4 hover:bg-[#FBF9F7] transition flex gap-4 items-center">
                       <div className="flex-shrink-0 w-12 h-12 bg-[#EDE7E1] rounded-xl flex flex-col items-center justify-center text-[#5A6355] border border-[#E2D9D0]">
                          <span className="text-[10px] uppercase font-bold tracking-wider">{start ? start.toLocaleString('en-US', { month: 'short' }) : 'N/A'}</span>
                          <span className="text-lg font-serif leading-none mt-0.5">{start ? start.getDate() : '-'}</span>
                       </div>
                       <div className="flex-1 min-w-0">
                         <h4 className="text-sm font-bold text-[#3D3730] truncate">{evt.summary || 'Reserved Spot'}</h4>
                         <p className="text-xs text-[#5A6355] mt-1 pr-4 truncate">
                           End: {end ? end.toLocaleString('en-US', { month: 'short', day: 'numeric' }) : 'N/A'}
                         </p>
                       </div>
                     </div>
                   );
                 })
               )}
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
