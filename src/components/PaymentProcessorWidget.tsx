import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Link2,
  PlugZap,
  RefreshCw,
  Save,
  Shield,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';

type ProviderId = 'none' | 'clover' | 'stripe' | 'square' | 'other';

interface ProcessorStatus {
  connected: boolean;
  ready: boolean;
  provider: ProviderId;
  enabled: boolean;
  testMode: boolean;
  displayName: string;
  publicKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  merchantId: string;
  notes: string;
  updatedAt?: string;
  message: string;
  availableProviders: Array<{ id: ProviderId; label: string; ready: boolean }>;
  secretFromEnv?: boolean;
  webhookFromEnv?: boolean;
}

interface ProcessorPayload {
  provider: ProviderId;
  enabled: boolean;
  testMode: boolean;
  displayName: string;
  publicKey: string;
  merchantId: string;
  notes: string;
  status: ProcessorStatus;
  secretKeySet: boolean;
  webhookSecretSet: boolean;
  secretFromEnv?: boolean;
  webhookFromEnv?: boolean;
}

const emptyForm = {
  provider: 'none' as ProviderId,
  enabled: false,
  testMode: true,
  displayName: '',
  publicKey: '',
  merchantId: '',
  notes: '',
  /** Write-only — never loaded from server. */
  secretKey: '',
  webhookSecret: '',
  clearSecretKey: false,
  clearWebhookSecret: false,
};

