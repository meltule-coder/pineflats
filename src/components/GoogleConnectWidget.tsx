import { useEffect, useState, type ReactNode } from 'react';
import {
  Calendar, ChevronDown, ChevronUp, ExternalLink, FileSpreadsheet, FileText,
  HardDrive, LogOut, Mail, RefreshCw,
} from 'lucide-react';
import {
  googleSignIn,
  googleLogout,
  initAuth,
  getGoogleEmail,
  isGoogleConnected,
  isGoogleOAuthConfigured,
  getGoogleClientId,
} from '../lib/auth';
import { apiFetch } from '../lib/api';

async function syncGmailTokenToServer(
  accessToken: string,
  email: string | null,
  expiresIn?: number
) {
  if (!accessToken || !email) return;
  const expiresInSec =
    typeof expiresIn === 'number' && expiresIn > 60
      ? Math.max(60, expiresIn - 300)
      : 3300;
  const res = await apiFetch('/api/google/gmail', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessToken,
      email,
      expiresInSec,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not save Gmail session on server');
  }
}

async function clearGmailTokenOnServer() {
  try {
    await apiFetch('/api/google/gmail', { method: 'DELETE' });
  } catch {
    // ignore
  }
}

export function GoogleConnectWidget({
  compact = false,
  emailFocus = false,
}: {
  compact?: boolean;
  /** Emphasize Gmail send for receipt emails (Media page). */
  emailFocus?: boolean;
}) {
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const configured = isGoogleOAuthConfigured();
  const [guideOpen, setGuideOpen] = useState(!configured);

  const refreshServerStatus = async () => {
    try {
      const res = await apiFetch('/api/google/gmail');
      if (res.ok) {
        const data = await res.json();
        setServerReady(!!data.ready);
        if (data.email) setEmail(data.email);
      }
    } catch {
      // ignore
    }
  };

  const refreshStatus = () => {
    setConnected(isGoogleConnected());
    setEmail(getGoogleEmail());
  };

  useEffect(() => {
    refreshStatus();
    void refreshServerStatus();
    return initAuth(
      (user) => {
        setConnected(true);
        setEmail(user.email ?? getGoogleEmail());
      },
      () => {
        if (!isGoogleConnected()) {
          setConnected(false);
          setEmail(getGoogleEmail());
        }
      }
    );
  }, []);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await googleSignIn({ forceAccountPicker: true });
      if (!result) {
        setError('Sign-in was cancelled.');
        return;
      }
      setConnected(true);
      setEmail(result.user.email ?? null);
      await syncGmailTokenToServer(
        result.accessToken,
        result.user.email,
        result.expiresIn
      );
      setServerReady(true);
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error
          ? e.message
          : 'Google sign-in failed. Check popup blockers and your OAuth Client ID setup.'
      );
      setGuideOpen(true);
      setServerReady(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    setError(null);
    try {
      await clearGmailTokenOnServer();
      await googleLogout();
      setConnected(false);
      setEmail(null);
      setServerReady(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect Google');
    } finally {
      setLoading(false);
    }
  };

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <span
                className="hidden md:inline text-xs text-[#5A6355] max-w-[140px] truncate"
                title={email ?? 'Google connected'}
              >
                {email || 'Google connected'}
              </span>
              <button
                type="button"
                onClick={handleSignIn}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#5A6355] border border-[#E2D9D0] bg-white px-2.5 py-2 rounded-xl hover:bg-[#FBF9F7] transition disabled:opacity-50"
                title="Switch or reconnect Google account"
              >
                {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                Switch Google
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs font-semibold text-red-700 border border-red-200 bg-white px-2.5 py-2 rounded-xl hover:bg-red-50 transition disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={loading}
              className="flex items-center gap-2 text-sm font-semibold text-[#3D3730] border border-[#E2D9D0] bg-white px-3 py-2 rounded-xl hover:bg-[#FBF9F7] transition disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <GoogleGlyph className="w-4 h-4" />}
              Connect Google
            </button>
          )}
        </div>
        {error && (
          <p className="text-[10px] text-red-700 max-w-[260px] text-right leading-snug" title={error}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-white border border-[#E2D9D0] rounded-xl flex items-center justify-center shrink-0">
            <GoogleGlyph className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">
              {emailFocus ? 'Sign in with Google to send email' : 'Google account'}
            </h3>
            <p className="text-xs text-[#5A6355] mt-1 max-w-xl">
              {emailFocus
                ? 'Connect the park Gmail so booking receipts and park alerts can be emailed. Separate from your admin password.'
                : 'Connect Gmail to send receipts, plus Calendar, Sheets, and Docs. Separate from your admin password.'}
            </p>
          </div>
        </div>
        {connected || serverReady ? (
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold bg-[#E8F0E8] text-[#3D5A3D] border border-[#A8B2A6] px-2.5 py-1 rounded-full shrink-0">
            {serverReady ? 'Email ready' : 'Connected'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold bg-[#FBF9F7] text-[#5A6355] border border-[#E2D9D0] px-2.5 py-1 rounded-full shrink-0">
            Not connected
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-[#5A6355]">
        <span className="inline-flex items-center gap-1.5 bg-[#FBF9F7] border border-[#E2D9D0] px-2.5 py-1.5 rounded-full">
          <Mail className="w-3.5 h-3.5" /> Gmail send
        </span>
        <span className="inline-flex items-center gap-1.5 bg-[#FBF9F7] border border-[#E2D9D0] px-2.5 py-1.5 rounded-full">
          <Calendar className="w-3.5 h-3.5" /> Calendar
        </span>
        <span className="inline-flex items-center gap-1.5 bg-[#FBF9F7] border border-[#E2D9D0] px-2.5 py-1.5 rounded-full">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Sheets
        </span>
        <span className="inline-flex items-center gap-1.5 bg-[#FBF9F7] border border-[#E2D9D0] px-2.5 py-1.5 rounded-full">
          <FileText className="w-3.5 h-3.5" /> Docs
        </span>
        <span className="inline-flex items-center gap-1.5 bg-[#FBF9F7] border border-[#E2D9D0] px-2.5 py-1.5 rounded-full">
          <HardDrive className="w-3.5 h-3.5" /> Drive (read)
        </span>
      </div>

      {(connected || serverReady) && email && (
        <p className="text-sm text-[#3D3730]">
          Signed in as <strong className="font-semibold">{email}</strong>
          {serverReady ? (
            <span className="block text-xs text-[#3D5A3D] mt-1">
              Server can send receipt emails from this Gmail for about 1 hour. Sign in again if emails stop.
            </span>
          ) : null}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 whitespace-pre-wrap">
          {error}
        </p>
      )}

      {configured && !connected && (
        <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] px-4 py-3 text-xs text-[#5A6355] leading-relaxed">
          OAuth client is installed. Click below and choose the Google account for the park.
          If you see <strong>origin_mismatch</strong>, open the setup guide and check Authorized JavaScript origins.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!connected ? (
          <button
            type="button"
            onClick={handleSignIn}
            disabled={loading || !configured}
            className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <GoogleGlyph className="w-4 h-4" />}
            {loading ? 'Connecting…' : 'Sign in with Google'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSignIn}
              disabled={loading}
              className="flex items-center gap-2 border border-[#E2D9D0] text-[#5A6355] bg-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <GoogleGlyph className="w-4 h-4" />}
              Switch account
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={loading}
              className="flex items-center gap-2 border border-red-200 text-red-700 bg-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
            >
              <LogOut className="w-4 h-4" />
              Disconnect Google
            </button>
          </>
        )}
      </div>

      <p className="text-[11px] text-[#5A6355]/80 leading-relaxed">
        After connecting, use <strong>Sites</strong> for Sheets &amp; receipt Docs, and <strong>Bookings</strong> for
        Calendar. Client ID in app:{' '}
        {configured ? (
          <code className="bg-[#FBF9F7] px-1 rounded border border-[#E2D9D0] break-all">
            {getGoogleClientId().slice(0, 20)}…
          </code>
        ) : (
          <span className="text-[#6B4A32] font-medium">not installed yet</span>
        )}
      </p>

      {/* Full setup guide — always available on Settings */}
      <div className="rounded-2xl border border-[#E2D9D0] overflow-hidden">
        <button
          type="button"
          onClick={() => setGuideOpen(o => !o)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-[#FBF9F7] text-left hover:bg-[#F7F3F0] transition"
        >
          <div>
            <p className="text-sm font-semibold text-[#3D3730]">
              How to create / fix Google Connect (step by step)
            </p>
            <p className="text-[11px] text-[#5A6355] mt-0.5">
              Google Cloud Console login, new Client ID, origins, and testing
            </p>
          </div>
          {guideOpen ? (
            <ChevronUp className="w-5 h-5 text-[#5A6355] shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-[#5A6355] shrink-0" />
          )}
        </button>

        {guideOpen && (
          <div className="px-4 py-4 space-y-5 text-xs text-[#5A6355] leading-relaxed border-t border-[#E2D9D0] bg-white">
            <p className="text-[#3D3730]">
              Use a computer browser. Stay signed in as the Gmail that should own park Google access
              (for example pineflatsrv1@gmail.com).
            </p>

            <GuideStep n={1} title="Open Google Cloud">
              <ol className="list-decimal list-inside space-y-1.5 mt-2">
                <li>
                  Go to{' '}
                  <OutLink href="https://console.cloud.google.com/">console.cloud.google.com</OutLink>
                </li>
                <li>Sign in with your Google account</li>
                <li>
                  Top bar: select or create a project (e.g. <strong>Pine Flats</strong>)
                </li>
              </ol>
            </GuideStep>

            <GuideStep n={2} title="OAuth consent screen">
              <ol className="list-decimal list-inside space-y-1.5 mt-2">
                <li>
                  Open{' '}
                  <OutLink href="https://console.cloud.google.com/apis/credentials/consent">
                    OAuth consent screen
                  </OutLink>
                </li>
                <li>
                  User type: <strong>External</strong> → Create
                </li>
                <li>
                  App name: <strong>Pine Flats RV</strong> · support &amp; developer email: your Gmail
                </li>
                <li>Save and Continue through Scopes</li>
                <li>
                  <strong>Test users</strong> → Add users → add your Gmail → Save
                </li>
              </ol>
            </GuideStep>

            <GuideStep n={3} title="Enable APIs">
              <ol className="list-decimal list-inside space-y-1.5 mt-2">
                <li>
                  Open the{' '}
                  <OutLink href="https://console.cloud.google.com/apis/library">API Library</OutLink>
                </li>
                <li>
                  Search and <strong>Enable</strong> each:
                  <ul className="list-disc list-inside ml-3 mt-1 space-y-0.5">
                    <li>Gmail API</li>
                    <li>Google Calendar API</li>
                    <li>Google Sheets API</li>
                    <li>Google Docs API</li>
                    <li>Google Drive API</li>
                  </ul>
                </li>
              </ol>
            </GuideStep>

            <GuideStep n={4} title="Create OAuth Client ID (Web)">
              <ol className="list-decimal list-inside space-y-1.5 mt-2">
                <li>
                  Open{' '}
                  <OutLink href="https://console.cloud.google.com/apis/credentials">Credentials</OutLink>
                </li>
                <li>
                  <strong>+ Create credentials</strong> → <strong>OAuth client ID</strong>
                </li>
                <li>
                  Application type: <strong>Web application</strong>
                </li>
                <li>
                  Name: <strong>Pine Flats Web</strong>
                </li>
                <li>
                  Under <strong>Authorized JavaScript origins</strong>, add each URI exactly
                  (no trailing slash, no /admin):
                  <ul className="list-none mt-2 space-y-1.5">
                    <OriginRow code="http://localhost:3000" note="local admin" />
                    <OriginRow code="https://pineflatsrv.com" note="live site" />
                    <OriginRow code="https://www.pineflatsrv.com" note="www" />
                    <OriginRow code="https://pineflatsrvpark.com" note="optional" />
                    <OriginRow code="https://www.pineflatsrvpark.com" note="optional" />
                  </ul>
                </li>
                <li>
                  Authorized redirect URIs: leave empty for this app
                </li>
                <li>
                  Click <strong>Create</strong>
                </li>
              </ol>
            </GuideStep>

            <GuideStep n={5} title="Copy the Client ID">
              <ol className="list-decimal list-inside space-y-1.5 mt-2">
                <li>
                  Copy the <strong>Client ID</strong> (ends with{' '}
                  <code className="bg-[#FBF9F7] px-1 rounded border border-[#E2D9D0]">
                    .apps.googleusercontent.com
                  </code>
                  )
                </li>
                <li>You do not need the Client secret for this Connect Google setup</li>
                <li>
                  Save the Client ID somewhere safe (email yourself or a note)
                </li>
                <li>
                  Put it in the app file{' '}
                  <code className="bg-[#FBF9F7] px-1 rounded border border-[#E2D9D0]">
                    google-oauth-config.json
                  </code>{' '}
                  as <code className="bg-[#FBF9F7] px-1 rounded border border-[#E2D9D0]">clientId</code>, then
                  redeploy — or paste the Client ID to your developer to install
                </li>
              </ol>
            </GuideStep>

            <GuideStep n={6} title="Test Connect Google">
              <ol className="list-decimal list-inside space-y-1.5 mt-2">
                <li>Wait 1–5 minutes after saving the OAuth client</li>
                <li>
                  Open admin: {' '}
                  <code className="bg-[#FBF9F7] px-1 rounded border border-[#E2D9D0]">
                    https://pineflatsrv.com/admin
                  </code>{' '}
                  or{' '}
                  <code className="bg-[#FBF9F7] px-1 rounded border border-[#E2D9D0]">
                    http://localhost:3000/admin
                  </code>
                </li>
                <li>Hard refresh: Ctrl + F5</li>
                <li>Sign in with the admin password</li>
                <li>
                  Click <strong>Sign in with Google</strong> above → pick your Gmail → Allow
                </li>
              </ol>
            </GuideStep>

            <div className="rounded-xl border border-[#E2D9D0] bg-[#FBF9F7] px-3 py-3 space-y-2">
              <p className="font-semibold text-[#3D3730]">If something fails</p>
              <ul className="list-disc list-inside space-y-1.5">
                <li>
                  <strong>origin_mismatch</strong> — the address bar host is missing from Authorized
                  JavaScript origins (add that exact origin; no /admin)
                </li>
                <li>
                  <strong>access_denied</strong> / blocked — add your Gmail under Test users on the
                  consent screen
                </li>
                <li>
                  Popup blocked — allow popups for this site
                </li>
                <li>
                  Wrong client — open the Credentials page and edit the client that matches the ID
                  installed in this app
                </li>
              </ul>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <OutLink href="https://console.cloud.google.com/apis/credentials" button>
                Open Credentials
              </OutLink>
              <OutLink href="https://console.cloud.google.com/apis/credentials/consent" button>
                Open Consent screen
              </OutLink>
              <OutLink href="https://console.cloud.google.com/apis/library" button>
                Open API Library
              </OutLink>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GuideStep({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-l-2 border-[#C29474]/60 pl-3">
      <p className="font-semibold text-[#3D3730]">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#5A6355] text-white text-[10px] mr-2">
          {n}
        </span>
        {title}
      </p>
      {children}
    </div>
  );
}

function OriginRow({ code, note }: { code: string; note: string }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <code className="bg-[#FBF9F7] px-1.5 py-0.5 rounded border border-[#E2D9D0] text-[11px]">{code}</code>
      <span className="text-[10px] text-[#A8B2A6]">({note})</span>
    </li>
  );
}

function OutLink({
  href,
  children,
  button = false,
}: {
  href: string;
  children: ReactNode;
  button?: boolean;
}) {
  if (button) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5A6355] border border-[#E2D9D0] bg-[#FBF9F7] px-3 py-2 rounded-xl hover:bg-[#F7F3F0] transition"
      >
        {children}
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline font-medium text-[#5A6355] hover:text-[#3D3730]"
    >
      {children}
    </a>
  );
}

function GoogleGlyph({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className={className}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
