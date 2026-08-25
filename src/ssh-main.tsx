import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from 'lucide-react';
import { SshWidget } from './components/SshWidget';
import './index.css';

function SshAccessApp() {
  return (
    <div className="min-h-screen bg-[#F7F3F0] font-sans text-[#3D3730]">
      <header className="border-b border-[#E2D9D0] bg-white/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#1a1f1c] border border-[#3D3730] flex items-center justify-center shrink-0">
            <Terminal className="w-5 h-5 text-[#A8B2A6]" />
          </div>
          <div>
            <h1 className="text-xl font-serif italic text-[#5A6355] font-bold">VPS Access</h1>
            <p className="text-[10px] uppercase tracking-widest text-[#5A6355]/70">
              SSH connections only · not the property manager
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <SshWidget />
      </main>

      <footer className="max-w-4xl mx-auto px-4 sm:px-6 pb-10">
        <p className="text-xs text-[#5A6355]/70 text-center">
          Bookmark this page for quick VPS SSH details. Open a terminal on your computer and paste the command.
        </p>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SshAccessApp />
  </StrictMode>
);
