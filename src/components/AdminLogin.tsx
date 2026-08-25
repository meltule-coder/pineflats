import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, Lock, LogIn, Mail } from 'lucide-react';

type Mode = 'login' | 'forgot' | 'reset';

export function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('p***@…');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/admin/recovery-info', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.recoveryEmailMasked) setMaskedEmail(data.recoveryEmailMasked);
      })
      .catch(() => {});
  }, []);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      onSuccess();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/admin/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: recoveryEmail.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not send recovery code');
        return;
      }
      setInfo(data.message || 'If that email matches, a recovery code was sent.');
      setMode('reset');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    if (newPassword.trim().length < 12) {
      setError('New password must be at least 12 characters.');
      setLoading(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: recoveryEmail.trim(),
          code: recoveryCode.trim(),
          newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not reset password');
        return;
      }
      setInfo(data.message || 'Password updated. Sign in with your new password.');
      setPassword(newPassword);
      setMode('login');
      setRecoveryCode('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]';

  return (
    <div className="min-h-screen bg-[#F7F3F0] font-sans text-[#3D3730] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-[32px] border border-[#E2D9D0] shadow-sm p-8 space-y-6">
        <div className="flex flex-col items-center text-center gap-3">
          <img
            src="/logo.png?v=4"
            alt="Pine Flats RV Park"
            className="h-32 w-auto max-w-[240px] object-contain rounded-2xl shadow-sm"
          />
          <div>
            <h1 className="text-2xl font-serif italic text-[#5A6355] font-bold">Admin Page</h1>
            <p className="text-sm text-[#5A6355] mt-1">
              {mode === 'login' && 'Sign in to manage sites, bookings, photos, and settings.'}
              {mode === 'forgot' && 'Request a one-time code to your backup recovery email.'}
              {mode === 'reset' && 'Enter the code from your email and choose a new password.'}
            </p>
          </div>
        </div>

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
                <Lock className="w-3.5 h-3.5" />
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Admin password"
                  autoComplete="current-password"
                  autoFocus
                  className={`${inputCls} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#5A6355] hover:text-[#3D3730]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {error}
              </p>
            )}
            {info && (
              <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
            >
              <LogIn className="w-4 h-4" />
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setError(null);
                setInfo(null);
              }}
              className="w-full text-sm font-semibold text-[#C29474] hover:underline"
            >
              Forgot password? Recover with backup email
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-xs text-[#5A6355] bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl px-3 py-2">
              Backup recovery email on file: <strong className="text-[#3D3730]">{maskedEmail}</strong>
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
                <Mail className="w-3.5 h-3.5" />
                Backup email
              </label>
              <input
                type="email"
                value={recoveryEmail}
                onChange={e => setRecoveryEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                required
                className={inputCls}
              />
            </div>
            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {error}
              </p>
            )}
            {info && (
              <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2">
                {info}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !recoveryEmail.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[#5A6355] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
            >
              <Mail className="w-4 h-4" />
              {loading ? 'Sending…' : 'Send recovery code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('reset');
                setError(null);
                setInfo('Enter the code from your email (or recovery file), then set a new password.');
              }}
              className="w-full text-sm font-semibold text-[#5A6355] hover:underline"
            >
              I already have a code
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setInfo(null);
              }}
              className="w-full text-sm text-[#5A6355] hover:underline"
            >
              Back to sign in
            </button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleReset} className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
                <Mail className="w-3.5 h-3.5" />
                Backup email
              </label>
              <input
                type="email"
                value={recoveryEmail}
                onChange={e => setRecoveryEmail(e.target.value)}
                className={inputCls}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#5A6355]">
                <KeyRound className="w-3.5 h-3.5" />
                Recovery code
              </label>
              <input
                value={recoveryCode}
                onChange={e => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                inputMode="numeric"
                maxLength={6}
                className={`${inputCls} font-mono tracking-[0.3em] text-center text-lg`}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">New password</label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  className={`${inputCls} pr-12`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#5A6355]"
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-[#5A6355]">Confirm new password</label>
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                className={inputCls}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {error}
              </p>
            )}
            {info && (
              <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2">
                {info}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-[#C29474] text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#A87A5C] disabled:opacity-50"
            >
              <KeyRound className="w-4 h-4" />
              {loading ? 'Updating…' : 'Set new password'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setInfo(null);
              }}
              className="w-full text-sm text-[#5A6355] hover:underline"
            >
              Back to sign in
            </button>
          </form>
        )}

        <p className="text-[11px] text-center text-[#5A6355]/80">
          Public website stays open at the main site URL — only this admin area is locked.
        </p>
      </div>
    </div>
  );
}
