import { google } from 'googleapis';
import { Slot } from '../types';

const SHEET_NAME = 'Slots';
const HEADERS = ['Site #', 'Label', 'Status', 'Tenant', 'Start Date', 'End Date', 'Notes'];

function getSheetsClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: 'v4', auth });
}

export async function createSlotsSpreadsheet(accessToken: string): Promise<string> {
  const sheets = getSheetsClient(accessToken);

  const response = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: 'Pine Flats RV Park - Site Database' },
      sheets: [{ properties: { title: SHEET_NAME } }],
    },
  });

  const spreadsheetId = response.data.spreadsheetId;
  if (!spreadsheetId) throw new Error('Failed to create spreadsheet');

  return spreadsheetId;
}

export async function writeSlotsToSheet(
  accessToken: string,
  spreadsheetId: string,
  slots: Slot[]
) {
  const sheets = getSheetsClient(accessToken);

  const rows = slots.map(s => [
    s.number,
    s.label,
    s.status,
    s.tenantName ?? '',
    s.startDate ?? '',
    s.endDate ?? '',
    s.notes ?? '',
  ]);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS, ...rows] },
  });

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetId = meta.data.sheets?.[0]?.properties?.sheetId ?? 0;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: HEADERS.length,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.35, green: 0.39, blue: 0.33 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      }],
    },
  });
}

export async function readSlotsFromSheet(
  accessToken: string,
  spreadsheetId: string
): Promise<Slot[]> {
  const sheets = getSheetsClient(accessToken);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:G`,
  });

  const rows = response.data.values ?? [];
  return rows.map((row, i) => ({
    id: `slot-${row[0] ?? i + 1}`,
    number: Number(row[0]) || i + 1,
    label: String(row[1] || `Site ${i + 1}`),
    status: (['available', 'occupied', 'reserved', 'maintenance'].includes(row[2])
      ? row[2]
      : 'available') as Slot['status'],
    tenantName: row[3] || undefined,
    startDate: row[4] || undefined,
    endDate: row[5] || undefined,
    notes: row[6] || undefined,
  }));
}

export function getSpreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}