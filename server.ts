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
  moveTenantSlot, getAvailableCount, getSpreadsheetId, setSpreadsheetId, TOTAL_SLOTS
} from './server/slotsStore';

import {
  createSlotsSpreadsheet, writeSlotsToSheet, readSlotsFromSheet, getSpreadsheetUrl
} from './server/googleSheets';
import {
  getTenants, getTenant, updateTenant, addTenant, removeTenantByName, findTenantByName, nextTenantId
} from './server/tenantsStore';
import {
  getTenantPayment, updateTenantPayment, addPaymentRecord, addMeterRecord
} from './server/paymentsStore';
import {
  getReceiptConfig, setReceiptDocUrl, setReceiptDocId, getReceiptUrlForSpace, extractDocId
} from './server/receiptsStore';
import {
  listDocuments, verifyDocumentAccess, createReceiptDocument, getDocumentUrl
} from './server/googleDocs';
import { rentAmountForType, calculateStayTotal, parseDateKey } from './rentUtils';
import {
  getPhotos, getPublishedPhotos, addPhoto, updatePhoto, deletePhoto, reorderPhotos
} from './server/photosStore';
import { getContactInfo, updateContactInfo } from './server/contactStore';
import {
  getCustomers, addCustomer, updateCustomer, deleteCustomer, upsertCustomer
} from './server/customersStore';
import { SLOT_CONTACT_CLEAR, clearSlotContactFields } from './server/slotContactUtils';

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

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 40) || 'photo';
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
  ...imageUploadOptions,
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

  // Data routes
  app.get('/api/tenants', (req, res) => {
    res.json(getTenants());
  });

  app.get('/api/tenants/:id', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json(tenant);
  });

  app.put('/api/tenants/:id', (req, res) => {
    const updated = updateTenant(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Tenant not found' });
    res.json(updated);
  });

  app.get('/api/tenants/:id/payments', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json(getTenantPayment(req.params.id));
  });

  app.put('/api/tenants/:id/payments', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const updated = updateTenantPayment(req.params.id, req.body);
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

  app.post('/api/tenants/:id/payments/meter', (req, res) => {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const { date, reading, note } = req.body;
    if (reading === undefined || reading === null || Number(reading) < 0) {
      return res.status(400).json({ error: 'Invalid meter reading' });
    }
    const updated = addMeterRecord(req.params.id, {
      date: date || new Date().toISOString().split('T')[0],
      reading: Number(reading),
      note,
    });
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

  app.get('/api/photos', (req, res) => {
    const publishedOnly = req.query.published === 'true';
    res.json(publishedOnly ? getPublishedPhotos() : getPhotos());
  });

  app.post('/api/photos', (req, res) => {
    const { url, caption, published } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Photo URL is required' });
    }
    const photo = addPhoto({
      url,
      caption: (caption || 'Park Photo').trim(),
      published: published !== false,
    });
    res.status(201).json(photo);
  });

  app.post('/api/photos/upload', (req, res) => {
    photoUpload.single('photo')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No photo file provided' });
      }
      const caption = (req.body.caption || 'Park Photo').trim();
      const published = req.body.published !== 'false';
      const photo = addPhoto({
        url: `/uploads/${req.file.filename}`,
        caption,
        published,
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

  app.get('/api/customers', (_req, res) => {
    res.json(getCustomers());
  });

  app.post('/api/customers', (req, res) => {
    const { name, phone, email, rvType, licensePlate, emergencyContact, notes } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    const customer = addCustomer({ name, phone, email, rvType, licensePlate, emergencyContact, notes });
    res.status(201).json(customer);
  });

  app.post('/api/customers/upsert', (req, res) => {
    const { name, phone, email, rvType, licensePlate, emergencyContact, notes } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    res.json(upsertCustomer({ name, phone, email, rvType, licensePlate, emergencyContact, notes }));
  });

  app.put('/api/customers/:id', (req, res) => {
    const updated = updateCustomer(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Customer not found' });
    res.json(updated);
  });

  app.delete('/api/customers/:id', (req, res) => {
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

  app.post('/api/bookings', (req, res) => {
    const {
      slotId,
      rentalType = 'monthly',
      checkIn,
      checkOut,
      contactName,
      contactPhone,
      contactEmail,
      contactRvType,
      contactLicensePlate,
      contactEmergency,
      contactNotes,
      paymentMethod,
    } = req.body;

    const name = (contactName || '').trim();
    if (!name) return res.status(400).json({ error: 'Contact name is required' });
    if (!slotId) return res.status(400).json({ error: 'Site is required' });
    if (!checkIn || !checkOut) return res.status(400).json({ error: 'Check-in and check-out dates are required' });

    const slots = getSlots();
    const slot = slots.find(s => s.id === slotId);
    if (!slot) return res.status(404).json({ error: 'Site not found' });
    if (slot.status !== 'available') {
      return res.status(400).json({ error: 'This site is no longer available' });
    }

    const checkInDate = parseDateKey(checkIn);
    const checkOutDate = parseDateKey(checkOut);
    if (checkOutDate <= checkInDate) {
      return res.status(400).json({ error: 'Check-out must be after check-in' });
    }

    const total = calculateStayTotal(rentalType, checkInDate, checkOutDate);
    if (total <= 0) return res.status(400).json({ error: 'Invalid stay dates' });

    upsertCustomer({
      name,
      phone: contactPhone,
      email: contactEmail,
      rvType: contactRvType,
      licensePlate: contactLicensePlate,
      emergencyContact: contactEmergency,
      notes: contactNotes,
    });

    const updated = updateSlot(slotId, {
      status: 'reserved',
      contactName: name,
      contactPhone: contactPhone || '',
      contactEmail: contactEmail || '',
      contactRvType: contactRvType || '',
      contactLicensePlate: contactLicensePlate || '',
      contactEmergency: contactEmergency || '',
      contactNotes: contactNotes || '',
      rentalType,
      rentAmount: total,
      balanceDue: 0,
      startDate: checkIn,
      endDate: checkOut,
      paymentMethod: paymentMethod || 'Card',
      bookedAt: new Date().toISOString().split('T')[0],
      notes: `Booked online via ${paymentMethod || 'Card'}`,
    });

    res.status(201).json({
      success: true,
      slot: maintainSlots().find(s => s.id === slotId) ?? updated,
      total,
      paymentMethod: paymentMethod || 'Card',
      checkIn,
      checkOut,
    });
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
