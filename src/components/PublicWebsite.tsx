import { Photo, Tenant } from '../../types';
import { ArrowLeft, Map, Calendar, Phone, Mail, CheckCircle2 } from 'lucide-react';

export function PublicWebsite({ photos, tenants, availableSpots, onBack }: { photos: Photo[], tenants: Tenant[], availableSpots: number, onBack: () => void }) {
  // Try to use a main photo as cover, ideally one with a specific caption, or the first one.
  const coverPhoto = photos.length > 0 ? photos[0].url : 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=2000';

  return (
    <div className="min-h-screen bg-white font-sans text-gray-800 flex flex-col relative w-full overflow-y-auto">
      {/* Backend Return Button */}
      <div className="fixed top-4 left-4 z-50">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2 rounded-full shadow-lg hover:bg-[#3D3730] transition border border-[#E2D9D0]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Return to Dashboard</span>
        </button>
      </div>

      {/* Hero Section */}
      <section className="relative h-[60vh] md:h-[80vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <img src={coverPhoto} alt="Pine Flats RV Park" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/40"></div>
        </div>
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto text-white">
          <h1 className="text-4xl md:text-6xl font-serif font-bold mb-6 italic tracking-tight">Pine Flats RV Park</h1>
          <p className="text-lg md:text-xl font-light mb-8 opacity-90 max-w-2xl mx-auto">
            Your serene escape under the pines. 25 spots with full hookups and a welcoming community.
          </p>

          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 mb-8 max-w-xl mx-auto">
            <div className="text-center mb-5">
               <div className="text-3xl font-serif font-bold text-[#C29474]">{availableSpots} Spots Available</div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
               <button className="flex-1 bg-[#C29474] text-white px-6 py-3 rounded-xl text-lg font-semibold shadow-lg hover:-translate-y-1 transition duration-300 flex items-center justify-center gap-2">
                 <CheckCircle2 className="w-5 h-5" />
                 Book Your Stay
               </button>
               <button className="flex-1 bg-white/20 text-white border border-white/40 px-6 py-3 rounded-xl text-lg font-semibold shadow-lg hover:bg-white/30 hover:-translate-y-1 transition duration-300 flex items-center justify-center gap-2">
                 <Calendar className="w-5 h-5" />
                 Monthly Rental
               </button>
            </div>
          </div>
        </div>
      </section>

      {/* About & Amenities */}
      <section className="py-20 px-4 max-w-7xl mx-auto text-center">
        <h2 className="text-3xl font-serif text-[#3D3730] mb-12">Why Choose Pine Flats?</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          <div className="p-8 bg-[#FBF9F7] rounded-3xl border border-[#F0EBE6]">
            <Map className="w-12 h-12 text-[#5A6355] mx-auto mb-4 opacity-80" />
            <h3 className="text-xl font-serif mb-2">Prime Location</h3>
            <p className="text-gray-600 text-sm leading-relaxed">Nestled in a beautiful, wooded area close to hiking trails, lakes, and local attractions.</p>
          </div>
          <div className="p-8 bg-[#FBF9F7] rounded-3xl border border-[#F0EBE6]">
            <Calendar className="w-12 h-12 text-[#5A6355] mx-auto mb-4 opacity-80" />
            <h3 className="text-xl font-serif mb-2">Flexible Stays</h3>
            <p className="text-gray-600 text-sm leading-relaxed">Whether you're visiting for a weekend or planning a long-term stay, we have a spot for you.</p>
          </div>
          <div className="p-8 bg-[#FBF9F7] rounded-3xl border border-[#F0EBE6]">
            <Phone className="w-12 h-12 text-[#5A6355] mx-auto mb-4 opacity-80" />
            <h3 className="text-xl font-serif mb-2">Great Community</h3>
            <p className="text-gray-600 text-sm leading-relaxed">Join our friendly community of travelers and full-time RVers. On-site management ensures a peaceful stay.</p>
          </div>
        </div>
      </section>

      {/* Gallery Section */}
      {photos.length > 1 && (
        <section className="py-20 px-4 bg-[#F7F3F0]">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-3xl font-serif text-[#3D3730] mb-12 text-center">Our Park</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {photos.slice(1).map((photo) => (
                <div key={photo.id} className="aspect-[4/3] rounded-2xl overflow-hidden bg-gray-200">
                  <img src={photo.url} alt={photo.caption} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Mock Footer */}
      <footer className="mt-auto bg-[#3D3730] text-gray-300 py-12 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h3 className="text-2xl font-serif italic text-white mb-2">Pine Flats RV Park</h3>
            <p className="text-sm opacity-60">Your home away from home.</p>
          </div>
          <div className="flex gap-6">
            <a href="#" className="flex items-center gap-2 hover:text-white transition"><Mail className="w-4 h-4" /> Contact</a>
            <a href="#" className="flex items-center gap-2 hover:text-white transition"><Phone className="w-4 h-4" /> 555-0199</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
