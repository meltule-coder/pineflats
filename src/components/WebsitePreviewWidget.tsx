import { useState } from 'react';
import { Globe, Eye, ExternalLink } from 'lucide-react';
import { PublicWebsite } from './PublicWebsite';
import { Photo, ParkContact } from '../../types';
import { DEFAULT_CONTACT } from '../../contactDefaults';

export function WebsitePreviewWidget() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{
    photos: Photo[];
    availableSpots: number;
    contact: ParkContact;
  } | null>(null);

  const handleOpenPreview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Public site data only — never load tenants or returning customers
      let siteRes = await fetch('/api/public/site');
      if (!siteRes.ok) {
        const [availRes, photosRes, contactRes] = await Promise.all([
          fetch('/api/public/availability'),
          fetch('/api/public/photos'),
          fetch('/api/contact'),
        ]);
        if (availRes.ok || photosRes.ok || contactRes.ok) {
          const availability = availRes.ok ? await availRes.json() : { available: 25, slots: [] };
          const photos = photosRes.ok ? await photosRes.json() : [];
          const contact = contactRes.ok ? await contactRes.json() : DEFAULT_CONTACT;
          setPreviewData({
            photos: Array.isArray(photos) ? photos : [],
            availableSpots: availability.available ?? 25,
            contact: contact ?? DEFAULT_CONTACT,
          });
          setIsPreviewOpen(true);
          return;
        }
        if (siteRes.status === 404) {
          setError('Preview API missing. Stop the app and run npm run dev again, then retry.');
        } else {
          setError(`Could not load website preview (error ${siteRes.status}).`);
        }
        return;
      }
      const contentType = siteRes.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setError('Server returned a page instead of data. Restart with npm run dev, then try again.');
        return;
      }
      const site = await siteRes.json();
      setPreviewData({
        photos: site.photos ?? [],
        availableSpots: site.availability?.available ?? 25,
        contact: site.contact ?? DEFAULT_CONTACT,
      });
      setIsPreviewOpen(true);
    } catch {
      setError('Could not load website preview. Check that the server is running.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isPreviewOpen && previewData) {
    return (
      <PublicWebsite
        photos={previewData.photos}
        availableSpots={previewData.availableSpots}
        contact={previewData.contact}
        onBack={() => setIsPreviewOpen(false)}
      />
    );
  }

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center">
            <Globe className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">Public Website</h3>
            <p className="text-xs text-[#5A6355] mt-0.5">
              Open the guest booking site from the back office — no password required.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleOpenPreview}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 bg-[#C29474] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition disabled:opacity-50"
          >
            <Eye className="w-4 h-4" />
            {isLoading ? 'Loading…' : 'Open Website'}
          </button>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 border border-[#E2D9D0] text-[#5A6355] px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] transition"
          >
            <ExternalLink className="w-4 h-4" />
            Open in new tab
          </a>
        </div>
      </div>
    </div>
  );
}
