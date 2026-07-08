import { google } from 'googleapis';

function getAuth(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export function getDocumentUrl(docId: string): string {
  return `https://docs.google.com/document/d/${docId}/edit`;
}

export async function verifyDocumentAccess(
  accessToken: string,
  docId: string
): Promise<{ title: string }> {
  const docs = google.docs({ version: 'v1', auth: getAuth(accessToken) });
  const response = await docs.documents.get({ documentId: docId });
  return { title: response.data.title ?? 'Untitled' };
}

export interface GoogleDocSummary {
  id: string;
  name: string;
  modifiedTime: string;
  url: string;
}

export async function listDocuments(
  accessToken: string,
  pageSize = 25
): Promise<GoogleDocSummary[]> {
  const drive = google.drive({ version: 'v3', auth: getAuth(accessToken) });
  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.document' and trashed=false",
    pageSize,
    fields: 'files(id, name, modifiedTime, webViewLink)',
    orderBy: 'modifiedTime desc',
  });

  return (response.data.files ?? [])
    .filter((file): file is { id: string; name?: string | null; modifiedTime?: string | null; webViewLink?: string | null } => !!file.id)
    .map(file => ({
      id: file.id,
      name: file.name ?? 'Untitled',
      modifiedTime: file.modifiedTime ?? '',
      url: file.webViewLink ?? getDocumentUrl(file.id),
    }));
}

export async function createReceiptDocument(
  accessToken: string
): Promise<{ docId: string; url: string }> {
  const docs = google.docs({ version: 'v1', auth: getAuth(accessToken) });

  const createRes = await docs.documents.create({
    requestBody: {
      title: 'Pine Flats RV Park - Numbered Receipts',
    },
  });

  const docId = createRes.data.documentId;
  if (!docId) throw new Error('Failed to create document');

  const requests: Array<Record<string, unknown>> = [];
  let index = 1;

  for (let site = 1; site <= 25; site++) {
    const text = site < 25 ? `Site ${site} — Receipt Page\n` : `Site ${site} — Receipt Page`;
    requests.push({ insertText: { location: { index }, text } });
    index += text.length;
    if (site < 25) {
      requests.push({ insertPageBreak: { location: { index } } });
      index += 1;
    }
  }

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  return { docId, url: getDocumentUrl(docId) };
}