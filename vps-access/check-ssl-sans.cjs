/**
 * Check LE cert SANs and nginx SSL hosts on VPS.
 * Usage: npx electron check-ssl-sans.cjs
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
echo "=== CERTBOT CERTS ==="
certbot certificates 2>&1
echo ""
echo "=== openssl live cert SANs ==="
for d in /etc/letsencrypt/live/*/fullchain.pem; do
  [ -f "$d" ] || continue
  echo "--- $d ---"
  openssl x509 -in "$d" -noout -subject -issuer -dates -ext subjectAltName 2>&1
done
echo ""
echo "=== CF origin cert if any ==="
if [ -f /etc/ssl/cloudflare/origin.pem ]; then
  openssl x509 -in /etc/ssl/cloudflare/origin.pem -noout -subject -issuer -dates -ext subjectAltName 2>&1
else
  echo "no cloudflare origin.pem"
fi
echo ""
echo "=== nginx server_name / ssl lines ==="
grep -nE 'server_name|ssl_certificate|listen' /etc/nginx/sites-available/pineflats 2>/dev/null
echo ""
echo "=== default_server on 443 ==="
grep -n 'default_server' /etc/nginx/sites-available/pineflats /etc/nginx/sites-enabled/* 2>/dev/null
echo "DONE"
`;

app.whenReady().then(async () => {
  try {
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    if (!conn?.host) throw new Error('No saved VPS connection');
    const password = decryptPassword(conn.password);
    if (!password) throw new Error('Could not decrypt VPS password');
    const client = await sshConnect(conn, password);
    const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
    const result = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(result.stdout || '');
    if (result.stderr) console.error(result.stderr);
    client.end();
    app.exit(0);
  } catch (e) {
    console.error('FAIL', e.message || e);
    app.exit(1);
  }
});
