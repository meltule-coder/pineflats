/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { ChatWidget } from './components/ChatWidget';
import { CalendarWidget } from './components/CalendarWidget';
import { SitesWidget } from './components/SitesWidget';
import { PhotosWidget } from './components/PhotosWidget';
import { ContactWidget } from './components/ContactWidget';
import { CustomersWidget } from './components/CustomersWidget';
import { WebsitePreviewWidget } from './components/WebsitePreviewWidget';
import { CommentsAdminWidget } from './components/CommentsAdminWidget';
import { PropertiesWidget } from './components/PropertiesWidget';
import { TenantDetailPage } from './components/TenantDetailPage';
import { TenantPaymentPage } from './components/TenantPaymentPage';
import { TenantReceiptPage } from './components/TenantReceiptPage';
import { AddTenantWidget } from './components/AddTenantWidget';
import { AdminLogin } from './components/AdminLogin';
import { TaxQuarterlyWidget } from './components/TaxQuarterlyWidget';
import { RevenueMonthlyWidget } from './components/RevenueMonthlyWidget';
import { GuestReceiptsWidget } from './components/GuestReceiptsWidget';
import { PhoneReservationWidget } from './components/PhoneReservationWidget';
import { PaymentProcessorWidget } from './components/PaymentProcessorWidget';
import { CardVaultWidget } from './components/CardVaultWidget';
import { ReceiptGeneratorWidget } from './components/ReceiptGeneratorWidget';
import { SmsSettingsWidget } from './components/SmsSettingsWidget';
import { GoogleConnectWidget } from './components/GoogleConnectWidget';
import { PreviousTenantsWidget } from './components/PreviousTenantsWidget';
import { Users, Image as ImageIcon, Search, Calendar as CalendarIcon, Grid3x3, ChevronRight, DollarSign, Settings, Building2, LogOut, KeyRound, X, Eye, EyeOff } from 'lucide-react';
import { Tenant, Photo } from '../types';

