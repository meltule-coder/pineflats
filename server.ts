import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envLocal = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: fs.existsSync(envLocal) ? envLocal : '.env' });
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import {
  getCookieName, verifyAdminPassword, createAdminSession, destroyAdminSession,
  isAdminSessionValid, checkLoginRateLimit, clearLoginRateLimit, isPublicApiPath,
  parseCookieHeader, setAdminPassword, isAdminPasswordConfigured,
  getAdminRecoveryEmail, getAdminRecoveryEmailMasked, setAdminRecoveryEmail,
  createAdminRecoveryCode, verifyAndConsumeRecoveryCode, checkRecoveryRateLimit,
  getMinPasswordLength,
} from './server/adminAuth';
import { publicWriteRateLimit, clientIp } from './server/rateLimit';
import {
  getSlots, maintainSlots, updateSlot, updateSlotIf, saveSlots, assignSlot, clearSlotByTenant,
  clearSlotByTenantId, clearSlotBySiteNumber,
  moveTenantSlot, getAvailableCount, getSpreadsheetId, setSpreadsheetId, TOTAL_SLOTS,
  addSlotMeterRecord, setSlotMeterBaseline, deleteSlotMeterRecord, SLOT_KWH_RATE,
} from './server/slotsStore';

import {
  createSlotsSpreadsheet, writeSlotsToSheet, readSlotsFromSheet, getSpreadsheetUrl
} from './server/googleSheets';
import {
  getTenants, getTenant, updateTenant, addTenant, removeTenantByName, removeTenantById, findTenantByName, nextTenantId
} from './server/tenantsStore';
import {
  listPreviousTenants,
  getPreviousTenant,
  archiveTenant,
  addPreviousTenantManual,
  updatePreviousTenant,
  deletePreviousTenant,
} from './server/previousTenantsStore';
import {
  getTenantPayment, updateTenantPayment, addPaymentRecord, updatePaymentRecord, deletePaymentRecord,
  addExtraCharge, updateExtraCharge, deleteExtraCharge,
  addCredit, updateCredit, deleteCredit,
  addMeterRecord, setCurrentMeterReading, updateMeterRecord, deleteMeterRecord, deleteTenantPayment, startNewMonth,
  addSavedCard, updateSavedCard, deleteSavedCard, getAllPaymentTotals, getTotalPaidForTenant,
  applyEarlyDepartureClosing,
} from './server/paymentsStore';
import {
  getReceiptConfig, setReceiptDocUrl, setReceiptDocId, getReceiptUrlForSpace, extractDocId
} from './server/receiptsStore';
import {
  listDocuments, verifyDocumentAccess, createReceiptDocument, getDocumentUrl
} from './server/googleDocs';
import { rentAmountForType } from './rentUtils';
import type { RentalType } from './types';
import {
  getQuarterlyTaxReport,
  listTaxLedgerYears,
  purgeEstimatedTaxLedgerEntries,
  dedupeTaxLedgerEntries,
  recordPaidBookingTax,
  recordPaidSlotStayTax,
  removeTaxLedgerForSlotReservation,
  syncTaxLedgerFromSlots,
} from './server/taxLedgerStore';
import { getYearRevenueReport, listRevenueYears } from './server/revenueReportStore';
import {
  listOvernightWeeklyReceipts,
  saveGuestReceipt,
  removeGuestReceipt,
} from './server/guestReceiptsStore';
import {
  getPhotos, getPublishedPhotos, addPhoto, updatePhoto, deletePhoto, reorderPhotos
} from './server/photosStore';
import { getContactInfo, updateContactInfo } from './server/contactStore';
import {
  getCustomers, addCustomer, updateCustomer, deleteCustomer, upsertCustomer
} from './server/customersStore';
import { getPublicAvailability, getPublicSiteBundle } from './server/publicData';
import { slotConflictForStay } from './server/slotAvailability';
import { getComments, addComment, setAdminReply, clearAdminReply, deleteComment } from './server/commentsStore';
import {
  getProperties, getProperty, getActiveProperty, addProperty, updateProperty, deleteProperty,
  setActiveProperty, updatePropertyRentalRates, getActiveRatesPayload
} from './server/propertiesStore';
import { SLOT_CONTACT_CLEAR, clearSlotContactFields } from './server/slotContactUtils';
import { verifyPreviewPassword, setPreviewPassword, getPreviewPassword } from './server/previewStore';
import {
  parseBookingRequest, canBookSlot, buildSlotBookingUpdates, ParsedBooking,
} from './server/bookingUtils';
import {
  sendBookingReceiptEmails,
  sendTenantPaymentReceiptEmails,
  getEmailConfigStatus,
  sendAdminRecoveryEmail,
  sendSmtpTestEmail,
  resetEmailTransport,
} from './server/emailService';
import {
  getSmtpPublicStatus,
  updateSmtpConfig,
  clearSmtpConfig,
} from './server/smtpStore';
import {
  getGmailPublicStatus,
  saveGmailToken,
  clearGmailToken,
} from './server/gmailTokenStore';
import {
  getSmsPublicStatus,
  updateSmsConfig,
} from './server/smsStore';
import {
  sendBookingSmsAlert,
  sendSmsTest,
} from './server/smsService';
import {
  getSshConnections, getSshConnection, addSshConnection, updateSshConnection,
  deleteSshConnection, testSshPort
} from './server/sshStore';
import { updatePaymentProcessorConfig } from './server/paymentProcessorStore';
import { updatePaymentProcessorSecrets } from './server/paymentProcessorSecrets';
import {
  getPaymentProcessorPublicConfig,
  getPaymentProcessorStatus,
  getPublicCheckoutProcessorInfo,
  chargeWithProcessor,
  handleProcessorWebhook,
  testProcessorConnection,
} from './server/paymentProcessor';
import {
  listPaymentCardRefs,
  upsertPaymentCardRef,
  deletePaymentCardRef,
  applyCardRefToTenant,
  getPaymentCardRef,
  formatCardRefLabel,
  syncVaultFromAllTenants,
} from './server/cardRefsStore';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const SITES_UPLOADS_DIR = path.join(UPLOADS_DIR, 'sites');
if (!fs.existsSync(SITES_UPLOADS_DIR)) {
  fs.mkdirSync(SITES_UPLOADS_DIR, { recursive: true });
}

const imageUploadOptions = {
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
};

const mediaUploadOptions = {
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB for videos
  fileFilter: (_req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only image or video files are allowed'));
  },
};

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || (file.mimetype.startsWith('video/') ? '.mp4' : '.jpg');
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 40) || 'media';
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
  ...mediaUploadOptions,
});

const sitePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SITES_UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const slotId = (req.params as { id?: string }).id ?? 'site';
      cb(null, `${slotId}-${Date.now()}${ext}`);
    },
  }),
  ...imageUploadOptions,
});

function deleteUploadedImage(imageUrl?: string) {
  if (!imageUrl?.startsWith('/uploads/')) return;
  const filePath = path.join(process.cwd(), imageUrl);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}

