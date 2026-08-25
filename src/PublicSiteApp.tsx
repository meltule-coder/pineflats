import { useEffect, useState } from 'react';
import { PublicWebsite } from './components/PublicWebsite';
import { DEFAULT_CONTACT } from '../contactDefaults';
import { Photo, ParkContact } from '../types';

/**
 * Live public website (no password). Served at / on production VPS.
 * Back office lives at /admin.
 */
export function PublicSiteApp() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [availableSpots, setAvailableSpots] = useState(25);
  const [contact, setContact] = useState<ParkContact>(DEFAULT_CONTACT);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/public/site', {
          headers: { 'X-Pineflats-Client': 'public-website' },
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`Could not load site (${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        if (data.photos) setPhotos(data.photos);
        if (data.availability?.available != null) {
          setAvailableSpots(Number(data.availability.available) || 0);
        }
        if (data.contact) setContact({ ...DEFAULT_CONTACT, ...data.contact });
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load website');
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#F7F3F0] flex items-center justify-center text-[#5A6355] text-sm">
        Loading Pine Flats RV…
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#F7F3F0] flex items-center justify-center px-4">
        <div className="bg-white border border-[#E2D9D0] rounded-3xl p-8 max-w-md text-center shadow-sm">
          <h1 className="text-xl font-serif text-[#3D3730] mb-2">Pine Flats RV</h1>
          <p className="text-sm text-red-700 mb-4">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <PublicWebsite
      photos={photos}
      availableSpots={availableSpots}
      contact={contact}
    />
  );
}
