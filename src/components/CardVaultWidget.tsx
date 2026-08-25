import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Plus, RefreshCw, Search, Trash2, UserCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { PaymentCardRef, Tenant } from '../../types';

const BRANDS = ['Visa', 'Mastercard', 'Amex', 'Discover', 'Card'] as const;

export function CardVaultWidget() {
  const [cards, setCards] = useState<PaymentCardRef[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    guestName: '',
    guestEmail: '',
    guestPhone: '',
    brand: 'Visa',
    last4: '',
  });
  const [applyTenantId, setApplyTenantId] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : '';
      const [cRes, tRes] = await Promise.all([
        apiFetch(`/api/card-refs${q}`),
        apiFetch('/api/tenants'),
      ]);
      if (cRes.status === 401) {
        setError('Admin session expired. Sign in again.');
        return;
      }
      if (cRes.ok) {
        const data = await cRes.json();
        setCards(Array.isArray(data.cards) ? data.cards : []);
      } else {
        setError('Could not load card references.');
      }
      if (tRes.ok) {
        const list = await tRes.json();
        setTenants(Array.isArray(list) ? list : []);
      }
    } catch {
      setError('Network error loading card vault.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSync = async () => {
    setLoading(true);
    setNote(null);
    setError(null);
    try {
      const res = await apiFetch('/api/card-refs/sync', { method: 'POST' });
      if (!res.ok) {
        setError('Could not sync cards from tenants.');
        return;
      }
      const data = await res.json();
      setNote(
        data.added
          ? `Synced ${data.added} new card reference(s) from tenant payments.`
          : 'Vault already has card references from current tenants.'
      );
      await load();
    } catch {
      setError('Network error during sync.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    const last4 = form.last4.replace(/\D/g, '').slice(-4);
    if (!form.guestName.trim()) {
      setError('Guest name is required.');
      return;
    }
    if (last4.length !== 4) {
      setError('Enter the last 4 digits of the card.');
      return;
    }
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const res = await apiFetch('/api/card-refs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName: form.guestName.trim(),
          guestEmail: form.guestEmail.trim() || undefined,
          guestPhone: form.guestPhone.trim() || undefined,
          brand: form.brand,
          last4,
          source: 'manual',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not save card reference.');
        return;
      }
      const data = await res.json();
      setNote(`Saved ${data.label || `${form.brand} •••• ${last4}`} for renewals.`);
      setForm({ guestName: '', guestEmail: '', guestPhone: '', brand: 'Visa', last4: '' });
      setShowAdd(false);
      await load();
    } catch {
      setError('Network error saving card.');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (cardId: string) => {
    const tenantId = applyTenantId[cardId];
    if (!tenantId) {
      setError('Select a tenant to apply this card for renewal.');
      return;
    }
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const res = await apiFetch(`/api/card-refs/${encodeURIComponent(cardId)}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not apply card to tenant.');
        return;
      }
      setNote(data.message || `Applied ${data.label} for tenant renewals.`);
      await load();
    } catch {
      setError('Network error applying card.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (card: PaymentCardRef) => {
    if (card.id.startsWith('tenant-')) {
      setError('Remove tenant-only cards from that tenant’s payment page.');
      return;
    }
    if (!window.confirm(`Remove ${card.brand} •••• ${card.last4} for ${card.guestName}?`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/card-refs/${encodeURIComponent(card.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not delete card reference.');
        return;
      }
      setNote('Card reference removed from vault.');
      await load();
    } catch {
      setError('Network error deleting card.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center shrink-0">
            <CreditCard className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h3 className="text-sm font-serif text-[#3D3730]">Card vault · renewals</h3>
            <p className="text-xs text-[#5A6355] mt-1 max-w-2xl">
              View every saved card reference (type + last 4 only). Use them for monthly tenant renewals
              or any customer who books another stay. Full card numbers are never stored here.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={loading}
            className="flex items-center gap-2 border border-[#E2D9D0] text-[#5A6355] bg-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Sync from tenants
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730]"
          >
            <Plus className="w-4 h-4" />
            Add card ref
          </button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#A8B2A6]" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, site, brand, last 4…"
          className="w-full pl-9 pr-3 py-2.5 bg-[#FBF9F7] border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
        />
      </div>

      {showAdd && (
        <div className="rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] p-4 space-y-3">
          <p className="text-xs text-[#5A6355]">
            Staff reference only: card type and last 4 digits. Charge the real card on your terminal or processor.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1 sm:col-span-2 lg:col-span-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Guest name *</label>
              <input
                value={form.guestName}
                onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))}
                className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm"
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Email</label>
              <input
                value={form.guestEmail}
                onChange={e => setForm(f => ({ ...f, guestEmail: e.target.value }))}
                className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm"
                placeholder="optional"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Phone</label>
              <input
                value={form.guestPhone}
                onChange={e => setForm(f => ({ ...f, guestPhone: e.target.value }))}
                className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm"
                placeholder="optional"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Card type *</label>
              <select
                value={form.brand}
                onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm"
              >
                {BRANDS.map(b => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Last 4 digits *</label>
              <input
                value={form.last4}
                onChange={e => setForm(f => ({ ...f, last4: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                inputMode="numeric"
                maxLength={4}
                placeholder="4242"
                className="w-full px-3 py-2.5 bg-white border border-[#E2D9D0] rounded-xl text-sm font-mono tracking-widest"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={loading}
            className="flex items-center gap-2 bg-[#C29474] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#A87A5C] disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Save for renewals
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
      )}
      {note && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2">{note}</p>
      )}

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E2D9D0] px-4 py-10 text-center text-sm text-[#5A6355]">
          No card references yet. Save type + last 4 when recording a payment, or add one above.
          Then apply it to any tenant renewing their stay.
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map(card => (
            <div
              key={card.id}
              className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-2xl border border-[#E2D9D0] bg-[#FBF9F7] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#3D3730] font-mono tracking-wide">
                  {card.brand} •••• {card.last4}
                </p>
                <p className="text-xs text-[#5A6355] mt-0.5">
                  {card.guestName}
                  {card.site ? ` · Site ${card.site}` : ''}
                  {card.guestEmail ? ` · ${card.guestEmail}` : ''}
                  {card.guestPhone ? ` · ${card.guestPhone}` : ''}
                </p>
                <p className="text-[10px] text-[#A8B2A6] mt-0.5">
                  {card.source || 'vault'} · {card.updatedAt || card.createdAt}
                  {card.id.startsWith('tenant-') ? ' · on tenant record' : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={applyTenantId[card.id] || ''}
                  onChange={e =>
                    setApplyTenantId(prev => ({ ...prev, [card.id]: e.target.value }))
                  }
                  className="px-3 py-2 bg-white border border-[#E2D9D0] rounded-xl text-xs max-w-[200px]"
                >
                  <option value="">Apply to tenant…</option>
                  {[...tenants]
                    .sort((a, b) => Number(a.site) - Number(b.site))
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        Site {t.site} · {t.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleApply(card.id)}
                  disabled={loading || !applyTenantId[card.id]}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#5A6355] text-white hover:bg-[#3D3730] disabled:opacity-50"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  Use for renewal
                </button>
                {!card.id.startsWith('tenant-') && (
                  <button
                    type="button"
                    onClick={() => handleDelete(card)}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
