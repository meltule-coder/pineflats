import { useEffect, useState } from 'react';
import { MessageSquare, Save, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';

type SmsStatus = {
  enabled: boolean;
  configured: boolean;
  alertTo: string;
  accountSid: string;
  fromNumber: string;
  hasAuthToken: boolean;
  source: 'config' | 'env' | 'none';
};

const EMPTY: SmsStatus = {
  enabled: true,
  configured: false,
  alertTo: '',
  accountSid: '',
  fromNumber: '',
  hasAuthToken: false,
  source: 'none',
};

/**
 * Twilio SMS alerts for new online bookings.
 */
export function SmsSettingsWidget() {
  const [form, setForm] = useState(EMPTY);
  const [authToken, setAuthToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiFetch('/api/sms/status');
      if (res.ok) {
        const data = (await res.json()) as SmsStatus;
        setForm({ ...EMPTY, ...data });
      }
    } catch {
      setError('Could not load SMS settings.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch('/api/sms/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: form.enabled,
          alertTo: form.alertTo,
          accountSid: form.accountSid,
          fromNumber: form.fromNumber,
          ...(authToken.trim() ? { authToken: authToken.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save SMS settings');
        return;
      }
      setForm({ ...EMPTY, ...data });
      setAuthToken('');
      setMessage(
        data.configured
          ? 'SMS saved. You will get a text when someone books online.'
          : 'Saved — still need phone number, Twilio SID, auth token, and From number.'
      );
    } catch {
      setError('Network error saving SMS settings.');
    } finally {
      setLoading(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      if (authToken.trim() || !form.configured) {
        const saveRes = await apiFetch('/api/sms/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            alertTo: form.alertTo,
            accountSid: form.accountSid,
            fromNumber: form.fromNumber,
            ...(authToken.trim() ? { authToken: authToken.trim() } : {}),
          }),
        });
        if (saveRes.ok) {
          const data = await saveRes.json();
          setForm({ ...EMPTY, ...data });
          setAuthToken('');
        }
      }
      const res = await apiFetch('/api/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: form.alertTo || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data.ok === false && data.mode === 'twilio')) {
        setError(data.error || 'Test SMS failed. Check Twilio SID, token, and phone numbers.');
        return;
      }
      if (data.mode === 'log') {
        setMessage(
          'SMS not fully configured yet — message was logged only. Add Twilio credentials and your cell number.'
        );
        return;
      }
      setMessage(`Test SMS sent to ${data.to}. Check your phone.`);
    } catch {
      setError('Network error sending test SMS.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">SMS booking alerts</h3>
            <p className="text-xs text-[#5A6355] mt-0.5">
              Get a text when a guest books online (Twilio).
            </p>
          </div>
        </div>
        <div
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${
            form.configured
              ? 'bg-[#E8F0E8] border-[#A8B2A6] text-[#3D5A3D]'
              : 'bg-[#F5E6DC] border-[#C29474] text-[#6B4A32]'
          }`}
        >
          {form.configured ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" /> Live
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5" /> Not configured
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">
            Your cell (gets the alert)
          </label>
          <input
            value={form.alertTo}
            onChange={(e) => setForm((p) => ({ ...p, alertTo: e.target.value }))}
            placeholder="+15415551212"
            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">
            Twilio Account SID
          </label>
          <input
            value={form.accountSid}
            onChange={(e) => setForm((p) => ({ ...p, accountSid: e.target.value }))}
            placeholder="ACxxxxxxxx…"
            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">
            Auth token {form.hasAuthToken ? '(saved — leave blank to keep)' : ''}
          </label>
          <input
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder={form.hasAuthToken ? '••••••••' : 'Twilio auth token'}
            autoComplete="new-password"
            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">
            Twilio From number
          </label>
          <input
            value={form.fromNumber}
            onChange={(e) => setForm((p) => ({ ...p, fromNumber: e.target.value }))}
            placeholder="+1… (your Twilio number)"
            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-[#3D3730]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
            />
            Enable SMS alerts for online bookings
          </label>
        </div>
      </div>

      <p className="text-xs text-[#5A6355] leading-relaxed">
        Free trial at{' '}
        <a
          href="https://www.twilio.com/try-twilio"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#C29474] font-semibold hover:underline"
        >
          twilio.com
        </a>
        . Use numbers in <strong>+1…</strong> format. Message example: guest name, site, dates, total.
      </p>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-2">{error}</p>
      )}
      {message && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#C5D9C5] rounded-xl px-4 py-2">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading}
          className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] transition disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {loading ? 'Saving…' : 'Save SMS'}
        </button>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={testing}
          className="flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5C] transition disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
          {testing ? 'Sending…' : 'Save & send test text'}
        </button>
      </div>
    </div>
  );
}
