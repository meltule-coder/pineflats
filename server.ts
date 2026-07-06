import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envLocal = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: fs.existsSync(envLocal) ? envLocal : '.env' });
import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import {
  getSlots, updateSlot, saveSlots, assignSlot, clearSlotByTenant,
  moveTenantSlot, getAvailableCount, getSpreadsheetId, setSpreadsheetId, TOTAL_SLOTS
} from './server/slotsStore';
import {
  createSlotsSpreadsheet, writeSlotsToSheet, readSlotsFromSheet, getSpreadsheetUrl
} from './server/googleSheets';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Using in-memory state for mock data
let tenants = [
  { 
    id: '1', 
    name: 'John Doe', 
    site: 'A1', 
    status: 'Active',
    imageUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400',
    startDate: '2024-05-01',
    endDate: '2024-10-31',
    description: 'Travel trailer. Needs 50amp hookup.'
  },
  { 
    id: '2', 
    name: 'Jane Smith', 
    site: 'B4', 
    status: 'Active',
    imageUrl: 'https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&q=80&w=400',
    startDate: '2023-01-15',
    endDate: '2025-01-15',
    description: 'Long term resident. Fifth wheel.'
  },
];

let photos = [
  { id: '1', url: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=400', caption: 'Campground Entrance' },
  { id: '2', url: 'https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&q=80&w=400', caption: 'Lake View Sites' },
];

async function startServer() {
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
    res.json(tenants);
  });

  app.get('/api/photos', (req, res) => {
    res.json(photos);
  });

  app.get('/api/slots', (req, res) => {
    const slots = getSlots();
    res.json({ slots, total: TOTAL_SLOTS, available: getAvailableCount() });
  });

  app.put('/api/slots/:id', (req, res) => {
    const updated = updateSlot(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Slot not found' });
    res.json(updated);
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
      const systemInstruction = `You are the Pine Flats RV Park Assistant. You help owners Dave and Melinda manage the RV park.
Keep responses concise, friendly, and helpful. You can move tenants and manage photos using tools provided.
The park has ${TOTAL_SLOTS} total sites. ${getAvailableCount()} are currently available.
Current tenants: ${JSON.stringify(tenants)}
Current site slots: ${JSON.stringify(slots)}
Current photos: ${JSON.stringify(photos)}
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
              const tenant = tenants.find(t => t.name.toLowerCase().includes(tenantName.toLowerCase()));
              if (tenant) {
                  tenant.site = newSite;
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
                endDate: endDate || 'TBD',
                description: description || ''
              };
              tenants.push(newTenant);
              assignSlot(site, newTenant);
              responseText = `I've added ${name} to site ${site}.`;
          } else if (call.name === 'deleteTenant') {
              const { tenantName } = call.args as any;
              const initialLen = tenants.length;
              tenants = tenants.filter(t => !t.name.toLowerCase().includes(tenantName.toLowerCase()));
              if (tenants.length < initialLen) {
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
