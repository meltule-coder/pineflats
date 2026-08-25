/**
 * Broader search for Jake/Jacob DeOre / space 11 receipts.
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
cd /opt/pineflats
echo "=== data files ==="
ls -la data/ | head -40
echo ""
node <<'NODE'
const fs = require('fs');
function load(p, fb) {
  try {
    if (!fs.existsSync(p)) return { _missing: true };
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { _error: e.message };
  }
}

const re = /jacob|jake|deore|de ore/i;
function walk(obj, path, hits, depth=0) {
  if (depth > 8 || obj == null) return;
  if (typeof obj === 'string') {
    if (re.test(obj) || /space\\s*11|site\\s*11|"site"\\s*:\\s*"11"/i.test(obj)) {
      hits.push({ path, value: obj.slice(0, 120) });
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walk(v, path + '[' + i + ']', hits, depth + 1));
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      walk(v, path + '.' + k, hits, depth + 1);
    }
  }
}

const files = [
  'data/tenants.json',
  'data/payments.json',
  'data/previous-tenants.json',
  'data/email-log.json',
  'data/tax-ledger.json',
  'data/slots.json',
  'data/customers.json',
  'data/guest-receipts.json',
  'data/guest-receipts-hidden.json',
  'data/receipts.json',
];

for (const f of files) {
  const data = load(f);
  if (data._missing) {
    console.log(f, 'MISSING');
    continue;
  }
  if (data._error) {
    console.log(f, 'ERROR', data._error);
    continue;
  }
  const hits = [];
  // For payments, also dump tenant 15 fully
  if (f.includes('payments')) {
    const p15 = data['15'];
    console.log('\\n=== payments[15] full ===');
    console.log(JSON.stringify(p15, null, 2)?.slice(0, 3000));
  }
  if (f.includes('tenants') && !f.includes('previous')) {
    const t = (Array.isArray(data) ? data : []).filter(x =>
      /jake|jacob|deore/i.test(JSON.stringify(x)) || String(x.site) === '11'
    );
    console.log('\\n=== tenants name/site 11 ===');
    console.log(JSON.stringify(t, null, 2));
  }
  if (f.includes('slots')) {
    const slots = Array.isArray(data) ? data : (data.slots || []);
    const s11 = slots.filter(s => Number(s.number) === 11 || String(s.site) === '11');
    console.log('\\n=== slot 11 ===');
    console.log(JSON.stringify(s11, null, 2)?.slice(0, 2500));
  }
  if (f.includes('tax')) {
    const arr = Array.isArray(data) ? data : (data.entries || data.rows || []);
    const hitsTax = (Array.isArray(arr) ? arr : []).filter(x =>
      /jake|jacob|deore|\\b11\\b/i.test(JSON.stringify(x))
    );
    console.log('\\n=== tax ledger hits ===', hitsTax.length);
    console.log(JSON.stringify(hitsTax.slice(0, 20), null, 2)?.slice(0, 4000));
  }
  if (f.includes('email')) {
    const arr = Array.isArray(data) ? data : [];
    const hitsE = arr.filter(x => /jake|jacob|deore/i.test(JSON.stringify(x)));
    console.log('\\n=== email hits ===', hitsE.length);
    console.log(JSON.stringify(hitsE.slice(0, 10).map(e => ({
      at: e.at || e.createdAt, to: e.to, subject: e.subject, kind: e.kind
    })), null, 2));
  }
  if (f.includes('guest')) {
    console.log('\\n===', f, '===');
    console.log(JSON.stringify(data, null, 2)?.slice(0, 3000));
  }
  if (f.includes('customers')) {
    const arr = Array.isArray(data) ? data : [];
    const c = arr.filter(x => /jake|jacob|deore/i.test(JSON.stringify(x)));
    console.log('\\n=== customers ===');
    console.log(JSON.stringify(c, null, 2));
  }
  if (f.includes('receipts.json') && !f.includes('guest')) {
    console.log('\\n=== receipts.json ===');
    console.log(JSON.stringify(data, null, 2)?.slice(0, 2000));
  }
}

// Grep all data files for deore
const { execSync } = require('child_process');
try {
  console.log('\\n=== ripgrep deore/jake space 11 ===');
  console.log(execSync('grep -RIn -i "deore\\\\|jacob\\\\|jake de" data/ 2>/dev/null | head -50', { encoding: 'utf8' }));
} catch (e) {
  console.log(e.stdout || e.message);
}
console.log('DONE');
NODE
`;

app.whenReady().then(async () => {
  try {
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list)[0] ? list[0] : (Array.isArray(list) ? list[0] : null);
    const c = Array.isArray(list) ? list[0] : null;
    const password = decryptPassword(c.password);
    const client = await sshConnect(c, password);
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
