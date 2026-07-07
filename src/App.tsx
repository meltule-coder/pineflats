/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { ChatWidget } from './components/ChatWidget';
import { PublicWebsite } from './components/PublicWebsite';
import { CalendarWidget } from './components/CalendarWidget';
import { SitesWidget } from './components/SitesWidget';
import { TenantDetailPage } from './components/TenantDetailPage';
import { TenantPaymentPage } from './components/TenantPaymentPage';
import { Users, Image as ImageIcon, Search, Sparkles, Globe, Calendar as CalendarIcon, Grid3x3, ChevronRight, DollarSign } from 'lucide-react';
import { Tenant, Photo } from '../types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'tenants' | 'sites' | 'photos' | 'marketing' | 'calendar'>('tenants');
  const [availableSpots, setAvailableSpots] = useState(25);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [tenantView, setTenantView] = useState<'info' | 'payment'>('info');
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = async () => {
    try {
      const [tRes, pRes, sRes] = await Promise.all([
        fetch('/api/tenants'),
        fetch('/api/photos'),
        fetch('/api/slots'),
      ]);
      setTenants(await tRes.json());
      setPhotos(await pRes.json());
      const slotsData = await sRes.json();
      setAvailableSpots(slotsData.available);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'sites' || tab === 'tenants' || tab === 'photos' || tab === 'marketing' || tab === 'calendar') {
      setActiveTab(tab);
    }
  }, []);

  if (isPreviewMode) {
    return <PublicWebsite photos={photos} tenants={tenants} availableSpots={availableSpots} onBack={() => setIsPreviewMode(false)} />;
  }

  return (
    <div className="min-h-screen bg-[#F7F3F0] font-sans selection:bg-[#E2D9D0] text-[#3D3730] flex flex-col">
      {/* Header */}
      <header className="bg-[#F7F3F0] pt-8 pb-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-serif italic text-[#5A6355] font-bold">Pine Flats</h1>
              <p className="text-[10px] uppercase tracking-widest opacity-60">Property Management</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsPreviewMode(true)}
              className="hidden sm:flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2 rounded-2xl hover:bg-[#3D3730] transition border border-[#E2D9D0]"
            >
              <Globe className="w-4 h-4" />
              <span className="text-sm font-medium">Preview Website</span>
            </button>
            <div className="flex items-center gap-3 bg-white/50 px-4 py-2 rounded-2xl border border-white">
              <div className="flex -space-x-2">
                <div className="w-8 h-8 rounded-full bg-[#A8B2A6] border-2 border-[#EDE7E1] flex items-center justify-center text-[10px] text-white font-bold">D</div>
                <div className="w-8 h-8 rounded-full bg-[#C29474] border-2 border-[#EDE7E1] flex items-center justify-center text-[10px] text-white font-bold">M</div>
              </div>
              <div className="hidden sm:block text-[11px] leading-tight">
                 <p className="uppercase tracking-wider opacity-60">Active Access</p>
                 <p>Dave & Melinda synced</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex-1 flex flex-col">
        
        {/* Navigation Tabs */}
        <div className="flex space-x-2 mb-8 bg-[#EDE7E1] p-2 rounded-3xl w-fit drop-shadow-sm border border-[#E2D9D0]">
          <button
            onClick={() => setActiveTab('tenants')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'tenants' 
                ? 'bg-[#5A6355] text-white rounded-2xl' 
                : 'text-[#5A6355] hover:bg-[#E2D9D0] rounded-2xl'
            }`}
          >
            <Users className="w-4 h-4" />
            Tenants
          </button>
          <button
            onClick={() => setActiveTab('sites')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'sites' 
                ? 'bg-[#5A6355] text-white rounded-2xl' 
                : 'text-[#5A6355] hover:bg-[#E2D9D0] rounded-2xl'
            }`}
          >
            <Grid3x3 className="w-4 h-4" />
            Sites
          </button>
          <button
            onClick={() => setActiveTab('photos')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'photos' 
                ? 'bg-[#5A6355] text-white rounded-2xl' 
                : 'text-[#5A6355] hover:bg-[#E2D9D0] rounded-2xl'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            Photos
          </button>
          <button
            onClick={() => setActiveTab('marketing')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'marketing' 
                ? 'bg-[#5A6355] text-white rounded-2xl' 
                : 'text-[#5A6355] hover:bg-[#E2D9D0] rounded-2xl'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Marketing Widget
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'calendar' 
                ? 'bg-[#5A6355] text-white rounded-2xl' 
                : 'text-[#5A6355] hover:bg-[#E2D9D0] rounded-2xl'
            }`}
          >
            <CalendarIcon className="w-4 h-4" />
            Bookings
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'tenants' && selectedTenantId && tenantView === 'payment' && (() => {
          const tenant = tenants.find(t => t.id === selectedTenantId);
          if (!tenant) return null;
          return (
            <TenantPaymentPage
              tenant={tenant}
              onBack={() => setTenantView('info')}
            />
          );
        })()}

        {activeTab === 'tenants' && selectedTenantId && tenantView === 'info' && (() => {
          const tenant = tenants.find(t => t.id === selectedTenantId);
          if (!tenant) return null;
          return (
            <TenantDetailPage
              tenant={tenant}
              onBack={() => { setSelectedTenantId(null); setTenantView('info'); }}
              onPayments={() => setTenantView('payment')}
              onSave={async (updates) => {
                const res = await fetch(`/api/tenants/${tenant.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(updates),
                });
                if (res.ok) await loadData();
              }}
            />
          );
        })()}

        {activeTab === 'tenants' && !selectedTenantId && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-serif text-[#3D3730]">Current Tenants</h2>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[#5A6355]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search tenants..."
                  className="pl-10 pr-4 py-3 bg-white border border-[#E2D9D0] rounded-[24px] text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355] italic shadow-sm"
                />
              </div>
            </div>

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
                  <div className="flex items-center gap-4 mt-2">
                    <span className="flex items-center gap-1 text-xs text-[#C29474] font-medium group-hover:gap-2 transition-all">
                      View Info <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); setSelectedTenantId(t.id); setTenantView('payment'); }}
                      className="flex items-center gap-1 text-xs text-[#5A6355] font-medium hover:text-[#3D3730] transition"
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      Payments
                    </span>
                  </div>
                </button>
              ))}
              {tenants.length === 0 && (
                <div className="col-span-full py-16 text-center text-sm text-[#5A6355] bg-white rounded-[32px] border border-[#E2D9D0]">
                  No tenants found. Ask the assistant to add one!
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'sites' && (
          <SitesWidget onUpdate={loadData} />
        )}

        {activeTab === 'photos' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-serif text-[#3D3730]">Website Photos</h2>
              <button className="bg-[#C29474] text-white rounded-xl px-4 py-2 text-sm font-semibold shadow-lg shadow-black/10 transition-transform active:scale-95">
                Upload via Assistant
              </button>
            </div>
            
            <div className="bg-[#5A6355] text-[#F7F3F0] rounded-[32px] p-6 shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {photos.map((p) => (
                  <div key={p.id} className="group relative bg-[#F7F3F0] rounded-[24px] overflow-hidden border border-white/20">
                    <div className="aspect-[4/3] w-full overflow-hidden bg-white/10 relative">
                      <img 
                        src={p.url} 
                        alt={p.caption} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                        <span className="text-xs bg-black/50 text-white px-3 py-1 rounded-full">Managing...</span>
                      </div>
                    </div>
                    <div className="p-4 text-[#3D3730]">
                      <p className="text-sm font-medium">{p.caption}</p>
                      <p className="text-xs text-[#5A6355] mt-1">Live on Website</p>
                    </div>
                  </div>
                ))}
                {photos.length === 0 && (
                  <div className="col-span-full py-12 text-center text-sm text-[#F7F3F0]/60">
                    No photos available. Use the assistant to upload.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'marketing' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-serif text-[#3D3730]">Quick Marketing Widget</h2>
            </div>
            
            <div className="bg-white rounded-[32px] shadow-sm border border-[#E2D9D0] p-6 md:p-8">
              <div className="max-w-2xl mx-auto text-center space-y-4">
                <div className="w-16 h-16 bg-[#EDE7E1] text-[#5A6355] rounded-[24px] flex items-center justify-center mx-auto mb-4 border border-[#E2D9D0]">
                  <Sparkles className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-serif text-[#3D3730]">Broadcast Updates</h3>
                <p className="text-[#5A6355] text-sm leading-relaxed">
                  Quickly push promotions, news, or announcements to the Pine Flats website and social channels. The AI Assistant can help draft your copy and automatically post to connected services.
                </p>
                <div className="pt-6">
                  <textarea 
                    rows={4}
                    placeholder="E.g., We have 3 new spots open for the weekend!..."
                    className="w-full p-4 bg-[#FBF9F7] border border-[#E2D9D0] rounded-[24px] text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355] italic mb-4 text-[#3D3730]"
                  ></textarea>
                  <button className="bg-[#C29474] text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-black/10 transition-transform active:scale-95 w-full sm:w-auto">
                    Draft & Publish with Assistant
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <CalendarWidget />
        )}

      </main>

      <ChatWidget onUpdate={loadData} />
    </div>
  );
}
