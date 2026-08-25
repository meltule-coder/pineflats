/**
 * Tail PM2 logs for card/Clover 400 errors.
 * Usage: npx electron check-card-charge-logs.cjs
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const VPS_USER_DATA = path.join(process.env.APPDATA || '', 'pineflats-vps-access');
try {
  app.setName('pineflats-vps-access');
  app.setPath('userData', VPS_USER_DATA);
} catch {}

const CONNECTIONS_FILE = path.join(VPS_USER_DATA, 'ssh-connections.json');

function decryptPassword(stored) {
  if (!stored) return '';
  if (typeof stored === 'string') return stored;
  try {
    if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
    }
    if (stored.value) return Buffer.from(stored.value, 'base64').toString('utf8');
  } catch {
    return '';
  }
  return '';
}

function sshConnect(conn, password) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on('ready', () => resolve(client))
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => password)))
      .on('error', reject)
      .connect({
        host: conn.host,
        port: Number(conn.port) || 22,
        username: conn.username,
        password: password || undefined,
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
        .on('data', (d) => { stdout += d.toString(); });
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
    });
  });
}

const REMOTE = `
set +e
echo "=== PUBLIC PROCESSOR ==="
curl -sS http://127.0.0.1:3000/api/public/payment-processor | head -c 800; echo
echo ""
echo "=== PROCESSOR STATUS (may need cookie; local) ==="
# try without auth - may 401
curl -sS -o /tmp/ps.json -w "HTTP %{http_code}\\n" http://127.0.0.1:3000/api/payment-processor/status
head -c 400 /tmp/ps.json; echo
echo ""
echo "=== PM2 LOGS (last 80 lines, clover/card/400) ==="
pm2 logs pineflats --lines 120 --nostream 2>&1 | tail -n 120
echo ""
echo "=== payment-processor config (redacted) ==="
node -e "
const fs=require('fs');
const p='/opt/pineflats/data/payment-processor.json';
if(!fs.existsSync(p)){console.log('no config');process.exit(0)}
const c=JSON.parse(fs.readFileSync(p,'utf8'));
console.log(JSON.stringify({
  provider:c.provider, enabled:c.enabled, testMode:c.testMode,
  merchantId: c.merchantId? String(c.merchantId).slice(0,8)+'…': '',
  publicKeySet: !!(c.publicKey&&c.publicKey.length),
  publicKeyLen: (c.publicKey||'').length,
  displayName:c.displayName
},null,2));
"
echo "DONE"
`;

app.whenReady().then(async () => {
  try {
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    if (!conn?.host) throw new Error('No connection');
    const password = decryptPassword(conn.password);
    if (!password) throw new Error('No password');
    const client = await sshConnect(conn, password);
    const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
    const r = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(r.stdout || '');
    if (r.stderr) console.error(r.stderr);
    client.end();
    app.exit(0);
  } catch (e) {
    console.error(e.message || e);
    app.exit(1);
  }
});
