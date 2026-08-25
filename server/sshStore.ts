import fs from 'fs';
import path from 'path';
import net from 'net';
import { atomicWriteJson } from './persist';

const DATA_DIR = path.join(process.cwd(), 'data');
const SSH_FILE = path.join(DATA_DIR, 'ssh-connections.json');

export interface SshConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  /** Optional OpenSSH identity file path (not uploaded; reference only) */
  identityFile?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type SshConnectionInput = {
  name: string;
  host: string;
  port?: number | string;
  username: string;
  identityFile?: string;
  notes?: string;
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function nextId(list: SshConnection[]): string {
  const nums = list.map(c => Number(c.id)).filter(n => !Number.isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return String(max + 1);
}

export function getSshConnections(): SshConnection[] {
  ensureDataDir();
  if (!fs.existsSync(SSH_FILE)) {
    atomicWriteJson(SSH_FILE, []);
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SSH_FILE, 'utf-8')) as SshConnection[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveSshConnections(list: SshConnection[]) {
  ensureDataDir();
  atomicWriteJson(SSH_FILE, list);
}

function normalizePort(value: unknown, fallback = 22): number {
  const n = Number(value);
  if (Number.isNaN(n) || n < 1 || n > 65535) return fallback;
  return Math.floor(n);
}

export function addSshConnection(data: SshConnectionInput): SshConnection {
  const name = data.name.trim();
  const host = data.host.trim();
  const username = data.username.trim();
  if (!name) throw new Error('Name is required');
  if (!host) throw new Error('Host is required');
  if (!username) throw new Error('Username is required');

  const list = getSshConnections();
  const today = new Date().toISOString().split('T')[0];
  const conn: SshConnection = {
    id: nextId(list),
    name,
    host,
    port: normalizePort(data.port, 22),
    username,
    identityFile: data.identityFile?.trim() || undefined,
    notes: data.notes?.trim() || undefined,
    createdAt: today,
    updatedAt: today,
  };
  list.push(conn);
  saveSshConnections(list);
  return conn;
}

export function updateSshConnection(
  id: string,
  data: Partial<SshConnectionInput>
): SshConnection | null {
  const list = getSshConnections();
  const index = list.findIndex(c => c.id === id);
  if (index === -1) return null;

  const current = list[index];
  const next: SshConnection = {
    ...current,
    name: data.name !== undefined ? data.name.trim() : current.name,
    host: data.host !== undefined ? data.host.trim() : current.host,
    username: data.username !== undefined ? data.username.trim() : current.username,
    port: data.port !== undefined ? normalizePort(data.port, current.port) : current.port,
    identityFile:
      data.identityFile !== undefined
        ? data.identityFile.trim() || undefined
        : current.identityFile,
    notes: data.notes !== undefined ? data.notes.trim() || undefined : current.notes,
    updatedAt: new Date().toISOString().split('T')[0],
  };
  if (!next.name || !next.host || !next.username) return null;

  list[index] = next;
  saveSshConnections(list);
  return next;
}

export function deleteSshConnection(id: string): boolean {
  const list = getSshConnections();
  const next = list.filter(c => c.id !== id);
  if (next.length === list.length) return false;
  saveSshConnections(next);
  return true;
}

export function getSshConnection(id: string): SshConnection | null {
  return getSshConnections().find(c => c.id === id) ?? null;
}

export function buildSshCommand(conn: SshConnection): string {
  const parts = ['ssh'];
  if (conn.port && conn.port !== 22) {
    parts.push('-p', String(conn.port));
  }
  if (conn.identityFile) {
    parts.push('-i', quotePath(conn.identityFile));
  }
  parts.push(`${conn.username}@${conn.host}`);
  return parts.join(' ');
}

export function buildSshConfigSnippet(conn: SshConnection): string {
  const hostAlias = conn.name.replace(/\s+/g, '-').toLowerCase() || 'pineflats-host';
  const lines = [
    `Host ${hostAlias}`,
    `  HostName ${conn.host}`,
    `  User ${conn.username}`,
    `  Port ${conn.port || 22}`,
  ];
  if (conn.identityFile) {
    lines.push(`  IdentityFile ${conn.identityFile}`);
  }
  return lines.join('\n');
}

function quotePath(p: string): string {
  if (/\s/.test(p)) return `"${p.replace(/"/g, '\\"')}"`;
  return p;
}

/** TCP reachability check (does not authenticate over SSH). */
export function testSshPort(
  host: string,
  port: number,
  timeoutMs = 4000
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const started = Date.now();
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: { ok: boolean; latencyMs?: number; error?: string }) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      finish({ ok: true, latencyMs: Date.now() - started });
    });
    socket.once('timeout', () => {
      finish({ ok: false, error: `Timed out after ${timeoutMs}ms` });
    });
    socket.once('error', (err: NodeJS.ErrnoException) => {
      finish({ ok: false, error: err.message || 'Connection failed' });
    });

    try {
      socket.connect(port, host);
    } catch (err) {
      finish({
        ok: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      });
    }
  });
}
