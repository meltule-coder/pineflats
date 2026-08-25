/**
 * ASV findings: directory browsing + remote access software inventory.
 * Usage: npx electron check-asv-remote.cjs
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
echo "=== LISTENERS (remote-access related) ==="
ss -lntp 2>/dev/null | grep -E ':(22|23|3389|5900|5901|5800|4899|5938|7070|8000|8080|8443|10000|20000|3000|4172|6129) ' || true
echo ""
echo "=== PACKAGES that look like remote access ==="
dpkg -l 2>/dev/null | grep -iE 'teamviewer|anydesk|vnc|xrdp|tightvnc|realvnc|nomachine|chrome-remote|webmin|cockpit|phpmyadmin|ajenti|remotely|rustdesk|splashtop' || echo "(none matching)"
echo ""
echo "=== SERVICES ==="
systemctl list-units --type=service --state=running 2>/dev/null | grep -iE 'ssh|vnc|xrdp|team|anydesk|webmin|cockpit|nginx|pm2' || true
echo ""
echo "=== nginx autoindex / directory settings ==="
grep -RIn --include='*.conf' -E 'autoindex|fancyindex|directory' /etc/nginx 2>/dev/null | head -40
echo ""
echo "=== nginx site conf (snippet) ==="
grep -n 'location\\|autoindex\\|server_name\\|root ' /etc/nginx/sites-available/pineflats 2>/dev/null | head -60
echo ""
echo "=== APP: uploads listing test via curl localhost ==="
curl -sI http://127.0.0.1:3000/uploads/ | head -15
curl -s http://127.0.0.1:3000/uploads/ | head -c 400; echo
echo ""
echo "=== /ssh /vps routes ==="
curl -sI http://127.0.0.1:3000/ssh | head -12
curl -sI http://127.0.0.1:3000/vps | head -12
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
