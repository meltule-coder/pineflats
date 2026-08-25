const { app, BrowserWindow, ipcMain, shell, clipboard, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const DATA_FILE = () => path.join(app.getPath('userData'), 'ssh-connections.json');

function ensureDataFile() {
  const file = DATA_FILE();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf-8');
  return file;
}

function loadConnections() {
  try {
    const raw = JSON.parse(fs.readFileSync(ensureDataFile(), 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveConnections(list) {
  fs.writeFileSync(ensureDataFile(), JSON.stringify(list, null, 2), 'utf-8');
}

/** Encrypt password for disk (OS-backed when available). */
function encryptPassword(plain) {
  if (plain == null || plain === '') return undefined;
  const text = String(plain);
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        v: 1,
        encrypted: true,
        value: safeStorage.encryptString(text).toString('base64'),
      };
    }
  } catch {
    // fall through
  }
  return {
    v: 1,
    encrypted: false,
    value: Buffer.from(text, 'utf8').toString('base64'),
  };
}

function decryptPassword(stored) {
  if (!stored) return '';
  if (typeof stored === 'string') return stored;
  try {
    if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
    }
    if (stored.value) {
      return Buffer.from(stored.value, 'base64').toString('utf8');
    }
  } catch {
    return '';
  }
  return '';
}

function toPublicConnection(conn) {
  if (!conn) return null;
  const { password: _p, ...rest } = conn;
  return {
    ...rest,
    hasPassword: !!conn.password,
  };
}

function nextId(list) {
  const nums = list.map((c) => Number(c.id)).filter((n) => !Number.isNaN(n));
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

function normalizePort(value, fallback = 22) {
  const n = Number(value);
  if (Number.isNaN(n) || n < 1 || n > 65535) return fallback;
  return Math.floor(n);
}

function buildCommand(conn) {
  const parts = ['ssh'];
  if (conn.port && conn.port !== 22) parts.push('-p', String(conn.port));
  if (conn.identityFile) {
    const id = /\s/.test(conn.identityFile)
      ? `"${conn.identityFile.replace(/"/g, '\\"')}"`
      : conn.identityFile;
    parts.push('-i', id);
  }
  parts.push(`${conn.username}@${conn.host}`);
  return parts.join(' ');
}

function testPort(host, port, timeoutMs = 4000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, latencyMs: Date.now() - started }));
    socket.once('timeout', () => finish({ ok: false, error: `Timed out after ${timeoutMs}ms` }));
    socket.once('error', (err) => finish({ ok: false, error: err.message || 'Connection failed' }));
    try {
      socket.connect(port, host);
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' });
    }
  });
}

