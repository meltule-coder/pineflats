/**
 * Google OAuth for Gmail send / Calendar / Sheets / Docs — owned by YOUR Google Cloud project.
 * Does not use the Empire Firebase project (empirecli-3aaae).
 *
 * Set client ID in:
 *   - google-oauth-config.json  →  "clientId"
 *   - or VITE_GOOGLE_CLIENT_ID in .env.local
 */

import oauthConfig from '../../google-oauth-config.json';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

const TOKEN_KEY = 'pineflats_google_access_token';
const EMAIL_KEY = 'pineflats_google_email';
const NAME_KEY = 'pineflats_google_name';

/** Minimal user profile (replaces Firebase User for Google connect). */
export type GoogleUser = {
  email: string | null;
  displayName: string | null;
};

export type GoogleSignInResult = {
  user: GoogleUser;
  accessToken: string;
  /** Seconds until token expires (from Google, often ~3600). */
  expiresIn?: number;
};

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedEmail: string | null = null;
let cachedName: string | null = null;

type AuthListener = {
  onSuccess?: (user: GoogleUser, token: string) => void;
  onFailure?: () => void;
};
const listeners = new Set<AuthListener>();

try {
  if (typeof sessionStorage !== 'undefined') {
    cachedAccessToken = sessionStorage.getItem(TOKEN_KEY);
    cachedEmail = sessionStorage.getItem(EMAIL_KEY);
    cachedName = sessionStorage.getItem(NAME_KEY);
  }
} catch {
  // ignore
}

function persistSession(token: string | null, email: string | null, name: string | null = null) {
  cachedAccessToken = token;
  cachedEmail = email;
  cachedName = name;
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
    if (email) sessionStorage.setItem(EMAIL_KEY, email);
    else sessionStorage.removeItem(EMAIL_KEY);
    if (name) sessionStorage.setItem(NAME_KEY, name);
    else sessionStorage.removeItem(NAME_KEY);
  } catch {
    // ignore
  }
  notifyListeners();
}

function notifyListeners() {
  if (cachedAccessToken && (cachedEmail || cachedName)) {
    const user: GoogleUser = { email: cachedEmail, displayName: cachedName };
    for (const l of listeners) {
      l.onSuccess?.(user, cachedAccessToken);
    }
  } else {
    for (const l of listeners) {
      l.onFailure?.();
    }
  }
}

/** OAuth Web Client ID from your Google Cloud project (not Empire Firebase). */
export function getGoogleClientId(): string {
  const fromEnv =
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID) ||
    '';
  const fromFile = typeof oauthConfig.clientId === 'string' ? oauthConfig.clientId.trim() : '';
  return (fromEnv || fromFile || '').trim();
}

export function isGoogleOAuthConfigured(): boolean {
  return getGoogleClientId().length > 0;
}

export function getGoogleEmail(): string | null {
  return cachedEmail;
}

export function isGoogleConnected(): boolean {
  return !!(cachedAccessToken && cachedEmail);
}

/**
 * Subscribe to Google connection changes.
 * Returns an unsubscribe function.
 */
export const initAuth = (
  onAuthSuccess?: (user: GoogleUser, token: string) => void,
  onAuthFailure?: () => void
) => {
  const listener: AuthListener = { onSuccess: onAuthSuccess, onFailure: onAuthFailure };
  listeners.add(listener);
  // Immediate status
  if (cachedAccessToken && cachedEmail) {
    onAuthSuccess?.({ email: cachedEmail, displayName: cachedName }, cachedAccessToken);
  } else {
    onAuthFailure?.();
  }
  return () => {
    listeners.delete(listener);
  };
};

/** No-op: GIS token flow does not use page redirects. Kept for API compatibility. */
export const completeGoogleRedirect = async (): Promise<GoogleSignInResult | null> => null;

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Google sign-in only works in the browser'));
      return;
    }
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[data-pineflats-gis="1"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.pineflatsGis = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

async function fetchUserProfile(accessToken: string): Promise<GoogleUser> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { email: null, displayName: null };
    const data = (await res.json()) as { email?: string; name?: string };
    return {
      email: data.email ?? null,
      displayName: data.name ?? null,
    };
  } catch {
    return { email: null, displayName: null };
  }
}

/**
 * Sign in with Google under YOUR OAuth client.
 * Always shows the account chooser so you can pick any Gmail (not locked to Empire).
 */
