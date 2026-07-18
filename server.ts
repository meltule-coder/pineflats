import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envLocal = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: fs.existsSync(envLocal) ? envLocal : '.env' });
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import {
  getSlots, maintainSlots, updateSlot, saveSlots, assignSlot, clearSlotByTenant,
  clearSlotByTenantId, clearSlotBySiteNumber,
  moveTenantSlot, getAvailableCount, getSpreadsheetId, setSpreadsheetId, TOTAL_SLOTS
} from './server/slotsStore';

import {
  createSlotsSpreadsheet, writeSlotsToSheet, readSlotsFromSheet, getSpreadsheetUrl
} from './server/googleSheets';
import {
  getTenants, getTenant, updateTenant, addTenant, removeTenantByName, removeTenantById, findTenantByName, nextTenantId
} from './server/tenantsStore';
import {
  getTenantPayment, updateTenantPayment, addPaymentRecord, updatePaymentRecord, deletePaymentRecord,
  addExtraCharge, updateExtraCharge, deleteExtraCharge,
  addCredit, updateCredit, deleteCredit,
  addMeterRecord, setCurrentMeterReading, updateMeterRecord, deleteMeterRecord, deleteTenantPayment, startNewMonth,
  addSavedCard, updateSavedCard, deleteSavedCard, getAllPaymentTotals, getTotalPaidForTenant
} from './server/paymentsStore';
import {
  getReceiptConfig, setReceiptDocUrl, setReceiptDocId, getReceiptUrlForSpace, extractDocId
} from './server/receiptsStore';
import {
  listDocuments, verifyDocumentAccess, createReceiptDocument, getDocumentUrl
} from './server/googleDocs';
import { rentAmountForType } from './rentUtils';
import {
  getPhotos, getPublishedPhotos, addPhoto, updatePhoto, deletePhoto, reorderPhotos
} from './server/photosStore';
import { getContactInfo, updateContactInfo } from './server/contactStore';
import {
  getCustomers, addCustomer, updateCustomer, deleteCustomer, upsertCustomer
} from './server/customersStore';
import { getPublicAvailability, getPublicSiteBundle } from './server/publicData';
import { getComments, addComment } from './server/commentsStore';
import { SLOT_CONTACT_CLEAR, clearSlotContactFields } from './server/slotContactUtils';
import { verifyPreviewPassword, setPreviewPassword, getPreviewPassword } from './server/previewStore';
import {
  parseBookingRequest, canBookSlot, buildSlotBookingUpdates, ParsedBooking
} from './server/bookingUtils';

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
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // --- API Routes ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // --- Public website APIs (no tenant/customer/returning-guest PII) ---
  app.get('/api/public/availability', (_req, res) => {
    res.json(getPublicAvailability());
  });

  app.get('/api/public/site', (_req, res) => {
    res.json(getPublicSiteBundle());
  });

  app.get('/api/public/photos', (_req, res) => {
    res.json(getPublishedPhotos());
  });

  app.get('/api/preview/status', (_req, res) => {
    res.json({ configured: !!getPreviewPassword() });
  });

  app.post('/api/preview/login', (req, res) => {
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
    if (slot.status !== 'available') {
      return res.status(400).json({ error: `Site ${slot.number} is not available` });
    }

    const resolvedRentalType = ['daily', 'weekly', 'monthly'].includes(rentalType)
      ? rentalType
      : 'monthly';
    const resolvedRent = Number(rentAmount) || rentAmountForType(resolvedRentalType);
    const resolvedBalance = Number(balanceDue) || resolvedRent;
    const tenantId = nextTenantId();
    const resolvedStart = startDate || new Date().toISOString().split('T')[0];

    const tenant = addTenant({
      id: tenantId,
      name: tenantName,
      site: String(slot.number),
      status: 'Active',
      rentalType: resolvedRentalType,
      phone: String(phone || ''),
      email: String(email || ''),
      rvType: String(rvType || ''),
      licensePlate: String(licensePlate || ''),
      emergencyContact: String(emergencyContact || ''),
      notes: String(notes || ''),
      description: String(notes || ''),
      startDate: resolvedStart,
      endDate: String(endDate || 'ongoing'),
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
      endDate: String(endDate || 'ongoing'),
      description: String(notes || ''),
    });

    if (tenantName) {
      upsertCustomer({
        name: tenantName,
        phone: String(phone || ''),
        email: String(email || ''),
        rvType: String(rvType || ''),
        licensePlate: String(licensePlate || ''),
        emergencyContact: String(emergencyContact || ''),
        notes: String(notes || ''),
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
      'description', 'phone', 'email', 'rvType', 'licensePlate', 'emergencyContact', 'notes',
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

    if (body.rentalType || body.startDate !== undefined || body.endDate !== undefined) {
      // Recompute monthly proration when rental type or stay dates change
      updateTenantPayment(updated.id, {
        ...(body.rentalType ? { rentalType: body.rentalType } : {}),
      });
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

    clearSlotByTenantId(tenant.id);
    if (tenant.site) clearSlotBySiteNumber(tenant.site);
    if (tenant.name) clearSlotByTenant(tenant.name);
    removeTenantById(tenant.id);
    deleteTenantPayment(tenant.id);

    res.json({ ok: true, removed: tenant });
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

  app.post('/api/tenants/:id/payments/record', (req, res) => {
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
    res.json(updated);
  });

  app.post('/api/tenants/:id/payments/cards', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    // Security: never accept or log full PAN / CVV
    const body = req.body || {};
    const last4 = body.last4 ?? body.cardLast4;
    // If a longer number was sent, only last4 is used; full value is not persisted
    const updated = addSavedCard(req.params.id, {
      cardholderName: body.cardholderName,
      last4,
      brand: body.brand,
      expMonth: body.expMonth,
      expYear: body.expYear,
      billingZip: body.billingZip,
      label: body.label,
      notes: body.notes,
      isDefault: body.isDefault,
    });
    if (!updated) {
      return res.status(400).json({
        error: 'Cardholder name, last 4 digits, brand, and valid expiry are required. Full card numbers and CVV are not accepted.',
      });
    }
    res.status(201).json(updated);
  });

  app.put('/api/tenants/:id/payments/cards/:cardId', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const body = req.body || {};
    const updated = updateSavedCard(req.params.id, req.params.cardId, {
      cardholderName: body.cardholderName,
      last4: body.last4 ?? body.cardLast4,
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

  app.use('/uploads', express.static(UPLOADS_DIR));

  app.get('/api/contact', (req, res) => {
    res.json(getContactInfo());
  });

  app.put('/api/contact', (req, res) => {
    const { phone, email, contactName, address, tagline } = req.body;
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    res.json(updateContactInfo({ phone, email, contactName, address, tagline }));
  });

  app.get('/api/comments', (_req, res) => {
    res.json(getComments());
  });

  app.post('/api/comments', (req, res) => {
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

    if (updates.status === 'available') {
      Object.assign(updates, clearSlotContactFields({}));
    }

    const updated = updateSlot(req.params.id, updates);
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

  function saveBookingToSlot(parsed: ParsedBooking, paid: boolean) {
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

    updateSlot(parsed.slotId, buildSlotBookingUpdates(parsed, paid));
    const slot = maintainSlots().find(s => s.id === parsed.slotId);
    // Public booking response: no other guests' data; only this booking confirmation
    return {
      success: true as const,
      total: parsed.total,
      paymentMethod: parsed.paymentMethod,
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      siteLabel: slot?.label ?? parsed.slotId,
      siteNumber: slot?.number,
      status: paid ? 'reserved' as const : 'reserved' as const,
      paid,
    };
  }

  app.post('/api/bookings/start', (req, res) => {
    const parsed = parseBookingRequest(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const slot = getSlots().find(s => s.id === parsed.data.slotId);
    if (!slot) return res.status(404).json({ error: 'Site not found' });

    const slotError = canBookSlot(slot, parsed.data.email, true);
    if (slotError) return res.status(400).json({ error: slotError });

    const result = saveBookingToSlot(parsed.data, false);
    res.status(201).json(result);
  });

  app.post('/api/bookings', (req, res) => {
    const parsed = parseBookingRequest(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const slot = getSlots().find(s => s.id === parsed.data.slotId);
    if (!slot) return res.status(404).json({ error: 'Site not found' });

    const slotError = canBookSlot(slot, parsed.data.email, true);
    if (slotError) return res.status(400).json({ error: slotError });

    const result = saveBookingToSlot(parsed.data, true);
    res.status(201).json(result);
  });

  app.post('/api/slots/:id/remove-tenant', (req, res) => {
    const slots = getSlots();
    const slot = slots.find(s => s.id === req.params.id);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });

    const hasTenant = !!(slot.tenantId || slot.tenantName || slot.contactName);
    if (!hasTenant && slot.status === 'available') {
      return res.status(400).json({ error: 'No tenant assigned to this site' });
    }

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

    const tenant = addTenant({
      id: tenantId,
      name,
      site: String(slot.number),
      status: 'Active',
      rentalType,
      phone: contactPhone || '',
      email: contactEmail || '',
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

  // --- Vite Middleware (Development) ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // --- Production Static Serving ---
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