function openSshInTerminal(conn) {
  const cmd = buildCommand(conn);
  // Prefer Windows Terminal, then PowerShell, then cmd
  const trySpawn = (exe, args, opts = {}) => {
    try {
      spawn(exe, args, { detached: true, stdio: 'ignore', shell: false, ...opts }).unref();
      return true;
    } catch {
      return false;
    }
  };

  if (process.platform === 'win32') {
    // wt.exe "ssh user@host"
    if (trySpawn('wt.exe', ['new-tab', 'cmd', '/k', cmd])) return { ok: true, mode: 'windows-terminal' };
    if (trySpawn('powershell.exe', ['-NoExit', '-Command', cmd])) return { ok: true, mode: 'powershell' };
    if (trySpawn('cmd.exe', ['/k', cmd])) return { ok: true, mode: 'cmd' };
    return { ok: false, error: 'Could not open a terminal. Command was copied to clipboard instead.' };
  }

  if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${JSON.stringify(cmd)}`;
    if (trySpawn('osascript', ['-e', script])) return { ok: true, mode: 'terminal' };
    return { ok: false, error: 'Could not open Terminal.app' };
  }

  // Linux
  const terminals = [
    ['gnome-terminal', ['--', 'bash', '-lc', `${cmd}; exec bash`]],
    ['x-terminal-emulator', ['-e', `bash -lc '${cmd}; exec bash'`]],
    ['konsole', ['-e', 'bash', '-lc', `${cmd}; exec bash`]],
  ];
  for (const [exe, args] of terminals) {
    if (trySpawn(exe, args)) return { ok: true, mode: exe };
  }
  return { ok: false, error: 'Could not open a terminal' };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: 'Pine Flats VPS Access',
    backgroundColor: '#F7F3F0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    autoHideMenuBar: true,
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  ensureDataFile();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('ssh:list', () => loadConnections().map(toPublicConnection));

ipcMain.handle('ssh:get', (_e, id) => {
  const conn = loadConnections().find((c) => c.id === id);
  if (!conn) return { ok: false, error: 'Not found' };
  return {
    ok: true,
    connection: {
      ...toPublicConnection(conn),
      password: decryptPassword(conn.password),
    },
  };
});

ipcMain.handle('ssh:save', (_e, data) => {
  const list = loadConnections();
  const today = new Date().toISOString().split('T')[0];
  const name = String(data.name || '').trim();
  const host = String(data.host || '').trim();
  const username = String(data.username || '').trim();
  if (!name || !host || !username) {
    return { ok: false, error: 'Name, host, and username are required.' };
  }

  const passwordIn = data.password != null ? String(data.password) : '';
  const clearPassword = data.clearPassword === true;

  if (data.id) {
    const index = list.findIndex((c) => c.id === data.id);
    if (index === -1) return { ok: false, error: 'Connection not found' };
    const prev = list[index];
    let password = prev.password;
    if (clearPassword) {
      password = undefined;
    } else if (passwordIn !== '') {
      password = encryptPassword(passwordIn);
    }
    // empty passwordIn and not clear → keep existing
    list[index] = {
      ...prev,
      name,
      host,
      username,
      port: normalizePort(data.port, prev.port || 22),
      identityFile: String(data.identityFile || '').trim() || undefined,
      notes: String(data.notes || '').trim() || undefined,
      password,
      updatedAt: today,
    };
    saveConnections(list);
    return { ok: true, connection: toPublicConnection(list[index]) };
  }

  const conn = {
    id: nextId(list),
    name,
    host,
    username,
    port: normalizePort(data.port, 22),
    identityFile: String(data.identityFile || '').trim() || undefined,
    notes: String(data.notes || '').trim() || undefined,
    password: passwordIn ? encryptPassword(passwordIn) : undefined,
    createdAt: today,
    updatedAt: today,
  };
  list.push(conn);
  saveConnections(list);
  return { ok: true, connection: toPublicConnection(conn) };
});

ipcMain.handle('ssh:delete', (_e, id) => {
  const list = loadConnections();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return { ok: false, error: 'Not found' };
  saveConnections(next);
  return { ok: true };
});

ipcMain.handle('ssh:test', async (_e, id) => {
  const conn = loadConnections().find((c) => c.id === id);
  if (!conn) return { ok: false, error: 'Not found' };
  return testPort(conn.host, conn.port || 22);
});

ipcMain.handle('ssh:command', (_e, id) => {
  const conn = loadConnections().find((c) => c.id === id);
  if (!conn) return { ok: false, error: 'Not found' };
  return { ok: true, command: buildCommand(conn) };
});

ipcMain.handle('ssh:copy', (_e, text) => {
  clipboard.writeText(String(text || ''));
  return { ok: true };
});

ipcMain.handle('ssh:copy-password', (_e, id) => {
  const conn = loadConnections().find((c) => c.id === id);
  if (!conn) return { ok: false, error: 'Not found' };
  const password = decryptPassword(conn.password);
  if (!password) return { ok: false, error: 'No password saved for this connection' };
  clipboard.writeText(password);
  return { ok: true };
});

ipcMain.handle('ssh:connect', (_e, id) => {
  const conn = loadConnections().find((c) => c.id === id);
  if (!conn) return { ok: false, error: 'Not found' };
  const command = buildCommand(conn);
  const password = decryptPassword(conn.password);
  // Put password on clipboard so she can paste at the SSH password prompt
  if (password) {
    clipboard.writeText(password);
  }
  const opened = openSshInTerminal(conn);
  if (!opened.ok) {
    if (!password) clipboard.writeText(command);
    return {
      ok: false,
      error: opened.error,
      command,
      copied: true,
      passwordCopied: !!password,
    };
  }
  return {
    ok: true,
    command,
    mode: opened.mode,
    passwordCopied: !!password,
  };
});

ipcMain.handle('ssh:data-path', () => ensureDataFile());

ipcMain.handle('ssh:open-data-folder', () => {
  shell.showItemInFolder(ensureDataFile());
  return { ok: true };
});

ipcMain.handle('ssh:deploy', async (event, id) => {
  const conn = loadConnections().find((c) => c.id === id);
  if (!conn) return { ok: false, error: 'Connection not found' };
  const password = decryptPassword(conn.password);
  const { deployToVps } = require('./deploy.cjs');
  const sendLog = (text) => {
    try {
      event.sender.send('ssh:deploy-log', { id, text: String(text) });
    } catch {
      /* window closed */
    }
  };
  try {
    return await deployToVps({ conn, password, onLog: sendLog });
  } catch (e) {
    sendLog(`\nERROR: ${e.message || e}\n`);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('ssh:install-grok', async (event, id) => {
  const conn = loadConnections().find((c) => c.id === id);
  if (!conn) return { ok: false, error: 'Connection not found' };
  const password = decryptPassword(conn.password);
  const sendLog = (text) => {
    try {
      event.sender.send('ssh:deploy-log', { id, text: String(text) });
    } catch {
      /* window closed */
    }
  };
  if (!password && !(conn.identityFile && fs.existsSync(conn.identityFile))) {
    const msg =
      'No password saved for this connection.\n\n' +
      'Edit → enter the VPS root password → Save → Install Grok again.\n' +
      '(Passwords are stored only on this PC; reinstalling the app can clear them.)';
    sendLog(`\nERROR: ${msg}\n`);
    return { ok: false, error: msg };
  }
  const { installGrokOnVps } = require('./install-grok.cjs');
  try {
    sendLog(
      `SSH as ${conn.username}@${conn.host}:${conn.port || 22}` +
        (password ? ' (password)' : ' (key)') +
        '…\n'
    );
    return await installGrokOnVps({ conn, password, onLog: sendLog });
  } catch (e) {
    sendLog(`\nERROR: ${e.message || e}\n`);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