export const googleSignIn = async (options?: {
  forceAccountPicker?: boolean;
  preferRedirect?: boolean;
}): Promise<GoogleSignInResult | null> => {
  const forceAccountPicker = options?.forceAccountPicker !== false;
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error(
      'Google login is not set up yet. Create an OAuth Client ID under YOUR Google account ' +
        '(Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application), ' +
        'then paste it into google-oauth-config.json as "clientId" (or set VITE_GOOGLE_CLIENT_ID) and redeploy.'
    );
  }

  if (isSigningIn) return null;
  isSigningIn = true;

  try {
    if (forceAccountPicker) {
      persistSession(null, null, null);
    }

    await loadGisScript();
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      throw new Error('Google Identity Services did not load. Check your network and try again.');
    }

    const result = await new Promise<GoogleSignInResult | null>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        prompt: forceAccountPicker ? 'consent select_account' : 'select_account',
        callback: async (response) => {
          try {
            if (response.error) {
              if (response.error === 'access_denied' || response.error === 'popup_closed_by_user') {
                resolve(null);
                return;
              }
              reject(new Error(friendlyGoogleError(response.error, response.error_description)));
              return;
            }
            if (!response.access_token) {
              reject(new Error('Google did not return an access token'));
              return;
            }
            const user = await fetchUserProfile(response.access_token);
            persistSession(response.access_token, user.email, user.displayName);
            const expiresIn =
              typeof (response as { expires_in?: number }).expires_in === 'number'
                ? (response as { expires_in: number }).expires_in
                : undefined;
            resolve({ user, accessToken: response.access_token, expiresIn });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        },
        error_callback: (err) => {
          const msg = err?.type === 'popup_closed' || err?.type === 'popup_failed_to_open'
            ? 'Google sign-in window was closed or blocked. Allow popups for this site and try again.'
            : friendlyGoogleError(err?.type || 'error', err?.message);
          if (err?.type === 'popup_closed') {
            resolve(null);
            return;
          }
          reject(new Error(msg));
        },
      });

      client.requestAccessToken();
    });

    return result;
  } catch (error: unknown) {
    console.error('Google sign-in error:', error);
    const friendly = friendlyGoogleError(
      (error as { code?: string })?.code || '',
      error instanceof Error ? error.message : String(error)
    );
    if (friendly && error instanceof Error && error.message !== friendly) {
      throw new Error(friendly);
    }
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export function friendlyGoogleError(code: string, message?: string): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const text = `${code} ${message || ''}`.toLowerCase();

  if (!getGoogleClientId()) {
    return (
      'No Google Client ID configured. Create an OAuth Web Client under YOUR Google Cloud project ' +
      'and put the Client ID in google-oauth-config.json.'
    );
  }
  if (text.includes('origin') || text.includes('redirect_uri') || text.includes('unauthorized')) {
    return (
      `This website (${host || 'this domain'}) is not allowed for your OAuth client. ` +
      'In Google Cloud Console → Credentials → your Web client → Authorized JavaScript origins, add: ' +
      'https://pineflatsrvpark.com, https://www.pineflatsrvpark.com, https://pineflatsrv.com, and http://localhost:3000'
    );
  }
  if (text.includes('popup') || text.includes('blocked')) {
    return 'The Google sign-in popup was blocked. Allow popups for this site and try again.';
  }
  if (text.includes('access_denied')) {
    return 'Access was denied. Pick the Google account you want to use and allow Gmail, Calendar, Sheets, and Docs access.';
  }
  if (message && message.length > 10) return message;
  return code ? `Google sign-in error (${code}). ${message || ''}`.trim() : message || 'Google sign-in failed.';
}

/** @deprecated Use friendlyGoogleError — kept for older imports */
export const friendlyFirebaseError = friendlyGoogleError;

export const getAccessToken = async (): Promise<string | null> => cachedAccessToken;

/** Disconnect Google only (does not sign out of admin password session). */
export const logout = async () => {
  const token = cachedAccessToken;
  persistSession(null, null, null);
  if (token && typeof window !== 'undefined') {
    try {
      await loadGisScript();
      window.google?.accounts?.oauth2?.revoke(token, () => {});
    } catch {
      // ignore revoke failures
    }
  }
};

export const googleLogout = logout;

// --- GIS typings (minimal) ---
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (response: {
              access_token?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => { requestAccessToken: (overrideConfig?: { prompt?: string }) => void };
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}
