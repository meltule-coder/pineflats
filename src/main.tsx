import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { PublicSiteApp } from './PublicSiteApp.tsx';
import './index.css';

/**
 * Production VPS:
 *   /        → public booking website
 *   /admin   → back office
 * Dev / local admin paths also use /admin when pathname starts with it.
 */
const path = window.location.pathname.replace(/\/+$/, '') || '/';
const isAdmin =
  path === '/admin'
  || path.startsWith('/admin/')
  || path === '/admin.html'
  || new URLSearchParams(window.location.search).get('mode') === 'admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? <App /> : <PublicSiteApp />}
  </StrictMode>
);