type AppTab = 'tenants' | 'sites' | 'photos' | 'calendar' | 'properties' | 'reports' | 'settings';

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('calendar');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [tenantView, setTenantView] = useState<'info' | 'payment' | 'receipt'>('info');
  const [highlightPaymentId, setHighlightPaymentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwRecoveryEmail, setPwRecoveryEmail] = useState('');
  const [pwShow, setPwShow] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const loadData = async () => {
    try {
      const [tRes, pRes] = await Promise.all([
        fetch('/api/tenants', { credentials: 'include' }),
        fetch('/api/photos', { credentials: 'include' }),
      ]);
      if (tRes.status === 401 || pRes.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (tRes.ok) setTenants(await tRes.json());
      if (pRes.ok) setPhotos(await pRes.json());
    } catch (e) {
      console.error(e);
    }
  };

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/admin/status', { credentials: 'include' });
      if (!res.ok) {
        setAuthenticated(false);
        return;
      }
      const data = await res.json();
      setAuthenticated(!!data.authenticated);
    } catch {
      setAuthenticated(false);
    } finally {
      setAuthChecked(true);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    setAuthenticated(false);
    setTenants([]);
    setPhotos([]);
    setSelectedTenantId(null);
  };

  const openChangePassword = () => {
    setPwCurrent('');
    setPwNew('');
    setPwConfirm('');
    setPwShow(false);
    setPwError(null);
    setPwSuccess(null);
    setShowChangePassword(true);
    void fetch('/api/admin/recovery-email', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.recoveryEmail) setPwRecoveryEmail(data.recoveryEmail);
      })
      .catch(() => {});
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);
    if (pwNew.trim().length < 12) {
      setPwError('New password must be at least 12 characters.');
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError('New passwords do not match.');
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch('/api/admin/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: pwCurrent,
          newPassword: pwNew,
          recoveryEmail: pwRecoveryEmail.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(data.error || 'Could not change password');
        return;
      }
      setPwSuccess(
        data.recoveryEmailMasked
          ? `Password updated. Backup recovery email: ${data.recoveryEmailMasked}`
          : 'Password updated.'
      );
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      setTimeout(() => {
        setShowChangePassword(false);
        setPwSuccess(null);
      }, 2000);
    } catch {
      setPwError('Network error — try again.');
    } finally {
      setPwSaving(false);
    }
  };

  useEffect(() => {
    checkAuth();
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (
      tab === 'sites'
      || tab === 'tenants'
      || tab === 'photos'
      || tab === 'calendar'
      || tab === 'properties'
      || tab === 'reports'
      || tab === 'settings'
    ) {
      setActiveTab(tab);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadData();
  }, [authenticated]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#F7F3F0] flex items-center justify-center text-[#5A6355] text-sm">
        Checking sign-in…
      </div>
    );
  }

  if (!authenticated) {
    return (
      <AdminLogin
        onSuccess={() => {
          setAuthenticated(true);
        }}
      />
    );
  }

  const navTabs: { id: AppTab; label: string; icon: typeof CalendarIcon }[] = [
    { id: 'calendar', label: 'Bookings', icon: CalendarIcon },
    { id: 'sites', label: 'Sites', icon: Grid3x3 },
    { id: 'tenants', label: 'Tenants', icon: Users },
    { id: 'photos', label: 'Media', icon: ImageIcon },
    { id: 'properties', label: 'Properties', icon: Building2 },
    { id: 'reports', label: 'Reports', icon: DollarSign },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#F7F3F0] font-sans selection:bg-[#E2D9D0] text-[#3D3730] flex flex-col">
      {/* Top nav: logo + main tabs + account actions */}
      <header className="sticky top-0 z-40 bg-[#F7F3F0]/95 backdrop-blur-sm border-b border-[#E2D9D0] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src="/logo.png?v=4"
                alt="Pine Flats RV Park"
                className="h-12 sm:h-16 w-auto max-w-[120px] sm:max-w-[160px] object-contain object-left rounded-xl shadow-sm shrink-0"
              />
              <h1 className="text-lg sm:text-2xl font-serif italic text-[#5A6355] font-bold truncate">
                Admin Page
              </h1>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 shrink-0">
              <button
                type="button"
                onClick={openChangePassword}
                className="flex items-center gap-2 text-sm font-semibold text-[#5A6355] border border-[#E2D9D0] bg-white px-3 py-2 rounded-xl hover:bg-[#FBF9F7] transition"
              >
                <KeyRound className="w-4 h-4" />
                <span className="hidden sm:inline">Change password</span>
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-2 text-sm font-semibold text-[#5A6355] border border-[#E2D9D0] bg-white px-3 py-2 rounded-xl hover:bg-[#FBF9F7] transition"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </div>

          <nav
            aria-label="Admin main navigation"
            className="flex flex-wrap gap-1.5 sm:gap-2 bg-[#EDE7E1] p-1.5 sm:p-2 rounded-2xl sm:rounded-3xl border border-[#E2D9D0]"
          >
            {navTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveTab(id);
                  if (id !== 'tenants') {
                    setSelectedTenantId(null);
                    setTenantView('info');
                  }
                }}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 text-sm font-medium transition-colors ${
                  activeTab === id
                    ? 'bg-[#5A6355] text-white rounded-xl sm:rounded-2xl'
                    : 'text-[#5A6355] hover:bg-[#E2D9D0] rounded-xl sm:rounded-2xl'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {showChangePassword && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-[28px] border border-[#E2D9D0] shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-serif text-[#3D3730]">Change admin password</h2>
              <button
                type="button"
                onClick={() => setShowChangePassword(false)}
                className="p-2 rounded-xl hover:bg-[#FBF9F7] text-[#5A6355]"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Current password</label>
                <div className="relative">
                  <input
                    type={pwShow ? 'text' : 'password'}
                    value={pwCurrent}
                    onChange={e => setPwCurrent(e.target.value)}
                    autoComplete="current-password"
                    className="w-full px-4 py-3 pr-12 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setPwShow(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#5A6355]"
                    aria-label={pwShow ? 'Hide password' : 'Show password'}
                  >
                    {pwShow ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">New password</label>
                <input
                  type={pwShow ? 'text' : 'password'}
                  value={pwNew}
                  onChange={e => setPwNew(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                  required
                  minLength={12}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Confirm new password</label>
                <input
                  type={pwShow ? 'text' : 'password'}
                  value={pwConfirm}
                  onChange={e => setPwConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                  required
                  minLength={12}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">
                  Backup recovery email
                </label>
                <input
                  type="email"
                  value={pwRecoveryEmail}
                  onChange={e => setPwRecoveryEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
                <p className="text-[11px] text-[#5A6355]">
                  Used if you get locked out — receive a one-time code to reset the password.
                </p>
              </div>
              {pwError && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{pwError}</p>
              )}
              {pwSuccess && (
                <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-xl px-3 py-2">{pwSuccess}</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="submit"
                  disabled={pwSaving}
                  className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
                >
                  <KeyRound className="w-4 h-4" />
                  {pwSaving ? 'Saving…' : 'Save password'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowChangePassword(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-[#E2D9D0] text-[#5A6355] hover:bg-[#FBF9F7]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col">
        {/* Tab Content */}
        {activeTab === 'tenants' && selectedTenantId && tenantView === 'payment' && (() => {
          const tenant = tenants.find(t => t.id === selectedTenantId);
          if (!tenant) return null;
          return (
            <TenantPaymentPage
              tenant={tenant}
              onBack={() => {
                setTenantView('info');
                void loadData();
              }}
              onViewReceipt={(paymentId) => {
                setHighlightPaymentId(paymentId ?? null);
                setTenantView('receipt');
              }}
            />
          );
        })()}

        {activeTab === 'tenants' && selectedTenantId && tenantView === 'receipt' && (() => {
          const tenant = tenants.find(t => t.id === selectedTenantId);
          if (!tenant) return null;
          return (
            <TenantReceiptPage
              tenant={tenant}
              highlightPaymentId={highlightPaymentId}
              onBack={() => {
                setHighlightPaymentId(null);
                setTenantView('payment');
              }}
            />
          );
        })()}

        {activeTab === 'tenants' && selectedTenantId && tenantView === 'info' && (() => {
          const tenant = tenants.find(t => t.id === selectedTenantId);
          if (!tenant) return null;
          return (
            <TenantDetailPage
              tenant={tenant}
              onBack={() => {
                setSelectedTenantId(null);
                setTenantView('info');
                setHighlightPaymentId(null);
                void loadData();
              }}
              onPayments={() => setTenantView('payment')}
              onViewReceipt={() => {
                setHighlightPaymentId(null);
                setTenantView('receipt');
              }}
              onSave={async (updates) => {
                const res = await fetch(`/api/tenants/${tenant.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(updates),
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  throw new Error(data.error || 'Failed to save tenant');
                }
                await loadData();
              }}
              onRemove={async () => {
                const res = await fetch(`/api/tenants/${tenant.id}`, { method: 'DELETE' });
                if (res.ok) {
                  setSelectedTenantId(null);
                  setTenantView('info');
                  setHighlightPaymentId(null);
                  await loadData();
                }
              }}
            />
          );
        })()}

        {activeTab === 'tenants' && !selectedTenantId && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h2 className="text-xl font-serif text-[#3D3730]">Current Tenants</h2>
              <div className="relative w-full sm:w-auto">
                <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[#5A6355]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search tenants..."
                  className="w-full sm:w-auto pl-10 pr-4 py-3 bg-white border border-[#E2D9D0] rounded-[24px] text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355] italic shadow-sm"
                />
              </div>
            </div>

            <AddTenantWidget
              onAdded={async (created) => {
                await loadData();
                if (created?.id) {
                  setSelectedTenantId(created.id);
                  setTenantView('info');
                }
              }}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...tenants]
                .filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.site.includes(searchQuery))
                .sort((a, b) => Number(a.site) - Number(b.site))
                .map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedTenantId(t.id); setTenantView('info'); }}
                  className="bg-white rounded-[32px] p-6 shadow-sm border border-[#E2D9D0] flex flex-col items-center text-center hover:border-[#5A6355] hover:shadow-md transition-all group text-left w-full"
                >
                  <div className="w-40 h-40 rounded-[24px] overflow-hidden mb-4 border-2 border-[#F7F3F0]">
                    {t.imageUrl ? (
                      <img src={t.imageUrl} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className="w-full h-full bg-[#E2D9D0] flex items-center justify-center">
                        <Users className="w-12 h-12 text-[#5A6355] opacity-50" />
                      </div>
                    )}
                  </div>
                  <h3 className="text-xl font-serif text-[#3D3730] mb-1">{t.name}</h3>
                  <div className="inline-flex items-center px-3 py-1 rounded-lg font-mono text-sm font-medium bg-[#FBF9F7] text-[#5A6355] border border-[#F0EBE6] mb-3">
                    Space {t.site}
                  </div>
                  {t.endDate && (
                     <div className="text-xs text-[#5A6355] mb-2 tracking-wide capitalize">
                       {t.endDate}
                     </div>
                  )}
                  <div className="flex flex-col items-center gap-2 mt-2 w-full">
                    <span className="flex items-center gap-1 text-xs text-[#C29474] font-medium group-hover:gap-2 transition-all">
                      View Info <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTenantId(t.id);
                        setTenantView('payment');
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#5A6355] hover:bg-[#3D3730] px-3 py-2 rounded-xl transition"
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      View receipt / payment history
                    </span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTenantId(t.id);
                        setTenantView('receipt');
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#5A6355] hover:text-[#3D3730] transition"
                    >
                      Open printable receipts
                    </span>
                  </div>
                </button>
              ))}
              {tenants.length === 0 && (
                <div className="col-span-full py-16 text-center text-sm text-[#5A6355] bg-white rounded-[32px] border border-[#E2D9D0]">
                  No tenants found. Use <strong>Add Tenant</strong> above to create one.
                </div>
              )}
            </div>

            <PreviousTenantsWidget />
          </div>
        )}

        {activeTab === 'sites' && (
          <SitesWidget onUpdate={loadData} />
        )}

        {activeTab === 'photos' && (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <GoogleConnectWidget emailFocus />
            <PhotosWidget onUpdate={loadData} />
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <PhoneReservationWidget />
            <CalendarWidget />
            <CardVaultWidget />
            <CustomersWidget
              onConverted={async (created) => {
                await loadData();
                setActiveTab('tenants');
                if (created?.id) {
                  setSelectedTenantId(created.id);
                  setTenantView('info');
                }
              }}
            />
          </div>
        )}

        {activeTab === 'properties' && (
          <PropertiesWidget />
        )}

        {activeTab === 'reports' && (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div>
              <h2 className="text-xl font-serif text-[#3D3730] mb-1">Reports</h2>
              <p className="text-sm text-[#5A6355]">
                Tax, revenue, overnight &amp; weekly receipts, and payment processor for park records.
              </p>
            </div>
            <TaxQuarterlyWidget />
            <RevenueMonthlyWidget />
            <GuestReceiptsWidget />
            <PaymentProcessorWidget />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <WebsitePreviewWidget />
            <ContactWidget onUpdate={loadData} />
            <GoogleConnectWidget />
            <SmsSettingsWidget />
            <ReceiptGeneratorWidget />
            <CommentsAdminWidget />
          </div>
        )}

      </main>

      <ChatWidget onUpdate={loadData} />
    </div>
  );
}
