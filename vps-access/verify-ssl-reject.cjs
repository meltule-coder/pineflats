/**
 * Verify ssl_reject_handshake and named-host cert.
 * Usage: npx electron verify-ssl-reject.cjs
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
echo "=== CONFIG ==="
grep -nE 'listen|server_name|ssl_reject|ssl_certificate' /etc/nginx/sites-available/pineflats
echo ""
echo "=== NO SNI (expect handshake failure) ==="
timeout 5 openssl s_client -connect 127.0.0.1:443 -noservername </dev/null 2>&1 | head -25
echo "exit=$?"
echo ""
echo "=== SNI=IP (expect fail) ==="
timeout 5 openssl s_client -connect 127.0.0.1:443 -servername 74.208.115.104 </dev/null 2>&1 | head -25
echo ""
echo "=== SNI=pineflatsrvpark.com (expect CN match) ==="
timeout 5 openssl s_client -connect 127.0.0.1:443 -servername pineflatsrvpark.com </dev/null 2>&1 | openssl x509 -noout -subject -ext subjectAltName 2>&1
echo ""
echo "=== External-style: connect public IP no SNI ==="
timeout 5 openssl s_client -connect 74.208.115.104:443 -noservername </dev/null 2>&1 | head -20
echo "DONE"
`;

app.whenReady().then(async () => {
  try {
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    const password = decryptPassword(conn.password);
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