async function startServer() {
  maintainSlots();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  // Behind nginx: use X-Forwarded-* for secure cookies / req.secure
  app.set('trust proxy', 1);
  // Do not advertise Express to scanners / clients
  app.disable('x-powered-by');

  const allowedOrigins = new Set(
    (process.env.CORS_ORIGINS ||
      [
        'https://pineflatsrvpark.com',
        'https://www.pineflatsrvpark.com',
        'https://pineflatsrv.com',
        'https://www.pineflatsrv.com',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ].join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin browser requests and non-browser clients send no Origin
        if (!origin || allowedOrigins.has(origin) || !isProd) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    })
  );

  // Security headers — nginx sets most on production; keep CSP + basics here
  // for local dev and as a second layer if a request bypasses edge config.
  app.use((req, res, next) => {
    const behindNginx = Boolean(req.headers['x-forwarded-proto'] || req.headers['x-real-ip']);
    if (!behindNginx) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
      );
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('X-DNS-Prefetch-Control', 'off');
      res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
      const proto = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : req.protocol) || '');
      if (proto.includes('https')) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
    }

    // CSP always from app (single place for policy updates)
    // Clover Hosted iframe: checkout.clover.com SDK + token.clover.com (card data stays with Clover)
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "object-src 'none'",
        "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com https://checkout.clover.com https://checkout.sandbox.dev.clover.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com https://apis.google.com https://token.clover.com https://token-sandbox.dev.clover.com https://scl.clover.com https://scl-sandbox.dev.clover.com https://api.clover.com https://apisandbox.dev.clover.com https://checkout.clover.com https://checkout.sandbox.dev.clover.com",
        "frame-src 'self' https://accounts.google.com https://checkout.clover.com https://checkout.sandbox.dev.clover.com https://*.clover.com https://*.dev.clover.com",
        'upgrade-insecure-requests',
      ].join('; ')
    );

    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // --- Admin auth (protects /api/* except public guest routes) ---
  app.get('/api/admin/status', (req, res) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[getCookieName()] || (req.cookies?.[getCookieName()] as string | undefined);
    res.json({
      authenticated: isAdminSessionValid(token),
      // Hint only for first-time setup — never returns the password
      passwordConfigured: isAdminPasswordConfigured(),
      minPasswordLength: getMinPasswordLength(),
      recoveryEmailMasked: getAdminRecoveryEmailMasked(),
    });
  });

  app.get('/api/admin/recovery-info', (_req, res) => {
    res.json({
      recoveryEmailMasked: getAdminRecoveryEmailMasked(),
      message: 'Enter the backup email to receive a one-time recovery code.',
    });
  });

  app.post('/api/admin/login', publicWriteRateLimit('admin-login'), (req, res) => {
    const ip = clientIp(req);
    const rate = checkLoginRateLimit(ip);
    if (!rate.ok) {
      res.setHeader('Retry-After', String(rate.retryAfterSec ?? 60));
      return res.status(429).json({
        error: `Too many login attempts. Try again in ${rate.retryAfterSec}s.`,
      });
    }
    const password = String(req.body?.password || '');
    if (!verifyAdminPassword(password)) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    clearLoginRateLimit(ip);
    const token = createAdminSession();
    const secure =
      process.env.NODE_ENV === 'production'
      || String(req.headers['x-forwarded-proto'] || '').includes('https');
    res.cookie(getCookieName(), token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[getCookieName()] || (req.cookies?.[getCookieName()] as string | undefined);
    destroyAdminSession(token);
    res.clearCookie(getCookieName(), { path: '/' });
    res.json({ ok: true });
  });

  /** Request a one-time code to the backup recovery email (public — for lockout). */
  app.post('/api/admin/forgot-password', publicWriteRateLimit('admin-recovery'), async (req, res) => {
    const ip = clientIp(req);
    const rate = checkRecoveryRateLimit(ip);
    if (!rate.ok) {
      res.setHeader('Retry-After', String(rate.retryAfterSec ?? 60));
      return res.status(429).json({
        error: `Too many recovery attempts. Try again in ${rate.retryAfterSec}s.`,
      });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const expected = getAdminRecoveryEmail();
    // Always return a generic success shape when email mismatches (avoid email fishing),
    // but only issue a code when it matches.
    if (!email || email !== expected) {
      return res.json({
        ok: true,
        emailSent: false,
        message:
          'If that email matches the backup recovery address, a code was sent. Check your inbox (and spam).',
      });
    }
    try {
      const { code, expiresAt, recoveryEmail } = createAdminRecoveryCode();
      const sent = await sendAdminRecoveryEmail({ to: recoveryEmail, code, expiresAt });
      res.json({
        ok: true,
        emailSent: !!(sent.ok && sent.mode === 'smtp'),
        message: sent.ok && sent.mode === 'smtp'
          ? `Recovery code sent to ${getAdminRecoveryEmailMasked()}. It expires in 30 minutes.`
          : `Recovery code created. Email delivery is not configured (or failed). Use the code from the park server recovery file if you have SSH access, or contact your site admin.`,
        // Never return the code in the API response
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Could not start password recovery',
      });
    }
  });

  /** Reset password with recovery email + one-time code (public — for lockout). */
  app.post('/api/admin/reset-password', publicWriteRateLimit('admin-recovery'), (req, res) => {
    const ip = clientIp(req);
    const rate = checkRecoveryRateLimit(ip);
    if (!rate.ok) {
      res.setHeader('Retry-After', String(rate.retryAfterSec ?? 60));
      return res.status(429).json({
        error: `Too many recovery attempts. Try again in ${rate.retryAfterSec}s.`,
      });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (email !== getAdminRecoveryEmail()) {
      return res.status(400).json({ error: 'Invalid recovery email or code' });
    }
    if (!verifyAndConsumeRecoveryCode(code)) {
      return res.status(400).json({ error: 'Invalid or expired recovery code' });
    }
    try {
      setAdminPassword(newPassword);
      clearLoginRateLimit(ip);
      res.json({
        ok: true,
        message: 'Password updated. Sign in with your new password.',
      });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Could not reset password' });
    }
  });

  app.put('/api/admin/password', (req, res) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[getCookieName()] || (req.cookies?.[getCookieName()] as string | undefined);
    if (!isAdminSessionValid(token)) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const recoveryEmail = req.body?.recoveryEmail;
    if (!verifyAdminPassword(currentPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    try {
      if (newPassword.trim()) {
        setAdminPassword(newPassword);
      }
      if (typeof recoveryEmail === 'string' && recoveryEmail.trim()) {
        setAdminRecoveryEmail(recoveryEmail);
      }
      res.json({
        ok: true,
        recoveryEmailMasked: getAdminRecoveryEmailMasked(),
      });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Could not update password' });
    }
  });

  app.get('/api/admin/recovery-email', (req, res) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[getCookieName()] || (req.cookies?.[getCookieName()] as string | undefined);
    if (!isAdminSessionValid(token)) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    res.json({
      recoveryEmail: getAdminRecoveryEmail(),
      recoveryEmailMasked: getAdminRecoveryEmailMasked(),
    });
  });

  app.put('/api/admin/recovery-email', (req, res) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[getCookieName()] || (req.cookies?.[getCookieName()] as string | undefined);
    if (!isAdminSessionValid(token)) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    try {
      const email = setAdminRecoveryEmail(String(req.body?.email || ''));
      res.json({ ok: true, recoveryEmail: email, recoveryEmailMasked: getAdminRecoveryEmailMasked() });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Could not save recovery email' });
    }
  });

  app.use('/api', (req, res, next) => {
    // Mounted at /api → req.path is like /tenants; originalUrl is /api/tenants?...
    const fullPath = req.originalUrl.split('?')[0];
    if (isPublicApiPath(req.method, fullPath)) {
      return next();
    }
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[getCookieName()] || (req.cookies?.[getCookieName()] as string | undefined);
    if (!isAdminSessionValid(token)) {
      return res.status(401).json({ error: 'Admin sign-in required' });
    }
    next();
  });

  // --- API Routes ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // --- Properties (multi-park registry) ---
  app.get('/api/properties', (_req, res) => {
    res.json(getProperties());
  });

  app.get('/api/properties/active', (_req, res) => {
    const active = getActiveProperty();
    if (!active) return res.status(404).json({ error: 'No properties found' });
    res.json(active);
  });

  app.get('/api/properties/:id', (req, res) => {
    const property = getProperty(req.params.id);
    if (!property) return res.status(404).json({ error: 'Property not found' });
    res.json(property);
  });

  app.post('/api/properties', (req, res) => {
    try {
      const property = addProperty(req.body || {});
      res.status(201).json(property);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to add property' });
    }
  });

  app.put('/api/properties/:id', (req, res) => {
    const updated = updateProperty(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Property not found or invalid data' });
    res.json(updated);
  });

  app.post('/api/properties/:id/activate', (req, res) => {
    const updated = setActiveProperty(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Property not found' });
    res.json(updated);
  });

  app.get('/api/rates/active', (_req, res) => {
    res.json(getActiveRatesPayload());
  });

  /** Save rental rates for any property (not only the active one). */
  app.put('/api/properties/:id/rates', (req, res) => {
    const property = getProperty(req.params.id);
    if (!property) return res.status(404).json({ error: 'Property not found' });
    const updated = updatePropertyRentalRates(req.params.id, req.body || {});
    if (!updated) return res.status(400).json({ error: 'Could not save rental rates' });
    res.json(updated);
  });

  app.delete('/api/properties/:id', (req, res) => {
    try {
      if (!deleteProperty(req.params.id)) {
        return res.status(404).json({ error: 'Property not found' });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to delete property' });
    }
  });

  // --- SSH connection profiles (admin utility; no passwords stored) ---
  app.get('/api/ssh', (_req, res) => {
    res.json(getSshConnections());
  });

  app.post('/api/ssh', (req, res) => {
    try {
      const created = addSshConnection(req.body || {});
      res.status(201).json(created);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to add connection' });
    }
  });

  app.put('/api/ssh/:id', (req, res) => {
    const updated = updateSshConnection(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Connection not found or invalid data' });
    res.json(updated);
  });

  app.delete('/api/ssh/:id', (req, res) => {
    if (!deleteSshConnection(req.params.id)) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    res.json({ ok: true });
  });

  app.post('/api/ssh/:id/test', async (req, res) => {
    const conn = getSshConnection(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });
    const result = await testSshPort(conn.host, conn.port || 22);
    res.json(result);
  });

  // --- Public website APIs (no tenant/customer/returning-guest PII) ---
  // Never cache availability/media — back-office slot changes must show immediately
  const noStore = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
  };

  app.get('/api/public/availability', noStore, (req, res) => {
    const checkIn = typeof req.query.checkIn === 'string' ? req.query.checkIn.slice(0, 10) : null;
    const checkOut = typeof req.query.checkOut === 'string' ? req.query.checkOut.slice(0, 10) : null;
    res.json(getPublicAvailability({ checkIn, checkOut }));
  });

  app.get('/api/public/site', noStore, (req, res) => {
    const checkIn = typeof req.query.checkIn === 'string' ? req.query.checkIn.slice(0, 10) : null;
    const checkOut = typeof req.query.checkOut === 'string' ? req.query.checkOut.slice(0, 10) : null;
    res.json(getPublicSiteBundle({ checkIn, checkOut }));
  });

  app.get('/api/public/photos', noStore, (_req, res) => {
    res.json(getPublishedPhotos());
  });

  app.get('/api/comments', noStore, (_req, res) => {
    res.json(getComments());
  });

  app.get('/api/preview/status', (_req, res) => {
    res.json({ configured: !!getPreviewPassword() });
  });

  app.post('/api/preview/login', publicWriteRateLimit('preview-login'), (req, res) => {
    const { password } = req.body;
    if (!verifyPreviewPassword(password)) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    res.json({ ok: true });
  });

  app.put('/api/preview/password', (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!verifyPreviewPassword(currentPassword)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      setPreviewPassword(newPassword);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: 'Failed to update preview password' });
    }
  });

  // Data routes
  app.get('/api/tenants', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Tenant records are not available on the public website' });
    }
    res.json(getTenants());
  });

  app.post('/api/tenants', (req, res) => {
    const {
      name,
      site,
      phone = '',
      email = '',
      rvType = '',
      licensePlate = '',
      emergencyContact = '',
      notes = '',
      startDate,
      endDate = 'ongoing',
      rentalType = 'monthly',
      rentAmount,
      balanceDue,
    } = req.body || {};

    const tenantName = String(name || '').trim();
    const siteNumber = String(site || '').trim();
    if (!tenantName) return res.status(400).json({ error: 'Name is required' });
    if (!siteNumber) return res.status(400).json({ error: 'Site is required' });

    const slots = getSlots();
    const slot = slots.find(
      (s) =>
        String(s.number) === siteNumber ||
        s.label.toLowerCase().replace(/\s+/g, '') === siteNumber.toLowerCase().replace(/\s+/g, '')
    );
    if (!slot) return res.status(404).json({ error: `Site ${siteNumber} not found` });
    // Available sites or current reservations can become tenants
    if (slot.status !== 'available' && slot.status !== 'reserved') {
      return res.status(400).json({
        error: `Site ${slot.number} is ${slot.status} — choose an available site or convert a reservation`,
      });
    }

    const resolvedRentalType = ['daily', 'weekly', 'monthly'].includes(rentalType)
      ? rentalType
      : (slot.rentalType && ['daily', 'weekly', 'monthly'].includes(slot.rentalType)
        ? slot.rentalType
        : 'monthly');
    const resolvedRent =
      Number(rentAmount)
      || Number(slot.rentAmount)
      || rentAmountForType(resolvedRentalType);
    const resolvedBalance = Number(balanceDue) || Number(slot.balanceDue) || resolvedRent;
    const tenantId = nextTenantId();
    const resolvedStart =
      startDate
      || slot.startDate
      || new Date().toISOString().split('T')[0];
    const resolvedEnd = String(endDate || slot.endDate || 'ongoing');
    const phoneVal = String(phone || slot.contactPhone || '');
    const emailVal = String(email || slot.contactEmail || '');
    const rvVal = String(rvType || slot.contactRvType || '');
    const plateVal = String(licensePlate || slot.contactLicensePlate || '');
    const emergencyVal = String(emergencyContact || slot.contactEmergency || '');
    const notesVal = String(notes || slot.contactNotes || slot.notes || '');
    const addressVal = String((req.body || {}).address || slot.contactAddress || '').trim();

    const tenant = addTenant({
      id: tenantId,
      name: tenantName,
      site: String(slot.number),
      status: 'Active',
      rentalType: resolvedRentalType,
      phone: phoneVal,
      email: emailVal,
      address: addressVal || undefined,
      rvType: rvVal,
      licensePlate: plateVal,
      emergencyContact: emergencyVal,
      notes: notesVal,
      description: notesVal,
      startDate: resolvedStart,
      endDate: resolvedEnd,
      imageUrl:
        'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400',
    });

    updateTenantPayment(tenantId, {
      rentalType: resolvedRentalType,
      rentAmount: resolvedRent,
      balanceDue: resolvedBalance,
    });

    assignSlot(String(slot.number), {
      id: tenantId,
      name: tenantName,
      startDate: resolvedStart,
      endDate: resolvedEnd,
      description: notesVal,
    });

    // Clear reservation contact fields after converting to tenant
    updateSlot(slot.id, {
      contactName: undefined,
      contactPhone: undefined,
      contactEmail: undefined,
      contactAddress: undefined,
      contactRvType: undefined,
      contactLicensePlate: undefined,
      contactEmergency: undefined,
      contactNotes: undefined,
      rentAmount: undefined,
      rentalType: undefined,
      balanceDue: undefined,
      paymentMethod: undefined,
      bookedAt: undefined,
    });

    if (tenantName) {
      upsertCustomer({
        name: tenantName,
        phone: phoneVal,
        email: emailVal,
        rvType: rvVal,
        licensePlate: plateVal,
        emergencyContact: emergencyVal,
        notes: notesVal,
      });
    }

    res.status(201).json(tenant);
  });

  app.get('/api/tenants/:id', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Tenant records are not available on the public website' });
    }
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json(tenant);
  });

  app.put('/api/tenants/:id', (req, res) => {
    const existing = getTenant(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Tenant not found' });

    const body = req.body || {};
    const nextName = body.name !== undefined ? String(body.name).trim() : existing.name;
    const nextSite = body.site !== undefined ? String(body.site).trim() : existing.site;

    if (!nextName) return res.status(400).json({ error: 'Name is required' });
    if (!nextSite) return res.status(400).json({ error: 'Site is required' });

    const siteChanged = String(nextSite) !== String(existing.site);
    if (siteChanged) {
      const slots = getSlots();
      const target = slots.find(
        (s) =>
          String(s.number) === String(nextSite) ||
          s.label.toLowerCase().replace(/\s+/g, '') === String(nextSite).toLowerCase().replace(/\s+/g, '')
      );
      if (!target) return res.status(404).json({ error: `Site ${nextSite} not found` });
      if (target.status !== 'available' && target.tenantId !== existing.id) {
        return res.status(400).json({ error: `Site ${target.number} is not available` });
      }

      clearSlotByTenantId(existing.id);
      if (existing.site) clearSlotBySiteNumber(existing.site);
    }

    const allowed: Partial<typeof existing> = {};
    const fields = [
      'name', 'site', 'status', 'rentalType', 'imageUrl', 'startDate', 'endDate',
      'description', 'phone', 'email', 'address', 'rvType', 'licensePlate', 'emergencyContact', 'notes',
    ] as const;
    for (const key of fields) {
      if (body[key] !== undefined) {
        (allowed as any)[key] = body[key];
      }
    }
    allowed.name = nextName;
    allowed.site = String(
      (() => {
        const slots = getSlots();
        const match = slots.find(
          (s) =>
            String(s.number) === String(nextSite) ||
            s.label.toLowerCase().replace(/\s+/g, '') === String(nextSite).toLowerCase().replace(/\s+/g, '')
        );
        return match ? match.number : nextSite;
      })()
    );

    const updated = updateTenant(req.params.id, allowed);
    if (!updated) return res.status(404).json({ error: 'Tenant not found' });

    // Keep slot occupancy/name in sync with tenant record
    const assigned = assignSlot(String(updated.site), {
      id: updated.id,
      name: updated.name,
      startDate: updated.startDate,
      endDate: updated.endDate,
      description: updated.notes || updated.description,
    });
    if (!assigned && siteChanged) {
      return res.status(400).json({ error: `Could not assign site ${updated.site}` });
    }

    // Sync rental type → payments + site slot (monthly / weekly tenants)
    if (body.rentalType !== undefined || body.startDate !== undefined || body.endDate !== undefined) {
      const rt = (updated.rentalType || body.rentalType || 'monthly') as RentalType;
      const validRt: RentalType =
        rt === 'weekly' || rt === 'daily' || rt === 'monthly' ? rt : 'monthly';
      const typeChanged =
        body.rentalType !== undefined && String(body.rentalType) !== String(existing.rentalType || '');
      const defaultRent = rentAmountForType(validRt);
      const rentAmount =
        body.rentAmount != null && body.rentAmount !== ''
          ? Number(body.rentAmount)
          : typeChanged
            ? defaultRent
            : undefined;

      const paymentUpdate: Record<string, unknown> = {
        rentalType: validRt,
      };
      if (rentAmount != null && Number.isFinite(rentAmount)) {
        paymentUpdate.rentAmount = rentAmount;
        paymentUpdate.balanceDue = rentAmount;
        if (validRt === 'monthly') paymentUpdate.baseMonthlyRate = rentAmount;
      }
      updateTenantPayment(updated.id, paymentUpdate as Parameters<typeof updateTenantPayment>[1]);

      // Keep occupied slot rental type / rates aligned with tenant
      const slots = getSlots();
      const slot = slots.find(
        (s) => s.tenantId === updated.id || String(s.number) === String(updated.site)
      );
      if (slot) {
        updateSlot(slot.id, {
          rentalType: validRt,
          ...(rentAmount != null && Number.isFinite(rentAmount)
            ? { rentAmount, balanceDue: rentAmount }
            : {}),
          endDate:
            validRt === 'monthly'
              ? updated.endDate || 'ongoing'
              : updated.endDate || slot.endDate,
        });
      }
    }

    if (updated.name) {
      upsertCustomer({
        name: updated.name,
        phone: updated.phone,
        email: updated.email,
        rvType: updated.rvType,
        licensePlate: updated.licensePlate,
        emergencyContact: updated.emergencyContact,
        notes: updated.notes || updated.description,
      });
    }

    res.json(updated);
  });

  app.delete('/api/tenants/:id', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const reason =
      req.body?.reason === 'checkout' || req.query.reason === 'checkout'
        ? 'checkout'
        : 'removed';
    const archiveNote =
      typeof req.body?.archiveNote === 'string'
        ? req.body.archiveNote
        : typeof req.query.note === 'string'
          ? req.query.note
          : undefined;

    // Keep full profile + payment history in previous tenants before clearing live data
    const archived = archiveTenant({
      tenant,
      reason,
      archiveNote,
      includePayment: true,
    });

    clearSlotByTenantId(tenant.id);
    if (tenant.site) clearSlotBySiteNumber(tenant.site);
    if (tenant.name) clearSlotByTenant(tenant.name);
    removeTenantById(tenant.id);
    deleteTenantPayment(tenant.id);

    res.json({ ok: true, removed: tenant, archived });
  });

  /** Former tenants archive (does not occupy sites). */
  app.get('/api/previous-tenants', (_req, res) => {
    res.json(listPreviousTenants());
  });

  app.get('/api/previous-tenants/:id', (req, res) => {
    const rec = getPreviousTenant(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Previous tenant not found' });
    res.json(rec);
  });

  app.post('/api/previous-tenants', (req, res) => {
    try {
      const body = req.body || {};
      const rec = addPreviousTenantManual({
        name: body.name,
        site: body.site,
        phone: body.phone,
        email: body.email,
        address: body.address,
        rvType: body.rvType,
        licensePlate: body.licensePlate,
        emergencyContact: body.emergencyContact,
        notes: body.notes,
        startDate: body.startDate,
        endDate: body.endDate,
        rentalType: body.rentalType,
        archiveNote: body.archiveNote,
      });
      res.status(201).json(rec);
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : 'Could not save previous tenant',
      });
    }
  });

  app.put('/api/previous-tenants/:id', (req, res) => {
    try {
      const body = req.body || {};
      const updated = updatePreviousTenant(req.params.id, {
        archiveNote: body.archiveNote,
        tenant: body.tenant,
      });
      if (!updated) return res.status(404).json({ error: 'Previous tenant not found' });
      res.json(updated);
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : 'Could not update previous tenant',
      });
    }
  });

  app.delete('/api/previous-tenants/:id', (req, res) => {
    const ok = deletePreviousTenant(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Previous tenant not found' });
    res.json({ ok: true });
  });

  app.get('/api/payments/totals', (_req, res) => {
    res.json(getAllPaymentTotals());
  });

  app.get('/api/tenants/:id/payments', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const payment = getTenantPayment(req.params.id);
    res.json({
      ...payment,
      totalPaidAllTime: getTotalPaidForTenant(req.params.id),
    });
  });

  app.put('/api/tenants/:id/payments', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const updated = updateTenantPayment(req.params.id, req.body);
    res.json(updated);
  });

  app.post('/api/tenants/:id/payments/new-period', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const updated = startNewMonth(req.params.id);
    res.json(updated);
  });

  app.post('/api/tenants/:id/payments/record', async (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const { date, amount, method, note } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const updated = addPaymentRecord(req.params.id, {
      date: date || new Date().toISOString().split('T')[0],
      amount: Number(amount),
      method: method || 'Cash',
      note,
    });
    const record = updated.records[0];
    let email: Awaited<ReturnType<typeof sendTenantPaymentReceiptEmails>> | null = null;
    if (record) {
      try {
        email = await sendTenantPaymentReceiptEmails({ tenant, payment: updated, record });
      } catch (err) {
        console.error('Tenant payment receipt email failed:', err);
      }
    }
    res.json({
      ...updated,
      emailSent: !!(email?.customerSent || email?.parkSent),
      email: email
        ? {
            customerSent: email.customerSent,
            parkSent: email.parkSent,
            mode: email.mode,
            error: email.error,
          }
        : undefined,
    });
  });

  /**
   * Initiate a card payment for a tenant.
   * - mode "processor": charge via connected payment processor (full vault stays with processor)
   * - mode "terminal": admin confirms card was run on terminal / processor dashboard
   * Optional cardRef: brand + last4 only (for first payment display) — never full PAN/CVV.
   */
  app.post('/api/tenants/:id/payments/initiate-card', async (req, res) => {
    try {
      const tenant = getTenant(req.params.id);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Enter a valid payment amount greater than zero' });
      }

      const mode = String(req.body?.mode || 'terminal') === 'processor' ? 'processor' : 'terminal';
      const note = String(req.body?.note || '').trim();
      const date =
        String(req.body?.date || '').slice(0, 10) || new Date().toISOString().split('T')[0];

      // Reject full PAN / CVV if a client accidentally posts them
      const rawNumber = String(req.body?.cardNumber || '').replace(/\D/g, '');
      if (rawNumber.length >= 12) {
        return res.status(400).json({
          error: 'Full card numbers cannot be saved on the park server. Enter details in the form; only card type and last 4 are kept as a reference.',
        });
      }
      if (req.body?.cvv || req.body?.cvc) {
        return res.status(400).json({
          error: 'CVV cannot be stored on the park server.',
        });
      }

      const brand = String(req.body?.cardBrand || req.body?.brand || 'Card').trim() || 'Card';
      const last4 = String(req.body?.cardLast4 || req.body?.last4 || '')
        .replace(/\D/g, '')
        .slice(-4);
      const saveCardRef = last4.length === 4;
      const cardLabel = saveCardRef ? `${brand} •••• ${last4}` : null;

      const existing = getTenantPayment(req.params.id);
      const isFirstPayment = !(existing?.records?.length);

      // Save type + last4 only (first payment or when provided) for staff reference
      if (saveCardRef) {
        addSavedCard(req.params.id, {
          brand,
          last4,
          isDefault: true,
        });
      }

      if (mode === 'processor') {
        const procStatus = getPaymentProcessorStatus();
        if (!procStatus.connected && procStatus.provider === 'none') {
          return res.status(400).json({
            error:
              'No payment processor connected. Go to Settings → Payment processor, or use “Confirm card payment” after running the card on your terminal.',
            processor: procStatus,
          });
        }

        const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
          .split(',')[0]
          .trim();
        const result = await chargeWithProcessor({
          amountCents: Math.round(amount * 100),
          currency: 'usd',
          description: note || `Tenant payment · ${tenant.name} · site ${tenant.site}`,
          customerName: tenant.name,
          customerEmail: tenant.email,
          // Clover allows max 12 chars for external_reference_id
          referenceId: `T${String(tenant.site || '').replace(/\D/g, '').slice(0, 3)}${Date.now().toString().slice(-6)}`,
          metadata: {
            tenantId: String(tenant.id).slice(0, 24),
            site: String(tenant.site).slice(0, 8),
            channel: 'admin',
          },
          paymentMethodToken:
            typeof req.body?.paymentMethodToken === 'string'
              ? req.body.paymentMethodToken
              : undefined,
          ecomind: 'moto',
          clientIp: clientIp || undefined,
        });

        if (!result.ok) {
          const needsToken =
            /clv_|source token|tokenize/i.test(String(result.message || ''));
          const status = needsToken ? 400 : 402;
          return res.status(status).json({
            error: needsToken
              ? 'Online Clover charge needs the secure Clover card form (a one-time clv_ token). The card vault only stores brand + last 4 and cannot charge by itself. Enter the card in the Clover fields, or switch to “Confirm card payment” after running the card on a Clover terminal.'
              : result.message || 'Clover declined or rejected the charge.',
            processor: result,
            hint: needsToken
              ? 'Vault cards are for staff reference only. Use Charge via processor + Clover form, or Confirm card payment after a terminal sale.'
              : 'Check card details, Clover live vs sandbox mode, and the message above. You can still use “Confirm card payment” after a terminal sale.',
            cardRefSaved: saveCardRef,
          });
        }

        const updated = addPaymentRecord(req.params.id, {
          date,
          amount,
          method: 'Card',
          note: [
            note || 'Card payment via processor',
            cardLabel,
            result.processorPaymentId ? `Processor ref: ${result.processorPaymentId}` : null,
            result.testMode ? 'test mode' : null,
            isFirstPayment ? 'First payment' : null,
          ]
            .filter(Boolean)
            .join(' · '),
        });

        let email: Awaited<ReturnType<typeof sendTenantPaymentReceiptEmails>> | null = null;
        const record = updated.records[0];
        if (record) {
          try {
            email = await sendTenantPaymentReceiptEmails({ tenant, payment: updated, record });
          } catch (err) {
            console.error('Tenant payment receipt email failed:', err);
          }
        }

        return res.status(201).json({
          ok: true,
          mode: 'processor',
          payment: updated,
          processor: result,
          cardRef: cardLabel,
          isFirstPayment,
          emailSent: !!(email?.customerSent || email?.parkSent),
          email: email
            ? {
                customerSent: email.customerSent,
                parkSent: email.parkSent,
                mode: email.mode,
                error: email.error,
              }
            : undefined,
          message: cardLabel
            ? `Card payment recorded. Reference saved: ${cardLabel}.`
            : 'Card payment initiated and recorded.',
        });
      }

      // Terminal / external processor: admin confirms charge already taken
      const updated = addPaymentRecord(req.params.id, {
        date,
        amount,
        method: 'Card',
        note: [
          note || 'Card payment confirmed (terminal / processor)',
          cardLabel,
          isFirstPayment ? 'First payment' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });

      let email: Awaited<ReturnType<typeof sendTenantPaymentReceiptEmails>> | null = null;
      const record = updated.records[0];
      if (record) {
        try {
          email = await sendTenantPaymentReceiptEmails({ tenant, payment: updated, record });
        } catch (err) {
          console.error('Tenant payment receipt email failed:', err);
        }
      }

      res.status(201).json({
        ok: true,
        mode: 'terminal',
        payment: updated,
        cardRef: cardLabel,
        isFirstPayment,
        emailSent: !!(email?.customerSent || email?.parkSent),
        email: email
          ? {
              customerSent: email.customerSent,
              parkSent: email.parkSent,
              mode: email.mode,
              error: email.error,
            }
          : undefined,
        message: cardLabel
          ? `First card payment saved. Card reference: ${cardLabel}. Full numbers are not stored.`
          : 'Card payment recorded for tenant.',
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Could not initiate card payment',
      });
    }
  });

  app.post('/api/tenants/:id/payments/cards', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    // Only brand + last 4 — full PAN/CVV rejected
    const body = req.body || {};
    if (body.cardNumber || body.cvv || body.cvc) {
      return res.status(400).json({
        error: 'Full card numbers and CVV cannot be stored. Use card type and last 4 only.',
      });
    }
    const last4 = body.last4 ?? body.cardLast4;
    const updated = addSavedCard(req.params.id, {
      last4,
      brand: body.brand,
      isDefault: body.isDefault !== false,
    });
    if (!updated) {
      return res.status(400).json({
        error: 'Card type and last 4 digits are required.',
      });
    }
    res.status(201).json(updated);
  });

  app.put('/api/tenants/:id/payments/cards/:cardId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    // Only allow default/delete metadata toggles without accepting new card digits
    const body = req.body || {};
    if (body.last4 != null || body.cardLast4 != null || body.cardNumber != null || body.cvv != null) {
      return res.status(400).json({
        error: 'Card numbers are not stored on the admin site. Manage cards in your payment processor.',
      });
    }
    const updated = updateSavedCard(req.params.id, req.params.cardId, {
      cardholderName: body.cardholderName,
      last4: undefined,
      brand: body.brand,
      expMonth: body.expMonth,
      expYear: body.expYear,
      billingZip: body.billingZip,
      label: body.label,
      notes: body.notes,
      isDefault: body.isDefault,
    });
    if (!updated) return res.status(404).json({ error: 'Card not found or invalid data' });
    res.json(updated);
  });

  app.delete('/api/tenants/:id/payments/cards/:cardId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const updated = deleteSavedCard(req.params.id, req.params.cardId);
    if (!updated) return res.status(404).json({ error: 'Card not found' });
    res.json(updated);
  });

  /**
   * Shared card vault (brand + last 4 only) for renewals —
   * monthly tenants and any customer returning for another stay.
   */
  app.get('/api/card-refs', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Card references are not available on the public website' });
    }
    const refs = listPaymentCardRefs({
      customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
      tenantId: typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined,
      email: typeof req.query.email === 'string' ? req.query.email : undefined,
      name: typeof req.query.name === 'string' ? req.query.name : undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
    });
    res.json({
      cards: refs,
      count: refs.length,
      note: 'Only card type and last 4 digits are stored. Full numbers stay with the payment processor.',
    });
  });

  app.post('/api/card-refs', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Not allowed from the public website' });
    }
    const body = req.body || {};
    if (body.cardNumber || body.cvv || body.cvc) {
      return res.status(400).json({
        error: 'Full card numbers and CVV cannot be stored. Use card type and last 4 only.',
      });
    }
    const last4 = String(body.last4 || body.cardLast4 || '').replace(/\D/g, '').slice(-4);
    if (last4.length !== 4) {
      return res.status(400).json({ error: 'Last 4 digits are required' });
    }
    const guestName = String(body.guestName || body.name || '').trim();
    if (!guestName) {
      return res.status(400).json({ error: 'Guest name is required' });
    }
    const ref = upsertPaymentCardRef({
      brand: body.brand || body.cardBrand || 'Card',
      last4,
      guestName,
      guestEmail: body.guestEmail || body.email,
      guestPhone: body.guestPhone || body.phone,
      customerId: body.customerId,
      tenantId: body.tenantId,
      site: body.site,
      isDefault: body.isDefault !== false,
      source: body.source || 'manual',
    });
    if (!ref) return res.status(400).json({ error: 'Could not save card reference' });
    res.status(201).json({ card: ref, label: formatCardRefLabel(ref) });
  });

  app.post('/api/card-refs/sync', (_req, res) => {
    res.json(syncVaultFromAllTenants());
  });

  app.post('/api/card-refs/:id/apply', (req, res) => {
    const tenantId = String(req.body?.tenantId || '');
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required to apply a card for renewal' });
    }
    const result = applyCardRefToTenant(req.params.id, tenantId);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({
      ok: true,
      label: result.label,
      payment: result.payment,
      message: `Card ${result.label} applied for renewals on this tenant.`,
    });
  });

  app.delete('/api/card-refs/:id', (req, res) => {
    const ok = deletePaymentCardRef(req.params.id);
    if (!ok) {
      return res.status(400).json({
        error:
          'Could not delete this card. Tenant-only cards must be removed from the tenant payment page.',
      });
    }
    res.json({ ok: true });
  });

  app.get('/api/card-refs/:id', (req, res) => {
    const ref = getPaymentCardRef(req.params.id);
    if (!ref) return res.status(404).json({ error: 'Card reference not found' });
    res.json({ card: ref, label: formatCardRefLabel(ref) });
  });

  app.put('/api/tenants/:id/payments/record/:recordId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const { date, amount, method, note } = req.body || {};
    if (amount !== undefined && (Number(amount) <= 0 || Number.isNaN(Number(amount)))) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    const updated = updatePaymentRecord(req.params.id, req.params.recordId, {
      date,
      amount: amount !== undefined ? Number(amount) : undefined,
      method,
      note,
    });
    if (!updated) return res.status(404).json({ error: 'Payment record not found' });
    res.json(updated);
  });

  app.delete('/api/tenants/:id/payments/record/:recordId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const updated = deletePaymentRecord(req.params.id, req.params.recordId);
    if (!updated) return res.status(404).json({ error: 'Payment record not found' });
    res.json(updated);
  });

  app.post('/api/tenants/:id/payments/charges', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    try {
      const { date, amount, description, note } = req.body || {};
      const updated = addExtraCharge(req.params.id, {
        date: date || new Date().toISOString().split('T')[0],
        amount: Number(amount),
        description: description || '',
        note,
      });
      res.status(201).json(updated);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to add charge' });
    }
  });

  app.put('/api/tenants/:id/payments/charges/:chargeId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const { date, amount, description, note } = req.body || {};
    const updated = updateExtraCharge(req.params.id, req.params.chargeId, {
      date,
      amount: amount !== undefined ? Number(amount) : undefined,
      description,
      note,
    });
    if (!updated) return res.status(404).json({ error: 'Charge not found or invalid' });
    res.json(updated);
  });

  app.delete('/api/tenants/:id/payments/charges/:chargeId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const updated = deleteExtraCharge(req.params.id, req.params.chargeId);
    if (!updated) return res.status(404).json({ error: 'Charge not found' });
    res.json(updated);
  });

  app.post('/api/tenants/:id/payments/credits', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    try {
      const { date, amount, description, note } = req.body || {};
      const updated = addCredit(req.params.id, {
        date: date || new Date().toISOString().split('T')[0],
        amount: Number(amount),
        description: description || '',
        note,
      });
      res.status(201).json(updated);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to add credit' });
    }
  });

  app.put('/api/tenants/:id/payments/credits/:creditId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const { date, amount, description, note } = req.body || {};
    const updated = updateCredit(req.params.id, req.params.creditId, {
      date,
      amount: amount !== undefined ? Number(amount) : undefined,
      description,
      note,
    });
    if (!updated) return res.status(404).json({ error: 'Credit not found or invalid' });
    res.json(updated);
  });

  app.delete('/api/tenants/:id/payments/credits/:creditId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const updated = deleteCredit(req.params.id, req.params.creditId);
    if (!updated) return res.status(404).json({ error: 'Credit not found' });
    res.json(updated);
  });

  /** Early departure: final meter + prorated rent → closing bill and/or refund owed */
  app.post('/api/tenants/:id/payments/early-departure', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    try {
      const body = req.body || {};
      const result = applyEarlyDepartureClosing(req.params.id, {
        departureDate: String(body.departureDate || ''),
        meterReading: Number(body.meterReading),
        previousReading:
          body.previousReading !== undefined && body.previousReading !== ''
            ? Number(body.previousReading)
            : undefined,
        note: typeof body.note === 'string' ? body.note : undefined,
        issueRefund: body.issueRefund === true,
        refundMethod: typeof body.refundMethod === 'string' ? body.refundMethod : undefined,
        preview: body.preview === true,
      });
      res.status(body.preview === true ? 200 : 201).json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Early departure failed' });
    }
  });

  app.post('/api/tenants/:id/payments/meter', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const { date, reading, note, previousReading, replaceLatest } = req.body;
    if (reading === undefined || reading === null || Number(reading) < 0 || Number.isNaN(Number(reading))) {
      return res.status(400).json({ error: 'Invalid meter reading' });
    }
    const prev =
      previousReading !== undefined && previousReading !== null && previousReading !== ''
        ? Number(previousReading)
        : undefined;
    if (prev !== undefined && (Number.isNaN(prev) || prev < 0)) {
      return res.status(400).json({ error: 'Invalid previous meter reading' });
    }

    const payload = {
      date: date || new Date().toISOString().split('T')[0],
      reading: Number(reading),
      note,
      previousReading: prev,
    };

    const updated = replaceLatest
      ? setCurrentMeterReading(req.params.id, payload)
      : addMeterRecord(req.params.id, payload);
    res.json(updated);
  });

  app.put('/api/tenants/:id/payments/meter/:recordId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const { date, reading, note, previousReading } = req.body || {};
    if (reading !== undefined && (Number(reading) < 0 || Number.isNaN(Number(reading)))) {
      return res.status(400).json({ error: 'Invalid meter reading' });
    }
    const updated = updateMeterRecord(req.params.id, req.params.recordId, {
      date,
      reading: reading !== undefined ? Number(reading) : undefined,
      note,
      previousReading: previousReading !== undefined ? Number(previousReading) : undefined,
    });
    if (!updated) return res.status(404).json({ error: 'Meter record not found' });
    res.json(updated);
  });

  app.delete('/api/tenants/:id/payments/meter/:recordId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const updated = deleteMeterRecord(req.params.id, req.params.recordId);
    if (!updated) return res.status(404).json({ error: 'Meter record not found' });
    res.json(updated);
  });

  /**
   * Site meter readings for weekly (and other non-monthly) stays —
   * overage = max(0, usage − included kWh) × $0.24, added into site balance due.
   */
  app.post('/api/slots/:id/meter', (req, res) => {
    const slot = getSlots().find(s => s.id === req.params.id);
    if (!slot) return res.status(404).json({ error: 'Site not found' });
    const { date, reading, note, previousReading, baselineCredit } = req.body || {};
    if (reading === undefined || reading === null || Number(reading) < 0 || Number.isNaN(Number(reading))) {
      return res.status(400).json({ error: 'Invalid meter reading' });
    }
    const prev =
      previousReading !== undefined && previousReading !== null && previousReading !== ''
        ? Number(previousReading)
        : undefined;
    if (prev !== undefined && (Number.isNaN(prev) || prev < 0)) {
      return res.status(400).json({ error: 'Invalid previous meter reading' });
    }
    if (baselineCredit !== undefined && baselineCredit !== null && baselineCredit !== '') {
      setSlotMeterBaseline(req.params.id, Number(baselineCredit));
    }
    const updated = addSlotMeterRecord(req.params.id, {
      date: date || new Date().toISOString().split('T')[0],
      reading: Number(reading),
      note,
      previousReading: prev,
    });
    if (!updated) return res.status(400).json({ error: 'Could not save meter reading' });

    // Keep linked tenant payment meters in sync when a tenant record exists
    if (updated.tenantId && getTenant(updated.tenantId)) {
      try {
        addMeterRecord(updated.tenantId, {
          date: date || new Date().toISOString().split('T')[0],
          reading: Number(reading),
          note,
          previousReading: prev,
        });
      } catch (err) {
        console.error('Sync tenant meter from slot failed:', err);
      }
    }

    res.status(201).json({
      slot: updated,
      kwhRate: SLOT_KWH_RATE,
      overageCharge: updated.meterOverageCharge ?? 0,
      usage: updated.currentMeterUsage ?? 0,
    });
  });

  app.put('/api/slots/:id/meter/baseline', (req, res) => {
    const slot = getSlots().find(s => s.id === req.params.id);
    if (!slot) return res.status(404).json({ error: 'Site not found' });
    const baseline = Number(req.body?.baselineCredit);
    if (!Number.isFinite(baseline) || baseline < 0) {
      return res.status(400).json({ error: 'Invalid included kWh baseline' });
    }
    const updated = setSlotMeterBaseline(req.params.id, baseline);
    if (!updated) return res.status(404).json({ error: 'Site not found' });
    res.json({
      slot: updated,
      kwhRate: SLOT_KWH_RATE,
      overageCharge: updated.meterOverageCharge ?? 0,
    });
  });

  app.delete('/api/slots/:id/meter/:recordId', (req, res) => {
    const updated = deleteSlotMeterRecord(req.params.id, req.params.recordId);
    if (!updated) return res.status(404).json({ error: 'Meter record not found' });
    res.json({
      slot: updated,
      kwhRate: SLOT_KWH_RATE,
      overageCharge: updated.meterOverageCharge ?? 0,
    });
  });

  app.get('/api/receipts/config', (req, res) => {
    res.json(getReceiptConfig());
  });

  app.put('/api/receipts/config', async (req, res) => {
    try {
      const { docUrl, docId } = req.body;
      const token = req.headers.authorization?.replace('Bearer ', '');

      if (docId) {
        if (token) await verifyDocumentAccess(token, docId);
        const config = setReceiptDocId(docId, docUrl);
        return res.json(config);
      }

      if (!docUrl) return res.status(400).json({ error: 'Google Doc URL required' });

      const parsedId = extractDocId(docUrl);
      if (token && parsedId) await verifyDocumentAccess(token, parsedId);

      const config = setReceiptDocUrl(docUrl);
      res.json(config);
    } catch (error) {
      console.error('Receipt config error:', error);
      res.status(400).json({ error: 'Invalid or inaccessible Google Doc' });
    }
  });

  app.get('/api/docs/list', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Google sign-in required' });

      const documents = await listDocuments(token);
      res.json({ documents });
    } catch (error) {
      console.error('Docs list error:', error);
      res.status(500).json({ error: 'Failed to list Google Docs' });
    }
  });

  app.post('/api/docs/connect', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Google sign-in required' });

      const { docId, docUrl } = req.body;
      if (!docId) return res.status(400).json({ error: 'Document ID required' });

      const { title } = await verifyDocumentAccess(token, docId);
      const url = docUrl || getDocumentUrl(docId);
      const config = setReceiptDocId(docId, url);
      res.json({ ...config, title });
    } catch (error) {
      console.error('Docs connect error:', error);
      res.status(400).json({ error: 'Cannot access this Google Doc' });
    }
  });

  app.post('/api/docs/setup', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Google sign-in required' });

      const { docId, url } = await createReceiptDocument(token);
      const config = setReceiptDocId(docId, url);
      res.json({
        docId,
        url,
        config,
        message: 'Receipt document created with 25 numbered pages',
      });
    } catch (error) {
      console.error('Docs setup error:', error);
      res.status(500).json({ error: 'Failed to create Google Doc' });
    }
  });

  app.get('/api/receipts/space/:number', (req, res) => {
    const url = getReceiptUrlForSpace(req.params.number);
    if (!url) return res.status(404).json({ error: 'Receipt doc not configured' });
    res.json({ space: req.params.number, url });
  });

  // Media files only — never directory listings (ASV / Clover Data Security)
  app.use('/uploads', (req, res, next) => {
    // Trailing slash or empty path = directory probe
    if (req.path === '/' || req.path.endsWith('/')) {
      return res.status(403).type('text/plain').send('Directory listing disabled');
    }
    next();
  });
  app.use(
    '/uploads',
    express.static(UPLOADS_DIR, {
      index: false,
      redirect: false,
      dotfiles: 'deny',
      fallthrough: true,
    })
  );
  app.use('/uploads', (_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  app.get('/api/contact', (req, res) => {
    res.json(getContactInfo());
  });

  app.put('/api/contact', (req, res) => {
    const { phone, email, contactName, address, tagline, businessName, logoUrl, about } = req.body;
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    res.json(
      updateContactInfo({
        phone,
        email,
        contactName,
        address,
        tagline,
        businessName,
        logoUrl,
        about,
      })
    );
  });

  /** Upload / replace the public website business logo */
  app.post('/api/contact/logo', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Not allowed from the public website' });
    }
    const logoUpload = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname) || '.png';
          cb(null, `business-logo-${Date.now()}${ext}`);
        },
      }),
      ...imageUploadOptions,
    });
    logoUpload.single('logo')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Logo upload failed' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No logo file provided' });
      }
      const logoUrl = `/uploads/${req.file.filename}`;
      const prev = getContactInfo();
      if (prev.logoUrl?.startsWith('/uploads/') && prev.logoUrl !== logoUrl) {
        deleteUploadedImage(prev.logoUrl);
      }
      const contact = updateContactInfo({ logoUrl });
      res.json(contact);
    });
  });

  app.post('/api/comments', publicWriteRateLimit('comments'), (req, res) => {
    const { name, comment, rating } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!comment || typeof comment !== 'string' || !comment.trim()) {
      return res.status(400).json({ error: 'Comment is required' });
    }
    if (comment.trim().length < 3) {
      return res.status(400).json({ error: 'Comment is too short' });
    }
    res.status(201).json(addComment({ name, comment, rating }));
  });

  app.put('/api/comments/:id/reply', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Admin replies are not available from the public website' });
    }
    const { reply, adminName } = req.body || {};
    if (!reply || typeof reply !== 'string' || !reply.trim()) {
      return res.status(400).json({ error: 'Reply text is required' });
    }
    const updated = setAdminReply(req.params.id, {
      reply,
      adminName: typeof adminName === 'string' ? adminName : undefined,
    });
    if (!updated) return res.status(404).json({ error: 'Comment not found or reply empty' });
    res.json(updated);
  });

  app.delete('/api/comments/:id/reply', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Admin replies are not available from the public website' });
    }
    const updated = clearAdminReply(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Comment not found' });
    res.json(updated);
  });

  app.delete('/api/comments/:id', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Not allowed from the public website' });
    }
    if (!deleteComment(req.params.id)) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    res.json({ ok: true });
  });

  app.get('/api/photos', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.json(getPublishedPhotos());
    }
    const publishedOnly = req.query.published === 'true';
    res.json(publishedOnly ? getPublishedPhotos() : getPhotos());
  });

  app.post('/api/photos', (req, res) => {
    const { url, caption, published, mediaType } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Media URL is required' });
    }
    const photo = addPhoto({
      url,
      caption: (caption || 'Park media').trim(),
      published: published !== false,
      mediaType: mediaType === 'video' ? 'video' : undefined,
    });
    res.status(201).json(photo);
  });

  app.post('/api/photos/upload', (req, res) => {
    photoUpload.single('photo')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No media file provided' });
      }
      const isVideo = req.file.mimetype.startsWith('video/');
      const caption = (req.body.caption || (isVideo ? 'Park Video' : 'Park Photo')).trim();
      const published = req.body.published !== 'false';
      const photo = addPhoto({
        url: `/uploads/${req.file.filename}`,
        caption,
        published,
        mediaType: isVideo ? 'video' : 'image',
      });
      res.status(201).json(photo);
    });
  });

  app.put('/api/photos/reorder', (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array required' });
    }
    res.json(reorderPhotos(orderedIds));
  });

  app.put('/api/photos/:id', (req, res) => {
    const updated = updatePhoto(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Photo not found' });
    res.json(updated);
  });

  app.delete('/api/photos/:id', (req, res) => {
    const photos = getPhotos();
    const photo = photos.find(p => p.id === req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    if (photo.url.startsWith('/uploads/')) {
      const filePath = path.join(process.cwd(), photo.url);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }

    deletePhoto(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/slots', (req, res) => {
    // Public website must use /api/public/* — do not send guest contact fields there
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.json(getPublicAvailability());
    }
    const slots = maintainSlots();
    res.json({
      slots,
      total: TOTAL_SLOTS,
      available: slots.filter(s => s.status === 'available').length,
    });
  });

  app.put('/api/slots/:id', (req, res) => {
    const slots = getSlots();
    const slot = slots.find(s => s.id === req.params.id);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });

    const updates = { ...req.body };
    if (updates.imageUrl === null || updates.imageUrl === '') {
      deleteUploadedImage(slot.imageUrl);
      updates.imageUrl = undefined;
    } else if (
      typeof updates.imageUrl === 'string'
      && updates.imageUrl !== slot.imageUrl
      && slot.imageUrl?.startsWith('/uploads/')
    ) {
      deleteUploadedImage(slot.imageUrl);
    }

    const clearingReservation =
      updates.status === 'available' || updates.status === 'maintenance';
    const prevStay = {
      id: slot.id,
      number: slot.number,
      startDate: slot.startDate,
      endDate: slot.endDate,
      contactName: slot.contactName,
      tenantName: slot.tenantName,
      rentalType: slot.rentalType,
    };
    const stayDatesChanging =
      updates.status === 'reserved' &&
      slot.status === 'reserved' &&
      ((updates.startDate != null && String(updates.startDate).slice(0, 10) !== String(slot.startDate || '').slice(0, 10)) ||
        (updates.endDate != null && String(updates.endDate).slice(0, 10) !== String(slot.endDate || '').slice(0, 10)));

    if (updates.status === 'available') {
      // Drop tax ledger rows for this cancelled reservation so Tax summary updates
      removeTaxLedgerForSlotReservation(prevStay);
      Object.assign(updates, clearSlotContactFields({}));
    }

    if (updates.status === 'maintenance') {
      // Keep maintenance note; clear reservation window so site is not treated as booked
      removeTaxLedgerForSlotReservation(prevStay);
      if (updates.notes === undefined && typeof req.body.notes === 'string') {
        updates.notes = req.body.notes;
      }
      updates.startDate = undefined;
      updates.endDate = undefined;
      updates.bookedAt = undefined;
      updates.paymentMethod = undefined;
    }

    if (updates.status === 'reserved') {
      // Ensure reserved stays have dates when provided
      if (updates.startDate === '') updates.startDate = undefined;
      if (updates.endDate === '') updates.endDate = undefined;
      // If admin changes stay dates, remove the old tax row (sync/booking can re-add)
      if (stayDatesChanging) {
        removeTaxLedgerForSlotReservation(prevStay);
      }
    }

    // Allow clearing notes / site description with empty string
    if (updates.notes === '') updates.notes = undefined;
    if (updates.siteDescription === '') updates.siteDescription = undefined;
    if (typeof updates.siteDescription === 'string') {
      updates.siteDescription = updates.siteDescription.trim().slice(0, 500) || undefined;
    }

    // When freeing a site, clear guest data but keep pad photo + site description
    if (updates.status === 'available' && slot.siteDescription && updates.siteDescription === undefined) {
      // clearSlotContactFields already ran above; re-apply description if not in body
      // (siteDescription is not part of SLOT_CONTACT_CLEAR)
    }

    const updated = updateSlot(req.params.id, updates);

    // Daily/weekly Sites stays with a payment method → paid tax ledger (shows on tax report)
    if (updated) {
      try {
        recordPaidSlotStayTax(updated);
      } catch (err) {
        console.error('Tax ledger from Sites stay failed:', err);
      }
    }

    res.json(updated);
  });

  // Returning customers — back office only. Never used by the public website.
  app.get('/api/customers', (req, res) => {
    // Block obvious public-site usage; managers use these from the back office UI
    const purpose = String(req.headers['x-pineflats-client'] || '');
    if (purpose === 'public-website') {
      return res.status(403).json({ error: 'Customer records are not available on the public website' });
    }
    res.json(getCustomers());
  });

  app.post('/api/customers', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Customer records are not available on the public website' });
    }
    const { name, phone, email, rvType, licensePlate, emergencyContact, notes } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    const customer = addCustomer({ name, phone, email, rvType, licensePlate, emergencyContact, notes });
    res.status(201).json(customer);
  });

  app.post('/api/customers/upsert', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Customer records are not available on the public website' });
    }
    const { name, phone, email, rvType, licensePlate, emergencyContact, notes } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    res.json(upsertCustomer({ name, phone, email, rvType, licensePlate, emergencyContact, notes }));
  });

  app.put('/api/customers/:id', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Customer records are not available on the public website' });
    }
    const updated = updateCustomer(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Customer not found' });
    res.json(updated);
  });

  app.delete('/api/customers/:id', (req, res) => {
    if (String(req.headers['x-pineflats-client'] || '') === 'public-website') {
      return res.status(403).json({ error: 'Customer records are not available on the public website' });
    }
    if (!deleteCustomer(req.params.id)) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json({ ok: true });
  });

  app.post('/api/slots/:id/photo', (req, res) => {
    sitePhotoUpload.single('photo')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      const slots = getSlots();
      const slot = slots.find(s => s.id === req.params.id);
      if (!slot) return res.status(404).json({ error: 'Slot not found' });
      if (slot.status !== 'available') {
        return res.status(400).json({ error: 'Photos can only be added to available sites' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No photo file provided' });
      }

      deleteUploadedImage(slot.imageUrl);
      const updated = updateSlot(req.params.id, { imageUrl: `/uploads/sites/${req.file.filename}` });
      res.json(updated);
    });
  });

  app.delete('/api/slots/:id/photo', (req, res) => {
    const slots = getSlots();
    const slot = slots.find(s => s.id === req.params.id);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });

    deleteUploadedImage(slot.imageUrl);
    const updated = updateSlot(req.params.id, { imageUrl: undefined });
    res.json(updated);
  });

  /**
   * Hold / complete a website booking.
   * Re-checks availability in the same write so a second concurrent guest cannot
   * double-book the site (mobile or desktop use the same API).
   */
  async function saveBookingToSlot(parsed: ParsedBooking, paid: boolean) {
    const updates = buildSlotBookingUpdates(parsed, paid);
    const reserved = updateSlotIf(
      parsed.slotId,
      slot => {
        const slotError = canBookSlot(slot, parsed.email, true);
        if (slotError) return slotError;
        return slotConflictForStay(slot, parsed.checkIn, parsed.checkOut, {
          allowSameEmail: parsed.email,
        });
      },
      updates
    );
    if (reserved.ok === false) {
      const err = new Error(reserved.error) as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    }

    // Returning-customer store is back-office only; still upsert for managers
    upsertCustomer({
      name: parsed.name,
      phone: parsed.contactPhone,
      email: parsed.contactEmail,
      rvType: parsed.contactRvType,
      licensePlate: parsed.contactLicensePlate,
      emergencyContact: parsed.contactEmergency,
      notes: parsed.contactNotes,
    });

    const slot = reserved.slot;
    if (paid && (parsed.rentalType === 'daily' || parsed.rentalType === 'weekly')) {
      try {
        recordPaidBookingTax({
          checkIn: parsed.checkIn,
          checkOut: parsed.checkOut,
          rentalType: parsed.rentalType,
          guestName: parsed.name,
          guestEmail: parsed.email,
          siteLabel: slot?.label ?? parsed.slotId,
          siteNumber: slot?.number,
          slotId: parsed.slotId,
          paymentMethod: parsed.paymentMethod,
        });
      } catch (err) {
        console.error('Tax ledger write failed:', err);
      }
    }
    // Public booking response: no other guests' data; only this booking confirmation
    return {
      success: true as const,
      total: parsed.total,
      paymentMethod: parsed.paymentMethod,
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      siteLabel: slot?.label ?? parsed.slotId,
      siteNumber: slot?.number,
      status: 'reserved' as const,
      paid,
    };
  }

  // --- Transient tax quarterly reports (admin) ---
  app.get('/api/tax/years', (_req, res) => {
    res.json({ years: listTaxLedgerYears() });
  });

  app.get('/api/tax/quarterly', (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const q = Number(req.query.quarter) || Math.floor(new Date().getMonth() / 3) + 1;
    const quarter = ([1, 2, 3, 4].includes(q) ? q : 1) as 1 | 2 | 3 | 4;
    res.json(getQuarterlyTaxReport(year, quarter));
  });

  app.post('/api/tax/sync', (_req, res) => {
    // Tax summary is booked/paid only — remove estimated site-sync rows, do not import them
    const purged = purgeEstimatedTaxLedgerEntries();
    // Collapse accidental double writes (same guest/site/dates saved twice)
    const deduped = dedupeTaxLedgerEntries();
    const removed = purged.removed + deduped.removed;
    res.json({
      added: 0,
      removed,
      total: deduped.total,
      message:
        removed > 0
          ? `Cleaned ${removed} row(s) (${purged.removed} estimated, ${deduped.removed} duplicate). Tax summary shows each paid stay once.`
          : 'Tax summary already shows each paid stay once (no estimated site stays).',
    });
  });

  // --- Revenue by month (admin) ---
  app.get('/api/revenue/years', (_req, res) => {
    res.json({ years: listRevenueYears() });
  });

  app.get('/api/revenue/monthly', (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    res.json(getYearRevenueReport(year));
  });

  // Overnight (daily) + weekly guest receipts for park records
  app.get('/api/receipts/overnight-weekly', (req, res) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const typeRaw = String(req.query.type || 'all');
    const rentalType =
      typeRaw === 'daily' || typeRaw === 'weekly' ? typeRaw : 'all';
    res.json(listOvernightWeeklyReceipts({ year, rentalType }));
  });

  app.post('/api/receipts/overnight-weekly', (req, res) => {
    try {
      const saved = saveGuestReceipt(req.body || {});
      res.status(201).json(saved);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Could not create receipt' });
    }
  });

  app.put('/api/receipts/overnight-weekly/:id', (req, res) => {
    try {
      const saved = saveGuestReceipt({ ...(req.body || {}), id: req.params.id });
      res.json(saved);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Could not update receipt' });
    }
  });

  app.delete('/api/receipts/overnight-weekly/:id', (req, res) => {
    const ok = removeGuestReceipt(req.params.id);
    if (!ok) {
      return res.status(400).json({
        error: 'Could not delete this receipt. It may already be removed.',
      });
    }
    res.json({ ok: true });
  });

  app.get('/api/email/status', (_req, res) => {
    res.json(getEmailConfigStatus());
  });

  /** Google Gmail OAuth token (browser GIS) → server for sending receipts. */
  app.get('/api/google/gmail', (_req, res) => {
    res.json(getGmailPublicStatus());
  });

  app.put('/api/google/gmail', (req, res) => {
    try {
      const body = req.body || {};
      const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const expiresInSec =
        body.expiresInSec != null ? Number(body.expiresInSec) : undefined;
      if (!accessToken || !email) {
        return res.status(400).json({ error: 'accessToken and email are required' });
      }
      saveGmailToken({ accessToken, email, expiresInSec });
      res.json(getGmailPublicStatus());
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : 'Could not save Google Gmail token',
      });
    }
  });

  app.delete('/api/google/gmail', (_req, res) => {
    clearGmailToken();
    res.json(getGmailPublicStatus());
  });

  app.get('/api/email/smtp', (_req, res) => {
    res.json(getSmtpPublicStatus());
  });

  app.put('/api/email/smtp', (req, res) => {
    try {
      const body = req.body || {};
      const status = updateSmtpConfig({
        host: body.host,
        port: body.port != null ? Number(body.port) : undefined,
        secure: body.secure,
        user: body.user,
        pass: typeof body.pass === 'string' ? body.pass : undefined,
        from: body.from,
        parkNotifyEmail: body.parkNotifyEmail,
        enabled: body.enabled,
        clearPassword: body.clearPassword === true,
      });
      resetEmailTransport();
      res.json(status);
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : 'Could not save SMTP settings',
      });
    }
  });

  app.delete('/api/email/smtp', (_req, res) => {
    clearSmtpConfig();
    resetEmailTransport();
    res.json(getSmtpPublicStatus());
  });

  app.post('/api/email/smtp/test', async (req, res) => {
    try {
      const to = typeof req.body?.to === 'string' ? req.body.to.trim() : undefined;
      const result = await sendSmtpTestEmail(to);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : 'Test email failed',
      });
    }
  });

  app.get('/api/sms/status', (_req, res) => {
    res.json(getSmsPublicStatus());
  });

  app.put('/api/sms/config', (req, res) => {
    try {
      const body = req.body || {};
      const status = updateSmsConfig({
        enabled: body.enabled,
        alertTo: body.alertTo,
        accountSid: body.accountSid,
        authToken: typeof body.authToken === 'string' ? body.authToken : undefined,
        fromNumber: body.fromNumber,
        clearAuthToken: body.clearAuthToken === true,
      });
      res.json(status);
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : 'Could not save SMS settings',
      });
    }
  });

  app.post('/api/sms/test', async (req, res) => {
    try {
      const to = typeof req.body?.to === 'string' ? req.body.to.trim() : undefined;
      const result = await sendSmsTest(to);
      if (!result.ok && result.mode === 'twilio') {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : 'SMS test failed',
      });
    }
  });

  // --- Payment processor (Clover live; others reserved) ---
  app.get('/api/payment-processor', (_req, res) => {
    res.json(getPaymentProcessorPublicConfig());
  });

  app.get('/api/payment-processor/status', (_req, res) => {
    res.json(getPaymentProcessorStatus());
  });

  app.put('/api/payment-processor', (req, res) => {
    try {
      const body = req.body || {};
      updatePaymentProcessorConfig({
        provider: body.provider,
        enabled: body.enabled,
        testMode: body.testMode,
        displayName: body.displayName,
        publicKey: body.publicKey,
        merchantId: body.merchantId,
        notes: body.notes,
      });
      // Write-only secrets: never returned. Empty = leave unchanged.
      if (
        typeof body.secretKey === 'string' ||
        typeof body.webhookSecret === 'string' ||
        body.clearSecretKey ||
        body.clearWebhookSecret
      ) {
        updatePaymentProcessorSecrets({
          secretKey: typeof body.secretKey === 'string' ? body.secretKey : undefined,
          webhookSecret: typeof body.webhookSecret === 'string' ? body.webhookSecret : undefined,
          clearSecretKey: Boolean(body.clearSecretKey),
          clearWebhookSecret: Boolean(body.clearWebhookSecret),
        });
      }
      res.json(getPaymentProcessorPublicConfig());
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : 'Could not save payment processor settings',
      });
    }
  });

  /** Verify Clover Merchant ID + private API token against Clover API. */
  app.post('/api/payment-processor/test', async (_req, res) => {
    try {
      const result = await testProcessorConnection();
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({
        ok: false,
        message: e instanceof Error ? e.message : 'Connection test failed',
      });
    }
  });

  /** Charge via connected processor (Clover needs paymentMethodToken clv_…). */
  app.post('/api/payment-processor/charge', async (req, res) => {
    try {
      const amount = Number(req.body?.amountCents ?? req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'amountCents must be a positive number' });
      }
      const result = await chargeWithProcessor({
        amountCents: Math.round(amount),
        currency: req.body?.currency || 'usd',
        description: req.body?.description,
        customerEmail: req.body?.customerEmail,
        customerName: req.body?.customerName,
        referenceId: req.body?.referenceId,
        metadata: req.body?.metadata,
        paymentMethodToken: req.body?.paymentMethodToken,
      });
      res.status(result.ok ? 200 : result.status === 'not_configured' ? 503 : 400).json(result);
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Charge failed',
      });
    }
  });

  app.post('/api/payment-processor/webhook', (req, res) => {
    try {
      const raw =
        typeof req.body === 'string' || Buffer.isBuffer(req.body)
          ? req.body
          : JSON.stringify(req.body ?? {});
      const result = handleProcessorWebhook(req.headers as Record<string, string | string[] | undefined>, raw);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({
        ok: false,
        handled: false,
        message: e instanceof Error ? e.message : 'Webhook error',
      });
    }
  });

  app.post('/api/bookings/start', publicWriteRateLimit('bookings'), async (req, res) => {
    const parsed = parseBookingRequest(req.body);
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });

    try {
      // Marks site reserved immediately (payment pending) so it drops off the
      // public website and cannot be chosen by another guest on any device.
      const result = await saveBookingToSlot(parsed.data, false);
      res.status(201).json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not start booking';
      const code = (e as { statusCode?: number }).statusCode === 400 ? 400 : 500;
      res.status(code).json({ error: msg });
    }
  });

  /**
   * Phone / walk-in reservation: reserve site, record payment, save overnight/weekly receipt.
   * Admin-only (not public).
   */
  app.post('/api/bookings/phone', async (req, res) => {
    try {
      const body = req.body || {};
      const slotId = String(body.slotId || '');
      const rentalType = body.rentalType === 'weekly' ? 'weekly' : body.rentalType === 'daily' ? 'daily' : null;
      const checkIn = String(body.checkIn || '').slice(0, 10);
      const checkOut = String(body.checkOut || '').slice(0, 10);
      const guestName = String(body.contactName || body.guestName || '').trim();
      const paid = body.paid !== false;

      if (!slotId) return res.status(400).json({ error: 'Select a site' });
      if (!rentalType) return res.status(400).json({ error: 'Choose daily or weekly' });
      if (!guestName) return res.status(400).json({ error: 'Guest name is required' });
      if (!checkIn || !checkOut) return res.status(400).json({ error: 'Check-in and check-out are required' });

      // Never store card digits on park servers — processor vault only (Settings → Payment processor)
      const payMethodRaw = String(body.paymentMethod || 'Cash');
      const paymentMethodOnly =
        /^card\b/i.test(payMethodRaw) || /••••|last\s*4/i.test(payMethodRaw) ? 'Card' : payMethodRaw;

      const contactAddress = String(body.contactAddress || '').trim();
      const parsed = parseBookingRequest({
        slotId,
        rentalType,
        checkIn,
        checkOut,
        contactName: guestName,
        contactPhone: body.contactPhone || body.guestPhone || '',
        contactEmail: body.contactEmail || body.guestEmail || 'phone-guest@local',
        contactRvType: body.contactRvType || '',
        contactLicensePlate: body.contactLicensePlate || '',
        contactEmergency: body.contactEmergency || '',
        contactNotes: body.contactNotes
          ? `Phone reservation. ${body.contactNotes}`
          : 'Phone reservation',
        paymentMethod: paymentMethodOnly,
        // cardMeta intentionally not passed for storage
      });
      if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });

      // Allow admin amount overrides
      const rentSubtotal =
        body.rentSubtotal != null && body.rentSubtotal !== ''
          ? Number(body.rentSubtotal)
          : parsed.data.tax?.subtotal ?? parsed.data.total;
      const stateTax =
        body.stateTax != null && body.stateTax !== ''
          ? Number(body.stateTax)
          : parsed.data.tax?.stateTax ?? 0;
      const countyTax =
        body.countyTax != null && body.countyTax !== ''
          ? Number(body.countyTax)
          : parsed.data.tax?.countyTax ?? 0;
      const grandTotal =
        body.grandTotal != null && body.grandTotal !== ''
          ? Number(body.grandTotal)
          : Math.round((rentSubtotal + stateTax + countyTax) * 100) / 100;

      parsed.data.total = grandTotal;
      if (parsed.data.tax) {
        parsed.data.tax = {
          ...parsed.data.tax,
          subtotal: rentSubtotal,
          stateTax,
          countyTax,
          totalTax: Math.round((stateTax + countyTax) * 100) / 100,
          grandTotal,
        };
      }

      const email = parsed.data.email;
      const payLabel = parsed.data.paymentMethod;
      const force = !!body.force;

      // Atomic reserve so phone + online cannot double-book the same site
      const reserved = updateSlotIf(
        slotId,
        slot => {
          if (slot.status === 'maintenance') {
            return 'Site is under maintenance and cannot be reserved';
          }
          if (slot.status === 'occupied') {
            return slotConflictForStay(slot, checkIn, checkOut) || 'Site is occupied';
          }
          if (slot.status === 'reserved' && !force) {
            const sameGuest =
              (slot.contactName || '').toLowerCase() === guestName.toLowerCase();
            if (!sameGuest) {
              return 'Site is already reserved. Choose another site or clear it first.';
            }
          }
          if (slot.status === 'available' || slot.status === 'reserved') {
            return slotConflictForStay(slot, checkIn, checkOut, {
              allowSameEmail: email !== 'phone-guest@local' ? email : undefined,
            });
          }
          return `Site is ${slot.status} and cannot be reserved`;
        },
        {
          ...buildSlotBookingUpdates(parsed.data, paid),
          status: 'reserved',
          startDate: checkIn,
          endDate: checkOut,
          contactAddress: contactAddress || undefined,
          paymentMethod: paid ? payLabel : undefined,
          notes: paid
            ? `Phone reservation · paid via ${payLabel}`
            : 'Phone reservation · payment pending',
        }
      );
      if (reserved.ok === false) {
        const notFound = reserved.error === 'Site not found';
        return res.status(notFound ? 404 : 400).json({ error: reserved.error });
      }
      const updated = reserved.slot;
      const slot = updated;

      // Always keep returning customer directory updated for autofill next time
      upsertCustomer({
        name: parsed.data.name,
        phone: parsed.data.contactPhone,
        email: email !== 'phone-guest@local' ? parsed.data.email : undefined,
        rvType: parsed.data.contactRvType,
        licensePlate: parsed.data.contactLicensePlate,
        emergencyContact: parsed.data.contactEmergency,
        notes: parsed.data.contactNotes,
      });

      // Save brand + last 4 for renewals (never full PAN)
      const cardLast4 = String(body.cardLast4 || body.last4 || '')
        .replace(/\D/g, '')
        .slice(-4);
      const cardBrand = String(body.cardBrand || body.brand || 'Card').trim() || 'Card';
      if (cardLast4.length === 4) {
        try {
          upsertPaymentCardRef({
            brand: cardBrand,
            last4: cardLast4,
            guestName,
            guestEmail: email !== 'phone-guest@local' ? email : undefined,
            guestPhone: parsed.data.contactPhone,
            site: String(updated?.number ?? slot.number),
            source: 'phone',
            isDefault: true,
          });
        } catch (err) {
          console.error('Card ref save on phone booking failed:', err);
        }
      }

      let receipt = null;
      if (paid) {
        receipt = saveGuestReceipt({
          bookedAt: new Date().toISOString().slice(0, 10),
          checkIn,
          checkOut,
          rentalType,
          guestName,
          guestEmail: email !== 'phone-guest@local' ? email : undefined,
          guestPhone: parsed.data.contactPhone || undefined,
          siteLabel: updated?.label ?? slot.label,
          siteNumber: updated?.number ?? slot.number,
          paymentMethod: payLabel,
          rentSubtotal,
          stateTax,
          countyTax,
          grandTotal,
          status: 'paid',
        });
      }

      const receiptId = `PF-PH-${String(updated?.number ?? slot.number).padStart(2, '0')}-${Date.now().toString().slice(-8)}`;

      res.status(201).json({
        success: true,
        total: grandTotal,
        paymentMethod: payLabel,
        checkIn,
        checkOut,
        siteLabel: updated?.label ?? slot.label,
        siteNumber: updated?.number ?? slot.number,
        paid,
        receiptId,
        receipt,
        channel: 'phone',
        message: paid
          ? 'Phone reservation saved with payment and receipt.'
          : 'Phone reservation saved (payment pending).',
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Could not save phone reservation' });
    }
  });

  /** Public: is online card checkout available (no secrets). */
  app.get('/api/public/payment-processor', (_req, res) => {
    res.json(getPublicCheckoutProcessorInfo());
  });

  app.post('/api/bookings', publicWriteRateLimit('bookings'), async (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;

    // Clover Data Security / PCI: never accept PAN/CVV on park servers.
    // Browser must tokenize via Clover Hosted iframe and send only paymentMethodToken (clv_…).
    const paymentMethodToken =
      typeof body.paymentMethodToken === 'string' ? body.paymentMethodToken.trim() : '';
    const payMethodHint = String(body.paymentMethod || 'Card').trim() || 'Card';
    const wantsCard =
      /^card\b/i.test(payMethodHint) || /••••|last\s*4/i.test(payMethodHint);

    // Hard-reject any raw card payload (legacy clients / scanners)
    const rawCard = body.card && typeof body.card === 'object' ? (body.card as Record<string, unknown>) : null;
    const rawNumber = String(
      body.cardNumber || body.number || (rawCard && (rawCard.number || rawCard.cardNumber)) || ''
    ).replace(/\D/g, '');
    if (rawNumber.length >= 12 || body.cvv || body.cvc || (rawCard && (rawCard.cvv || rawCard.cvc || rawCard.number))) {
      return res.status(400).json({
        error:
          'Full card numbers cannot be sent to the park website. Use the secure Clover payment form so only a token is submitted.',
        code: 'CARD_DATA_NOT_ALLOWED',
      });
    }

    // Build a body without any residual card fields for parseBookingRequest
    const safeBody: Record<string, unknown> = { ...body };
    delete safeBody.card;
    delete safeBody.cardNumber;
    delete safeBody.number;
    delete safeBody.cvv;
    delete safeBody.cvc;
    delete safeBody.paymentMethodToken;

    const parsed = parseBookingRequest(safeBody as Parameters<typeof parseBookingRequest>[0]);
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });

    let paid = true;
    let chargeInfo: {
      ok: boolean;
      processorPaymentId?: string;
      message?: string;
      last4?: string;
      testMode?: boolean;
    } | null = null;

    if (wantsCard) {
      const checkout = getPublicCheckoutProcessorInfo();
      if (!checkout.ready) {
        return res.status(503).json({
          error:
            checkout.message ||
            'Online card payment is not available right now. Choose Venmo, Zelle, cash, or check, or call the park.',
          processor: checkout,
        });
      }

      if (!paymentMethodToken || !paymentMethodToken.startsWith('clv_')) {
        return res.status(400).json({
          error:
            'A Clover card token is required. Reload the payment page and enter the card in the secure Clover form.',
          code: 'CLOVER_TOKEN_REQUIRED',
        });
      }

      const token = paymentMethodToken;
      let last4 = '';
      if (typeof body.cardLast4 === 'string') {
        last4 = String(body.cardLast4).replace(/\D/g, '').slice(-4);
      }

      const amountCents = Math.round(parsed.data.total * 100);
      if (!Number.isFinite(amountCents) || amountCents < 50) {
        return res.status(400).json({
          error: 'Booking total is too small to charge. Please check your dates.',
        });
      }

      const charge = await chargeWithProcessor({
        amountCents,
        currency: 'usd',
        description: `Pine Flats booking · ${parsed.data.name} · ${parsed.data.checkIn}→${parsed.data.checkOut}`.slice(
          0,
          255
        ),
        customerName: parsed.data.name,
        customerEmail: parsed.data.contactEmail || parsed.data.email,
        // Clover external_reference_id max 12 chars
        referenceId: `B${String(parsed.data.slotId || '').replace(/\W/g, '').slice(-4)}${Date.now().toString().slice(-6)}`,
        metadata: {
          channel: 'web',
          slot: String(parsed.data.slotId || '').slice(0, 16),
        },
        paymentMethodToken: token,
        ecomind: 'ecom',
        clientIp: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
          .split(',')[0]
          .trim() || undefined,
      });

      if (!charge.ok || (charge.status !== 'succeeded' && charge.status !== 'pending')) {
        return res.status(402).json({
          error: charge.message || 'Card was declined. Please try another card or payment method.',
          charged: false,
          status: charge.status,
        });
      }

      paid = true;
      chargeInfo = {
        ok: true,
        processorPaymentId: charge.processorPaymentId,
        message: charge.message,
        last4: last4 || undefined,
        testMode: charge.testMode,
      };
      // Record method as Card only (no PAN); charge id goes into notes via paymentMethod label
      parsed.data.paymentMethod = last4
        ? `Card •••• ${last4}`
        : 'Card';
      if (charge.processorPaymentId) {
        const note = `Clover ${charge.processorPaymentId}`;
        parsed.data.contactNotes = parsed.data.contactNotes
          ? `${parsed.data.contactNotes} · ${note}`
          : note;
      }
    }

    let result: Awaited<ReturnType<typeof saveBookingToSlot>>;
    try {
      result = await saveBookingToSlot(parsed.data, paid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not complete booking';
      const code = (e as { statusCode?: number }).statusCode === 400 ? 400 : 500;
      // Charge may have succeeded but slot save failed — surface clearly for staff follow-up
      return res.status(code).json({
        error: msg,
        charged: !!chargeInfo?.ok,
        processorPaymentId: chargeInfo?.processorPaymentId,
      });
    }

    // Automatic receipt emails: guest + Pine Flats (non-blocking for booking success)
    let email: Awaited<ReturnType<typeof sendBookingReceiptEmails>> | null = null;
    try {
      email = await sendBookingReceiptEmails({
        booking: parsed.data,
        siteLabel: result.siteLabel,
        siteNumber: result.siteNumber,
        paid,
      });
    } catch (err) {
      console.error('Booking receipt email failed:', err);
    }

    // SMS alert to park phone (non-blocking)
    let sms: Awaited<ReturnType<typeof sendBookingSmsAlert>> | null = null;
    try {
      sms = await sendBookingSmsAlert({
        guestName: parsed.data.name,
        siteLabel: result.siteLabel,
        checkIn: parsed.data.checkIn,
        checkOut: parsed.data.checkOut,
        total: parsed.data.total,
        paymentMethod: parsed.data.paymentMethod,
        channel: 'website',
      });
    } catch (err) {
      console.error('Booking SMS alert failed:', err);
    }

    res.status(201).json({
      ...result,
      paid,
      charged: !!chargeInfo?.ok,
      processorPaymentId: chargeInfo?.processorPaymentId,
      chargeTestMode: chargeInfo?.testMode,
      emailSent: !!(email?.customerSent || email?.parkSent),
      email: email
        ? {
            customerSent: email.customerSent,
            parkSent: email.parkSent,
            mode: email.mode,
            error: email.error,
          }
        : { customerSent: false, parkSent: false, mode: 'log' as const, error: 'Email service error' },
      smsSent: !!(sms?.ok && sms.mode === 'twilio'),
      sms: sms
        ? { ok: sms.ok, mode: sms.mode, to: sms.to, error: sms.error }
        : undefined,
    });
  });

  app.post('/api/slots/:id/remove-tenant', (req, res) => {
    const slots = getSlots();
    const slot = slots.find(s => s.id === req.params.id);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });

    const hasTenant = !!(slot.tenantId || slot.tenantName || slot.contactName);
    if (!hasTenant && slot.status === 'available') {
      return res.status(400).json({ error: 'No tenant assigned to this site' });
    }

    // Remove daily/weekly tax rows for this stay so Reports → Tax updates immediately
    removeTaxLedgerForSlotReservation({
      id: slot.id,
      number: slot.number,
      startDate: slot.startDate,
      endDate: slot.endDate,
      contactName: slot.contactName,
      tenantName: slot.tenantName,
      rentalType: slot.rentalType,
    });

    if (slot.tenantId) {
      const tenant = getTenant(slot.tenantId);
      if (tenant) {
        removeTenantById(tenant.id);
        deleteTenantPayment(tenant.id);
      } else {
        removeTenantById(slot.tenantId);
        deleteTenantPayment(slot.tenantId);
      }
    } else if (slot.tenantName) {
      removeTenantByName(slot.tenantName);
    }

    const updated = updateSlot(slot.id, {
      ...SLOT_CONTACT_CLEAR,
      status: 'available',
      paymentMethod: undefined,
      bookedAt: undefined,
    });

    res.json({ ok: true, slot: updated });
  });

  /**
   * Set (or convert) the guest/tenant on a site to monthly or weekly rental.
   * Keeps contact, stay dates, rent history, meters, and card refs.
   * Body.rentalType: 'monthly' | 'weekly' (default monthly). Daily guests can upgrade either way.
   */
  app.post('/api/slots/:id/convert-to-tenant', (req, res) => {
    try {
      const slots = getSlots();
      const slot = slots.find(s => s.id === req.params.id);
      if (!slot) return res.status(404).json({ error: 'Site not found' });

      if (slot.status === 'available' || slot.status === 'maintenance') {
        return res.status(400).json({
          error: 'Site has no guest to convert. Open a reserved or occupied stay first.',
        });
      }

      const existingTenant = slot.tenantId ? getTenant(slot.tenantId) : null;
      const body = req.body || {};
      const name = String(
        body.contactName || slot.contactName || slot.tenantName || existingTenant?.name || ''
      ).trim();
      if (!name) {
        return res.status(400).json({ error: 'Guest name is required to convert to tenant' });
      }

      // Tenants are monthly or weekly (daily stays remain short-term until converted)
      const targetRental: RentalType =
        body.rentalType === 'weekly' ? 'weekly' : body.rentalType === 'daily' ? 'daily' : 'monthly';

      const currentType = existingTenant?.rentalType || slot.rentalType || '';
      if (
        existingTenant
        && currentType === targetRental
        && slot.rentalType === targetRental
      ) {
        return res.status(400).json({
          error: `This site already has a ${targetRental} tenant. Edit them under Tenants or change Rental Type and Save.`,
          tenantId: existingTenant.id,
        });
      }

      const phone = String(
        body.contactPhone ?? slot.contactPhone ?? existingTenant?.phone ?? ''
      ).trim();
      const email = String(
        body.contactEmail ?? slot.contactEmail ?? existingTenant?.email ?? ''
      ).trim();
      const address = String(
        body.contactAddress ?? slot.contactAddress ?? existingTenant?.address ?? ''
      ).trim();
      const rvType = String(
        body.contactRvType ?? slot.contactRvType ?? existingTenant?.rvType ?? ''
      ).trim();
      const licensePlate = String(
        body.contactLicensePlate ?? slot.contactLicensePlate ?? existingTenant?.licensePlate ?? ''
      ).trim();
      const emergency = String(
        body.contactEmergency ?? slot.contactEmergency ?? existingTenant?.emergencyContact ?? ''
      ).trim();
      const notes = String(
        body.contactNotes ?? slot.contactNotes ?? slot.notes ?? existingTenant?.notes ?? ''
      ).trim();

      const startDate =
        String(body.startDate || slot.startDate || existingTenant?.startDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const endDate =
        targetRental === 'monthly'
          ? 'ongoing'
          : body.endDate === 'ongoing' || body.endDate === ''
            ? (existingTenant?.endDate || slot.endDate || 'ongoing')
            : String(body.endDate || slot.endDate || existingTenant?.endDate || 'ongoing').slice(0, 10);

      // Prefer rate for the target rental type (not leftover short-term amount)
      const defaultRate = rentAmountForType(targetRental);
      const resolvedRent =
        body.rentAmount != null && body.rentAmount !== ''
          ? Number(body.rentAmount)
          : defaultRate;
      const overage = Number(slot.meterOverageCharge) || 0;
      const resolvedBalance =
        body.balanceDue != null && body.balanceDue !== ''
          ? Number(body.balanceDue)
          : Math.round((resolvedRent + overage) * 100) / 100;

      const priorType =
        existingTenant?.rentalType || slot.rentalType || 'daily';
      const convertNote = `Rental set from ${priorType} to ${targetRental} on ${slot.label}${
        slot.startDate && slot.endDate ? ` (${slot.startDate} → ${slot.endDate})` : ''
      }.`;

      // Update existing tenant in place (monthly ↔ weekly, or short-term → tenant)
      if (existingTenant) {
        const tenant = updateTenant(existingTenant.id, {
          name,
          site: String(slot.number),
          status: 'Active',
          rentalType: targetRental,
          phone,
          email,
          address: address || undefined,
          rvType,
          licensePlate,
          emergencyContact: emergency,
          notes: [notes, convertNote].filter(Boolean).join('\n'),
          startDate,
          endDate,
          description: convertNote,
        });

        updateTenantPayment(existingTenant.id, {
          rentalType: targetRental,
          rentAmount: resolvedRent,
          balanceDue: resolvedBalance,
          ...(targetRental === 'monthly'
            ? { baseMonthlyRate: resolvedRent }
            : {}),
        });

        assignSlot(String(slot.number), {
          id: existingTenant.id,
          name,
          startDate,
          endDate,
          description: convertNote,
        });

        const updated = updateSlot(slot.id, {
          status: 'occupied',
          tenantId: existingTenant.id,
          tenantName: name,
          rentalType: targetRental,
          rentAmount: resolvedRent,
          balanceDue: resolvedBalance,
          startDate,
          endDate,
          contactName: undefined,
          contactPhone: undefined,
          contactEmail: undefined,
          contactAddress: undefined,
          contactRvType: undefined,
          contactLicensePlate: undefined,
          contactEmergency: undefined,
          contactNotes: undefined,
          notes: convertNote,
        });

        upsertCustomer({
          name,
          phone,
          email,
          rvType,
          licensePlate,
          emergencyContact: emergency,
          notes,
        });

        return res.json({
          ok: true,
          tenant,
          slot: updated ?? getSlots().find(s => s.id === slot.id),
          message: `${name} is now a ${targetRental} tenant on ${slot.label}. Prior payment history was kept.`,
        });
      }

      const tenantId = nextTenantId();
      const tenant = addTenant({
        id: tenantId,
        name,
        site: String(slot.number),
        status: 'Active',
        rentalType: targetRental,
        phone,
        email,
        address: address || undefined,
        rvType,
        licensePlate,
        emergencyContact: emergency,
        notes: [notes, convertNote].filter(Boolean).join('\n'),
        startDate,
        endDate,
        description: convertNote,
        imageUrl:
          slot.imageUrl ||
          'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400',
      });

      updateTenantPayment(tenantId, {
        rentalType: targetRental,
        rentAmount: resolvedRent,
        balanceDue: resolvedBalance,
        previousMeterReading: Number(slot.previousMeterReading) || 0,
        baselineCredit: Number(slot.meterBaselineCredit) || 0,
        ...(targetRental === 'monthly' ? { baseMonthlyRate: resolvedRent } : {}),
      });

      // Transfer site meter history (oldest first) for overage continuity
      const meters = [...(slot.meterRecords || [])].reverse();
      for (const m of meters) {
        try {
          addMeterRecord(tenantId, {
            date: m.date,
            reading: m.reading,
            previousReading: m.previousReading,
            note: m.note,
          });
        } catch (err) {
          console.error('Meter transfer failed:', err);
        }
      }

      upsertCustomer({
        name,
        phone,
        email,
        rvType,
        licensePlate,
        emergencyContact: emergency,
        notes,
      });

      try {
        const cards = listPaymentCardRefs({
          email: email || undefined,
          name,
        });
        for (const c of cards.slice(0, 5)) {
          applyCardRefToTenant(c.id, tenantId);
        }
      } catch (err) {
        console.error('Card ref attach on convert failed:', err);
      }

      assignSlot(String(slot.number), {
        id: tenantId,
        name,
        startDate,
        endDate,
        description: convertNote,
      });

      const updated = updateSlot(slot.id, {
        status: 'occupied',
        tenantId,
        tenantName: name,
        rentalType: targetRental,
        rentAmount: resolvedRent,
        balanceDue: resolvedBalance,
        startDate,
        endDate,
        paymentMethod: slot.paymentMethod,
        bookedAt: slot.bookedAt || new Date().toISOString().slice(0, 10),
        contactName: undefined,
        contactPhone: undefined,
        contactEmail: undefined,
        contactAddress: undefined,
        contactRvType: undefined,
        contactLicensePlate: undefined,
        contactEmergency: undefined,
        contactNotes: undefined,
        previousMeterReading: undefined,
        meterBaselineCredit: undefined,
        currentMeterUsage: undefined,
        meterOverageCharge: undefined,
        meterRecords: undefined,
        notes: convertNote,
      });

      res.status(201).json({
        ok: true,
        tenant,
        slot: updated ?? getSlots().find(s => s.id === slot.id),
        message: `${name} is now a ${targetRental} tenant on ${slot.label}. Contact, stay, meters, and card refs were saved.`,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Could not convert guest to tenant',
      });
    }
  });

  app.post('/api/slots/:id/add-tenant', (req, res) => {
    const slots = getSlots();
    const slot = slots.find(s => s.id === req.params.id);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    if (slot.status !== 'available') {
      return res.status(400).json({ error: 'Only available sites can add a new tenant' });
    }

    const {
      contactName,
      contactPhone,
      contactEmail,
      contactAddress,
      contactRvType,
      contactLicensePlate,
      contactEmergency,
      contactNotes,
      rentalType = 'monthly',
      rentAmount,
      balanceDue,
    } = req.body;

    const name = (contactName || '').trim();
    if (!name) return res.status(400).json({ error: 'Contact name is required' });

    const resolvedRent = Number(rentAmount) || rentAmountForType(rentalType);
    const resolvedBalance = Number(balanceDue) || resolvedRent;
    const tenantId = nextTenantId();
    const address = String(contactAddress || '').trim();

    const tenant = addTenant({
      id: tenantId,
      name,
      site: String(slot.number),
      status: 'Active',
      rentalType,
      phone: contactPhone || '',
      email: contactEmail || '',
      address: address || undefined,
      rvType: contactRvType || '',
      licensePlate: contactLicensePlate || '',
      emergencyContact: contactEmergency || '',
      notes: contactNotes || '',
      endDate: 'ongoing',
      imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400',
    });

    updateTenantPayment(tenantId, {
      rentalType,
      rentAmount: resolvedRent,
      balanceDue: resolvedBalance,
    });

    assignSlot(String(slot.number), {
      id: tenantId,
      name,
      endDate: 'ongoing',
      description: contactNotes,
    });

    updateSlot(slot.id, {
      contactName: undefined,
      contactPhone: undefined,
      contactEmail: undefined,
      contactAddress: undefined,
      contactRvType: undefined,
      contactLicensePlate: undefined,
      contactEmergency: undefined,
      contactNotes: undefined,
      rentAmount: undefined,
      rentalType: undefined,
      balanceDue: undefined,
    });

    res.json({ tenant, slot: getSlots().find(s => s.id === slot.id) });
  });

  app.get('/api/sheets/status', (req, res) => {
    const spreadsheetId = getSpreadsheetId();
    res.json({
      connected: !!spreadsheetId,
      spreadsheetId,
      url: spreadsheetId ? getSpreadsheetUrl(spreadsheetId) : null,
    });
  });

  app.post('/api/sheets/setup', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Google sign-in required' });

      const spreadsheetId = await createSlotsSpreadsheet(token);
      const slots = getSlots();
      await writeSlotsToSheet(token, spreadsheetId, slots);
      setSpreadsheetId(spreadsheetId);

      res.json({
        spreadsheetId,
        url: getSpreadsheetUrl(spreadsheetId),
        message: 'Google Sheet created with all 25 sites',
      });
    } catch (error) {
      console.error('Sheet setup error:', error);
      res.status(500).json({ error: 'Failed to create Google Sheet' });
    }
  });

  app.post('/api/sheets/sync-to', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Google sign-in required' });

      const spreadsheetId = getSpreadsheetId();
      if (!spreadsheetId) return res.status(400).json({ error: 'No sheet connected. Run setup first.' });

      const slots = getSlots();
      await writeSlotsToSheet(token, spreadsheetId, slots);
      res.json({ message: 'Synced to Google Sheets', url: getSpreadsheetUrl(spreadsheetId) });
    } catch (error) {
      console.error('Sync to sheet error:', error);
      res.status(500).json({ error: 'Failed to sync to Google Sheets' });
    }
  });

  app.post('/api/sheets/sync-from', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Google sign-in required' });

      const spreadsheetId = getSpreadsheetId();
      if (!spreadsheetId) return res.status(400).json({ error: 'No sheet connected. Run setup first.' });

      const slots = await readSlotsFromSheet(token, spreadsheetId);
      saveSlots(slots);
      res.json({ slots, available: slots.filter(s => s.status === 'available').length });
    } catch (error) {
      console.error('Sync from sheet error:', error);
      res.status(500).json({ error: 'Failed to sync from Google Sheets' });
    }
  });

  app.post('/api/assistant', async (req, res) => {
    try {
      const { message, history } = req.body;
      
      const slots = getSlots();
      const tenants = getTenants();
      const systemInstruction = `You are the Pine Flats RV Park Assistant. You help owners Dave and Melinda manage the RV park.
Keep responses concise, friendly, and helpful. You can move tenants and manage photos using tools provided.
The park has ${TOTAL_SLOTS} total sites. ${getAvailableCount()} are currently available.
Current tenants: ${JSON.stringify(tenants)}
Current site slots: ${JSON.stringify(slots)}
Current photos: ${JSON.stringify(getPhotos())}
`;

      const moveTenantTool = {
        name: 'moveTenant',
        description: 'Move an existing tenant to a new site',
        parameters: {
          type: Type.OBJECT,
          properties: {
            tenantName: {
              type: Type.STRING,
              description: 'The name of the tenant to move'
            },
            newSite: {
              type: Type.STRING,
              description: 'The new site to move the tenant to (e.g. C12)'
            }
          },
          required: ['tenantName', 'newSite']
        }
      };

      const addTenantTool = {
        name: 'addTenant',
        description: 'Add a new tenant to the RV park',
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Full name of the tenant' },
            site: { type: Type.STRING, description: 'Assigned site/lot number' },
            startDate: { type: Type.STRING, description: 'Start date of the stay' },
            endDate: { type: Type.STRING, description: 'Expected end date of the stay' },
            description: { type: Type.STRING, description: 'Notes or description about the tenant or RV' }
          },
          required: ['name', 'site']
        }
      };

      const deleteTenantTool = {
        name: 'deleteTenant',
        description: 'Delete/remove a tenant from the RV park',
        parameters: {
          type: Type.OBJECT,
          properties: {
            tenantName: { type: Type.STRING, description: 'The name of the tenant to delete' }
          },
          required: ['tenantName']
        }
      };

      const chat = ai.chats.create({
        model: 'gemini-3.5-flash',
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: [moveTenantTool, addTenantTool, deleteTenantTool] }],
          temperature: 0.2
        } // history omitted for simplicity in this demo to avoid complex history mapping
      });

      const response = await chat.sendMessage({ message });

      let responseText = response.text;
      
      // Execute local function if a call is present
      if (response.functionCalls && response.functionCalls.length > 0) {
          const call = response.functionCalls[0];
          if (call.name === 'moveTenant') {
              const { tenantName, newSite } = call.args as any;
              const tenant = findTenantByName(tenantName);
              if (tenant) {
                  updateTenant(tenant.id, { site: newSite });
                  moveTenantSlot(tenant.name, newSite);
                  responseText = `I've moved ${tenant.name} to site ${newSite} as requested.`;
              } else {
                  responseText = `I couldn't find a tenant named ${tenantName}.`;
              }
          } else if (call.name === 'addTenant') {
              const { name, site, startDate, endDate, description } = call.args as any;
              const newTenant = {
                id: Math.random().toString(36).substr(2, 9),
                name,
                site,
                status: 'Active',
                imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400',
                startDate: startDate || new Date().toISOString().split('T')[0],
                endDate: endDate || 'ongoing',
                description: description || ''
              };
              addTenant(newTenant);
              assignSlot(site, newTenant);
              responseText = `I've added ${name} to site ${site}.`;
          } else if (call.name === 'deleteTenant') {
              const { tenantName } = call.args as any;
              if (removeTenantByName(tenantName)) {
                  clearSlotByTenant(tenantName);
                  responseText = `I've removed ${tenantName} from the system.`;
              } else {
                  responseText = `I couldn't find a tenant named ${tenantName} to remove.`;
              }
          }
      }

      res.json({ text: responseText, functionCalls: response.functionCalls });
    } catch (error) {
      console.error('Error in AI Assistant', error);
      res.status(500).json({ error: 'Failed to process request' });
    }
  });

  // VPS/SSH helper UI is desktop-only (Electron). Never expose on the public website
  // (ASV / Clover Data Security Manager flags remote-access software on the CDE web host).
  app.get(['/ssh', '/ssh/', '/vps', '/vps/', '/ssh.html'], (req, res, next) => {
    if (isProd) {
      return res.status(404).type('text/plain').send('Not found');
    }
    // Dev only: Vite multi-page entry for local tooling
    req.url = '/ssh.html';
    next();
  });

  // --- Vite Middleware (Development) ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa',
    });
    app.use(vite.middlewares);
  } else {
    // --- Production Static Serving ---
    const distPath = path.join(process.cwd(), 'dist');
    // Prefer explicit SEO files from dist (robots.txt / sitemap.xml)
    app.get('/robots.txt', (_req, res) => {
      const p = path.join(distPath, 'robots.txt');
      if (fs.existsSync(p)) return res.type('text/plain').sendFile(p);
      res
        .type('text/plain')
        .send(
          'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /ssh\nDisallow: /vps\nDisallow: /uploads/\nSitemap: https://pineflatsrvpark.com/sitemap.xml\n'
        );
    });
    app.get('/sitemap.xml', (_req, res) => {
      const p = path.join(distPath, 'sitemap.xml');
      if (fs.existsSync(p)) return res.type('application/xml').sendFile(p);
      res.type('application/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
          `<url><loc>https://pineflatsrvpark.com/</loc></url>` +
          `<url><loc>https://pineflatsrv.com/</loc></url></urlset>`
      );
    });
    app.use(express.static(distPath, {
      index: false,
      redirect: false,
      dotfiles: 'deny',
      // Avoid caching HTML shell forever; assets are hashed by Vite
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    }));
    // Admin SPA only (password-gated); no public remote-access pages
    app.get(['/admin', '/admin/*'], (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
      }
      const p = req.path.toLowerCase();
      // Directory browsing probes: any trailing-slash path except site root
      if (p !== '/' && p.endsWith('/')) {
        return res.status(403).type('text/plain').send('Directory listing disabled');
      }
      // Do not serve the SPA shell for secret / source / remote-access probes
      if (
        p.includes('/.') ||
        p === '/ssh' ||
        p === '/vps' ||
        p === '/ssh.html' ||
        /\.(env|git|sql|bak|old|log|yml|yaml|toml|ini|cfg|conf|key|pem|map)$/i.test(p) ||
        /\/(package(-lock)?\.json|tsconfig.*\.json|server\.ts|vite\.config\.\w+|composer\.json|webpack\.config|dockerfile|docker-compose|readme\.md|license|\.git|node_modules|data\/|src\/)/i.test(
          p
        )
      ) {
        return res.status(404).type('text/plain').send('Not found');
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // In production (behind nginx) bind loopback only so port 3000 is not public
  const listenHost =
    process.env.LISTEN_HOST ||
    (isProd ? '127.0.0.1' : '0.0.0.0');
  app.listen(PORT, listenHost, () => {
    console.log(`Server running on http://${listenHost}:${PORT}`);
  });
}

startServer();
