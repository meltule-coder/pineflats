import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export interface ReceiptConfig {
  receiptDocUrl: string;
  receiptDocId: string;
  receiptLinks: Record<string, string>;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadConfig(): Record<string, unknown> {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_FILE)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

function saveConfig(config: Record<string, unknown>) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function extractDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function buildPageLink(docId: string, spaceNumber: number, baseUrl?: string): string {
  const base = baseUrl?.replace(/#.*$/, '').replace(/\/edit.*$/, '') 
    || `https://docs.google.com/document/d/${docId}`;
  const editBase = base.includes('/edit') ? base.split('#')[0] : `${base}/edit`;
  return `${editBase}#page=${spaceNumber}`;
}

function generateLinksForSpaces(docId: string, baseUrl: string, spaces: number[]): Record<string, string> {
  const links: Record<string, string> = {};
  for (const n of spaces) {
    links[String(n)] = buildPageLink(docId, n, baseUrl);
  }
  return links;
}

const OCCUPIED_SPACES = [1, 3, 8, 10, 11, 12, 18, 19, 20, 21, 22, 23, 24];

export function getReceiptConfig(): ReceiptConfig {
  const config = loadConfig();
  const envUrl = process.env.RECEIPT_DOC_URL;
  if (!config.receiptDocUrl && envUrl) {
    try {
      return setReceiptDocUrl(envUrl);
    } catch {
      // ignore invalid env URL
    }
  }
  return {
    receiptDocUrl: (config.receiptDocUrl as string) ?? '',
    receiptDocId: (config.receiptDocId as string) ?? '',
    receiptLinks: (config.receiptLinks as Record<string, string>) ?? {},
  };
}

function saveReceiptDoc(docId: string, docUrl: string): ReceiptConfig {
  const receiptLinks = generateLinksForSpaces(
    docId,
    docUrl,
    [...OCCUPIED_SPACES, ...Array.from({ length: 25 }, (_, i) => i + 1)]
  );
  const config = loadConfig();
  config.receiptDocUrl = docUrl;
  config.receiptDocId = docId;
  config.receiptLinks = receiptLinks;
  saveConfig(config);
  return getReceiptConfig();
}

export function setReceiptDocUrl(docUrl: string): ReceiptConfig {
  const docId = extractDocId(docUrl);
  if (!docId) {
    throw new Error('Invalid Google Doc URL');
  }
  return saveReceiptDoc(docId, docUrl);
}

export function setReceiptDocId(docId: string, docUrl?: string): ReceiptConfig {
  if (!docId) {
    throw new Error('Document ID required');
  }
  const url = docUrl?.trim() || `https://docs.google.com/document/d/${docId}/edit`;
  return saveReceiptDoc(docId, url);
}

export function getReceiptUrlForSpace(spaceNumber: string | number): string | null {
  const config = getReceiptConfig();
  const key = String(spaceNumber);
  if (config.receiptLinks[key]) return config.receiptLinks[key];
  if (!config.receiptDocId) return null;
  return buildPageLink(config.receiptDocId, Number(key), config.receiptDocUrl);
}