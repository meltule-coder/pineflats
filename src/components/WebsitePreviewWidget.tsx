import { useEffect, useState } from 'react';
import { Globe, Lock, LogOut, Eye } from 'lucide-react';
import { PublicWebsite } from './PublicWebsite';
import { Photo, ParkContact } from '../../types';
import { DEFAULT_CONTACT } from '../../contactDefaults';

const AUTH_KEY = 'pineflats-preview-auth';

export function WebsitePreviewWidget() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{
    photos: Photo[];
    availableSpots: number;
    contact: ParkContact;
  } | null>(null);

  useEffect(() => {
    setIsAuthenticated(sessionStorage.getItem(AUTH_KEY) === '1');
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/preview/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        sessionStorage.setItem(AUTH_KEY, '1');
        setIsAuthenticated(true);
        setPassword('');
      } else if (res.status === 404) {
        setError('Preview login is unavailable. Restart the dev server and try again.');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Incorrect password');
      }
    } catch {
      setError('Login failed. Restart the dev server if this keeps happening.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
    setIsPreviewOpen(false);
    setPreviewData(null);
  };

  const handleOpenPreview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Public site data only — never load tenants or returning customers
      let siteRes = await fetch('/api/public/site');
      // Fallback if public bundle route is missing (stale server) — still avoid private APIs
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
      setError('Could not load website preview. Check that the server is running on port 3000.');
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
            <h3 className="text-sm font-serif text-[#3D3730]">Website Preview</h3>
            <p className="text-xs text-[#5A6355] mt-0.5">
              Sign in to preview the public website before it goes live.
            </p>
          </div>
        </div>
        {isAuthenticated && (
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-red-500 hover:bg-red-50 px-3 py-2 rounded-xl transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        )}
      </div>

      {!isAuthenticated ? (
        <form onSubmit={handleLogin} className="max-w-sm space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
              <Lock className="w-3.5 h-3.5" />
              Preview Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter preview password"
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              autoComplete="current-password"
            />
            <p className="text-[11px] text-[#5A6355] opacity-70">
              Password: <span className="font-mono">pineflats</span>
              {' '}· Settings tab → Website Preview
            </p>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={isLoading || !password.trim()}
            className="flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
          >
            <Lock className="w-4 h-4" />
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-[#3D5A3D]">Signed in — you can open the website preview.</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={handleOpenPreview}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 bg-[#C29474] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#A87A5E] transition disabled:opacity-50"
          >
            <Eye className="w-4 h-4" />
            {isLoading ? 'Loading...' : 'Open Website Preview'}
          </button>
        </div>
      )}
    </div>
  );
}