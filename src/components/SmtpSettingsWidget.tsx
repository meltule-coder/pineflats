import { useEffect, useState } from 'react';
import { Mail, Save, Send, Server, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';

type SmtpStatus = {
  enabled: boolean;
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  parkNotifyEmail: string;
  hasPassword: boolean;
  source: 'config' | 'env' | 'none';
};

const EMPTY: SmtpStatus = {
  enabled: true,
  configured: false,
  host: 'smtp-mail.outlook.com',
  port: 587,
  secure: false,
  user: '',
  from: '',
  parkNotifyEmail: '',
  hasPassword: false,
  source: 'none',
};

/**
 * Admin form to turn on live receipt email (SMTP).
 * Prefills Outlook/Hotmail-friendly defaults for pineflatsrvpark@hotmail.com.
 */
export function SmtpSettingsWidget() {
  const [form, setForm] = useState(EMPTY);
  const [pass, setPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiFetch('/api/email/smtp');
      if (res.ok) {
        const data = (await res.json()) as SmtpStatus;
        setForm({
          ...EMPTY,
          ...data,
          host: data.host || EMPTY.host,
          port: data.port || 587,
        });
      }
    } catch {
      setError('Could not load email settings.');
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
      const res = await apiFetch('/api/email/smtp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: form.enabled,
          host: form.host,
          port: form.port,
          secure: form.secure || form.port === 465,
          user: form.user,
          from: form.from,
          parkNotifyEmail: form.parkNotifyEmail,
          ...(pass.trim() ? { pass: pass.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save SMTP settings');
        return;
      }
      setForm({ ...EMPTY, ...data });
      setPass('');
      setMessage(
        data.configured
          ? 'SMTP saved and active. Receipt emails will send when customers pay.'
          : 'Saved, but not fully configured yet — enter host, user, and password.'
      );
    } catch {
      setError('Network error saving SMTP settings.');
    } finally {
      setLoading(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      // Save first so test uses latest form values (including new password)
      if (pass.trim() || !form.configured) {
        const saveRes = await apiFetch('/api/email/smtp', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            host: form.host,
            port: form.port,
            secure: form.secure || form.port === 465,
            user: form.user,
            from: form.from,
            parkNotifyEmail: form.parkNotifyEmail,
            ...(pass.trim() ? { pass: pass.trim() } : {}),
          }),
        });
        if (saveRes.ok) {
          const data = await saveRes.json();
          setForm({ ...EMPTY, ...data });
          setPass('');
        }
      }
      const res = await apiFetch('/api/email/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: form.parkNotifyEmail || form.user || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(
          data.error ||
            'Test email failed. Check host/user/password (Hotmail needs an app password if 2FA is on).'
        );
        return;
      }
      if (data.mode === 'log') {
        setMessage(
          'SMTP is still not configured — message was logged only. Enter password and save.'
        );
        return;
      }
      setMessage(`Test email sent to ${data.to}. Check that inbox (and spam).`);
    } catch {
      setError('Network error sending test email.');
    } finally {
      setTesting(false);
    }
  };

  const fillHotmailDefaults = () => {
    setForm((prev) => ({
      ...prev,
      host: 'smtp-mail.outlook.com',
      port: 587,
      secure: false,
      user: prev.user || 'pineflatsrvpark@hotmail.com',
      parkNotifyEmail: prev.parkNotifyEmail || 'pineflatsrvpark@hotmail.com',
      from: prev.from || 'Pine Flats RV Park <pineflatsrvpark@hotmail.com>',
      enabled: true,
    }));
    setMessage('Filled Outlook/Hotmail defaults. Enter the email password (or app password), then Save & Test.');
  };

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center">
            <Server className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">Email / SMTP (live receipts)</h3>
            <p className="text-xs text-[#5A6355] mt-0.5">
              Send payment and booking receipts to customers as soon as they pay.
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

      <button
        type="button"
        onClick={fillHotmailDefaults}
        className="text-xs font-semibold text-[#C29474] hover:underline"
      >
        Use Hotmail/Outlook defaults (pineflatsrvpark@hotmail.com)
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">SMTP host</label>
          <input
            value={form.host}
            onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))}
            placeholder="smtp-mail.outlook.com"
            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Port</label>
          <input
            type="number"
            value={form.port}
            onChange={(e) => setForm((p) => ({ ...p, port: Number(e.target.value) || 587 }))}
            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1.5 flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-[#3D3730]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
            />
            Enable live email
          </label>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">SMTP username (email)</label>
          <input
            value={form.user}
            onChange={(e) => setForm((p) => ({ ...p, user: e.target.value }))}
            placeholder="pineflatsrvpark@hotmail.com"
            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">
            Password / app password {form.hasPassword ? '(saved — leave blank to keep)' : ''}
          </label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={form.hasPassword ? '••••••••' : 'Email or app password'}
            autoComplete="new-password"
            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">From address</label>
          <input
            value={form.from}
            onChange={(e) => setForm((p) => ({ ...p, from: e.target.value }))}
            placeholder='Pine Flats RV Park &lt;pineflatsrvpark@hotmail.com&gt;'
            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">
            Park notify email (office copy of every receipt)
          </label>
          <input
            value={form.parkNotifyEmail}
            onChange={(e) => setForm((p) => ({ ...p, parkNotifyEmail: e.target.value }))}
            placeholder="pineflatsrvpark@hotmail.com"
            className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
      </div>

      <p className="text-xs text-[#5A6355] leading-relaxed">
        <Mail className="w-3.5 h-3.5 inline mr-1" />
        Customer receipts go to the email on the tenant/booking. Park copies go to the notify address above.
        For Hotmail with 2-step verification, create an{' '}
        <strong>app password</strong> at account.microsoft.com and paste it here.
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
          {loading ? 'Saving…' : 'Save SMTP'}
        </button>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={testing}
          className="flex items-center gap-2 bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5C] transition disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
          {testing ? 'Sending…' : 'Save & send test email'}
        </button>
      </div>
    </div>
  );
}
