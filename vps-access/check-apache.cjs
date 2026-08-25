/**
 * Quick check: Apache vs nginx on the Pine Flats VPS.
 * Usage: npx electron check-apache.cjs
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const VPS_USER_DATA = path.join(process.env.APPDATA || '', 'pineflats-vps-access');
try {
  app.setName('pineflats-vps-access');
  app.setPath('userData', VPS_USER_DATA);
} catch {
  /* ignore */
}

const CONNECTIONS_FILE = path.join(VPS_USER_DATA, 'ssh-connections.json');

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

function sshConnect(conn, password) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const pass = password || '';
    client
      .on('ready', () => resolve(client))
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => pass));
      })
      .on('error', reject)
      .connect({
        host: conn.host,
        port: Number(conn.port) || 22,
        username: conn.username,
        password: pass || undefined,
        tryKeyboard: true,
        readyTimeout: 45000,
      });
  });
}

function execRemote(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
        .on('data', (d) => {
          stdout += d.toString();
        });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
      });
    });
  });
}

const REMOTE = `
set +e
echo "=== HOST ==="
hostname
date -u
echo ""
echo "=== PACKAGES ==="
dpkg -l 2>/dev/null | grep -iE 'apache2|httpd|nginx' || echo "(none matching)"
echo ""
echo "=== SERVICE STATUS ==="
echo -n "apache2 active: "; systemctl is-active apache2 2>/dev/null || echo n/a
echo -n "apache2 enabled: "; systemctl is-enabled apache2 2>/dev/null || echo n/a
echo -n "nginx active: "; systemctl is-active nginx 2>/dev/null || echo n/a
echo -n "nginx enabled: "; systemctl is-enabled nginx 2>/dev/null || echo n/a
echo ""
echo "=== BINARIES ==="
command -v apache2 || echo "apache2: not found"
command -v httpd || echo "httpd: not found"
command -v nginx || echo "nginx: not found"
nginx -v 2>&1
apache2 -v 2>&1
echo ""
echo "=== LISTEN 80/443 ==="
ss -lntp 2>/dev/null | grep -E ':80|:443' || netstat -lntp 2>/dev/null | grep -E ':80|:443' || echo "(no listeners found)"
echo "DONE"
`;

app.whenReady().then(async () => {
  let client;
  try {
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    if (!conn?.host) throw new Error('No saved VPS connection');
    const password = decryptPassword(conn.password);
    if (!password) throw new Error('Could not decrypt VPS password');

    console.log(`Connecting to ${conn.username}@${conn.host}…`);
    client = await sshConnect(conn, password);
    const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
    const result = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(result.stdout || '');
    if (result.stderr) console.error(result.stderr);
    client.end();
    app.exit(0);
  } catch (e) {
    console.error('CHECK FAILED:', e.message || e);
    app.exit(1);
  }
});