export function PaymentProcessorWidget() {
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState<ProcessorStatus | null>(null);
  const [secretKeySet, setSecretKeySet] = useState(false);
  const [webhookSecretSet, setWebhookSecretSet] = useState(false);
  const [secretFromEnv, setSecretFromEnv] = useState(false);
  const [webhookFromEnv, setWebhookFromEnv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/payment-processor');
      if (!res.ok) {
        setError('Could not load payment processor settings.');
        return;
      }
      const data: ProcessorPayload = await res.json();
      setForm(prev => ({
        ...prev,
        provider: data.provider || 'none',
        enabled: Boolean(data.enabled),
        testMode: data.testMode !== false,
        displayName: data.displayName || '',
        publicKey: data.publicKey || '',
        merchantId: data.merchantId || '',
        notes: data.notes || '',
        // never prefill secrets
        secretKey: '',
        webhookSecret: '',
        clearSecretKey: false,
        clearWebhookSecret: false,
      }));
      setStatus(data.status);
      setSecretKeySet(Boolean(data.secretKeySet));
      setWebhookSecretSet(Boolean(data.webhookSecretSet));
      setSecretFromEnv(Boolean(data.secretFromEnv));
      setWebhookFromEnv(Boolean(data.webhookFromEnv));
    } catch {
      setError('Network error loading payment processor settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      // Helpful defaults when picking Clover
      if (key === 'provider' && value === 'clover' && !prev.displayName) {
        next.displayName = 'Clover';
      }
      return next;
    });
    setSaved(false);
    setTestMsg(null);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    setTestMsg(null);
    try {
      const body: Record<string, unknown> = {
        provider: form.provider,
        enabled: form.provider === 'none' ? false : form.enabled,
        testMode: form.testMode,
        displayName: form.displayName.trim(),
        publicKey: form.publicKey.trim(),
        merchantId: form.merchantId.trim(),
        notes: form.notes.trim(),
      };
      if (form.clearSecretKey) body.clearSecretKey = true;
      else if (form.secretKey.trim()) body.secretKey = form.secretKey.trim();
      if (form.clearWebhookSecret) body.clearWebhookSecret = true;
      else if (form.webhookSecret.trim()) body.webhookSecret = form.webhookSecret.trim();

      const res = await apiFetch('/api/payment-processor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save processor settings.');
        return;
      }
      setForm(prev => ({
        ...prev,
        provider: data.provider || 'none',
        enabled: Boolean(data.enabled),
        testMode: data.testMode !== false,
        displayName: data.displayName || '',
        publicKey: data.publicKey || '',
        merchantId: data.merchantId || '',
        notes: data.notes || '',
        secretKey: '',
        webhookSecret: '',
        clearSecretKey: false,
        clearWebhookSecret: false,
      }));
      setStatus(data.status);
      setSecretKeySet(Boolean(data.secretKeySet));
      setWebhookSecretSet(Boolean(data.webhookSecretSet));
      setSecretFromEnv(Boolean(data.secretFromEnv));
      setWebhookFromEnv(Boolean(data.webhookFromEnv));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('Network error saving payment processor settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestMsg(null);
    setError(null);
    try {
      const res = await apiFetch('/api/payment-processor/test', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setTestMsg({
        ok: Boolean(data.ok),
        text: data.message || (data.ok ? 'Connection OK' : 'Connection failed'),
      });
      // Refresh status badges after test
      await load();
    } catch {
      setTestMsg({ ok: false, text: 'Network error testing connection.' });
    } finally {
      setTesting(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]';

  const badge = status?.ready
    ? { label: 'Ready', cls: 'bg-[#E8F0E8] text-[#3D5A3D] border-[#A8B2A6]' }
    : status?.connected
      ? { label: 'Connected · setup incomplete', cls: 'bg-amber-50 text-amber-900 border-amber-200' }
      : { label: 'Not connected', cls: 'bg-[#FBF9F7] text-[#5A6355] border-[#E2D9D0]' };

  const isClover = form.provider === 'clover';

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center shrink-0">
            <CreditCard className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">Payment processor</h3>
            <p className="text-xs text-[#5A6355] mt-1 max-w-2xl">
              Connect <strong>Clover</strong> so card charges run on Clover — not stored as full
              card numbers on this park site. Admin still records method “Card” and optional type +
              last 4 for renewals.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full border ${badge.cls}`}
          >
            {badge.label}
          </span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 text-xs font-semibold text-[#5A6355] border border-[#E2D9D0] px-3 py-2 rounded-xl hover:bg-[#FBF9F7]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {status && (
        <p className="text-sm text-[#3D3730] bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl px-3 py-2 flex items-start gap-2">
          <Link2 className="w-4 h-4 shrink-0 mt-0.5 text-[#5A6355]" />
          <span>{status.message}</span>
        </p>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Payment processor settings saved.
        </p>
      )}
      {testMsg && (
        <p
          className={`text-sm rounded-xl px-3 py-2 flex items-start gap-2 border ${
            testMsg.ok
              ? 'text-[#3D5A3D] bg-[#E8F0E8] border-[#A8B2A6]'
              : 'text-red-700 bg-red-50 border-red-200'
          }`}
        >
          {testMsg.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{testMsg.text}</span>
        </p>
      )}

      {isClover && (
        <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] px-4 py-3 space-y-2 text-xs text-[#5A6355]">
          <p className="font-semibold text-[#3D3730] text-sm">Clover setup (admin)</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              Log in to your Clover merchant account or{' '}
              <a
                href="https://www.clover.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-[#C29474] font-semibold hover:underline"
              >
                Clover Dashboard
              </a>
              .
            </li>
            <li>
              Copy your <strong>Merchant ID</strong> (mId) from Account &amp; Setup → Business
              information (or the developer app install).
            </li>
            <li>
              Create or open a Clover app and generate a <strong>private API token / OAuth access
              token</strong> with payments permissions. Paste it below (never shared back after
              save).
            </li>
            <li>
              Required for website card checkout: Ecommerce <strong>PAKMS / public API key</strong>{' '}
              from Clover Ecommerce setup.
            </li>
            <li>
              Save → <strong>Test connection</strong> → Enable → turn off Test mode when going live.
            </li>
          </ol>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[#5A6355]">Provider</span>
            <select
              value={form.provider}
              onChange={e => update('provider', e.target.value as ProviderId)}
              className={inputCls}
            >
              {(status?.availableProviders ?? [
                { id: 'none' as ProviderId, label: 'None (manual payments only)' },
                { id: 'clover' as ProviderId, label: 'Clover' },
                { id: 'stripe' as ProviderId, label: 'Stripe (coming soon)' },
                { id: 'square' as ProviderId, label: 'Square (coming soon)' },
                { id: 'other' as ProviderId, label: 'Other / custom (coming soon)' },
              ]).map(p => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[#5A6355]">
              Display name (optional)
            </span>
            <input
              value={form.displayName}
              onChange={e => update('displayName', e.target.value)}
              className={inputCls}
              placeholder={isClover ? 'e.g. Park Clover terminal' : 'e.g. Park card account'}
            />
          </label>

          <label className="block space-y-1 sm:col-span-2">
            <span className="text-[10px] uppercase tracking-widest text-[#5A6355]">
              {isClover
                ? 'Public / PAKMS Ecommerce key (optional until online card entry)'
                : 'Public / publishable key'}
            </span>
            <input
              value={form.publicKey}
              onChange={e => update('publicKey', e.target.value)}
              className={inputCls}
              placeholder={
                isClover
                  ? 'apiAccessKey from Clover PAKMS (safe to store here)'
                  : 'pk_… or application id — safe to store here'
              }
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[#5A6355]">
              {isClover ? 'Merchant ID (required)' : 'Merchant / location ID'}
            </span>
            <input
              value={form.merchantId}
              onChange={e => update('merchantId', e.target.value)}
              className={inputCls}
              placeholder={isClover ? 'Clover mId (merchant UUID)' : 'Optional'}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[#5A6355]">Notes</span>
            <input
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
              className={inputCls}
              placeholder="Who owns the Clover account, login email, etc."
            />
          </label>

          {form.provider !== 'none' && (
            <>
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-[10px] uppercase tracking-widest text-[#5A6355]">
                  {isClover
                    ? `Private API token / access token ${secretKeySet ? '(saved — leave blank to keep)' : '(required)'}`
                    : `Secret / private key ${secretKeySet ? '(saved — leave blank to keep)' : ''}`}
                </span>
                <input
                  type="password"
                  value={form.secretKey}
                  onChange={e => {
                    const v = e.target.value;
                    setForm(prev => ({
                      ...prev,
                      secretKey: v,
                      clearSecretKey: v ? false : prev.clearSecretKey,
                    }));
                    setSaved(false);
                    setTestMsg(null);
                  }}
                  className={inputCls}
                  placeholder={
                    secretKeySet
                      ? secretFromEnv
                        ? 'Set via server env (PAYMENT_PROCESSOR_SECRET_KEY)'
                        : '••••••••  (enter new token to replace)'
                      : isClover
                        ? 'Paste Clover private API / OAuth access token'
                        : 'Paste private key'
                  }
                  autoComplete="new-password"
                  spellCheck={false}
                />
                {secretKeySet && !secretFromEnv && (
                  <label className="mt-1 flex items-center gap-2 text-xs text-[#5A6355] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.clearSecretKey}
                      onChange={e => update('clearSecretKey', e.target.checked)}
                      className="rounded border-[#E2D9D0]"
                    />
                    Clear saved private token
                  </label>
                )}
              </label>

              <label className="block space-y-1 sm:col-span-2">
                <span className="text-[10px] uppercase tracking-widest text-[#5A6355]">
                  Webhook secret (optional)
                  {webhookSecretSet ? ' — saved' : ''}
                </span>
                <input
                  type="password"
                  value={form.webhookSecret}
                  onChange={e => {
                    const v = e.target.value;
                    setForm(prev => ({
                      ...prev,
                      webhookSecret: v,
                      clearWebhookSecret: v ? false : prev.clearWebhookSecret,
                    }));
                    setSaved(false);
                    setTestMsg(null);
                  }}
                  className={inputCls}
                  placeholder={
                    webhookSecretSet
                      ? webhookFromEnv
                        ? 'Set via server env'
                        : '••••••••  (enter new to replace)'
                      : 'Optional signing secret'
                  }
                  autoComplete="new-password"
                  spellCheck={false}
                />
              </label>
            </>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <label className="flex items-center gap-2 text-sm text-[#3D3730] cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled && form.provider !== 'none'}
              disabled={form.provider === 'none'}
              onChange={e => update('enabled', e.target.checked)}
              className="rounded border-[#E2D9D0]"
            />
            Enable Clover charges when credentials are ready
          </label>
          <label className="flex items-center gap-2 text-sm text-[#3D3730] cursor-pointer">
            <input
              type="checkbox"
              checked={form.testMode}
              onChange={e => update('testMode', e.target.checked)}
              className="rounded border-[#E2D9D0]"
            />
            Test / sandbox mode
          </label>
        </div>

        <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#3D3730]">
            <Shield className="w-3.5 h-3.5 text-[#5A6355]" />
            Security
          </div>
          <ul className="text-xs text-[#5A6355] space-y-1 list-disc pl-5">
            <li>
              Private token:{' '}
              {secretKeySet
                ? secretFromEnv
                  ? 'set on server environment'
                  : 'saved on server (encrypted at rest only as file under data/)'
                : 'not set yet'}
            </li>
            <li>
              Webhook secret: {webhookSecretSet ? (webhookFromEnv ? 'from env' : 'saved') : 'not set'}
            </li>
            <li>
              Webhook URL:{' '}
              <code className="text-[11px] bg-white px-1 rounded border border-[#E2D9D0]">
                /api/payment-processor/webhook
              </code>
            </li>
            <li>
              Online booking uses the <strong>Clover Hosted iframe</strong> — card numbers never
              touch the park website or server (required by Clover Data Security Manager / PCI).
            </li>
            <li>
              Only brand + last 4 may be kept as a staff reference; full PAN/CVV stay with Clover.
            </li>
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || loading}
            className="flex items-center gap-2 bg-[#5A6355] text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save connection'}
          </button>
          {isClover && (
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || loading || saving}
              className="flex items-center gap-2 border border-[#5A6355] text-[#5A6355] px-5 py-3 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] disabled:opacity-50"
            >
              {testing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <PlugZap className="w-4 h-4" />
              )}
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          )}
          {isClover && (
            <a
              href="https://docs.clover.com/dev/docs/ecommerce-api-payments-flow"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold text-[#C29474] hover:underline"
            >
              Clover Ecommerce docs
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {form.provider === 'stripe' && (
            <a
              href="https://dashboard.stripe.com/apikeys"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold text-[#C29474] hover:underline"
            >
              Stripe API keys
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {form.provider === 'square' && (
            <a
              href="https://developer.squareup.com/apps"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold text-[#C29474] hover:underline"
            >
              Square Developer
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </form>
    </div>
  );
}
