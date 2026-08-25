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
node <<'NODE'
const fs = require('fs');
const email = JSON.parse(fs.readFileSync('data/email-log.json','utf8'));
const prev = JSON.parse(fs.readFileSync('data/previous-tenants.json','utf8'));
const tax = JSON.parse(fs.readFileSync('data/tax-ledger.json','utf8'));
const pays = JSON.parse(fs.readFileSync('data/payments.json','utf8'));
const tenants = JSON.parse(fs.readFileSync('data/tenants.json','utf8'));
const hidden = JSON.parse(fs.readFileSync('data/guest-receipts-hidden.json','utf8'));

const hits = email.filter(e => {
  const s = JSON.stringify(e).toLowerCase();
  return s.includes('webopj') || s.includes('337-1860') || s.includes('3371860') ||
    s.includes('jake') || s.includes('deore') || s.includes('de ore');
});
console.log('email name/phone hits', hits.length);
console.log(JSON.stringify(hits.map(e => ({
  at: e.at || e.createdAt || e.timestamp,
  to: e.to,
  subject: e.subject,
  kind: e.kind || e.type,
})), null, 2));

const s11 = email.filter(e => /space\\s*11|site\\s*11|\\b11\\b/i.test(String(e.subject||'')) ||
  /space\\s*11|site\\s*11/i.test(JSON.stringify(e)));
console.log('\\nspace/site 11 related emails', s11.length);
console.log(JSON.stringify(s11.slice(-20).map(e => ({
  at: e.at || e.createdAt, to: e.to, subject: e.subject, kind: e.kind
})), null, 2));

console.log('\\nprevious tenants');
console.log((prev||[]).map(r => ({
  name: r.tenant?.name, site: r.tenant?.site,
  pays: r.payment?.records?.length||0,
  total: r.payment?.totalPaid
})));

console.log('\\ntax ledger full');
console.log(JSON.stringify(tax, null, 2));

console.log('\\nhidden guest receipts');
console.log(JSON.stringify(hidden, null, 2));

console.log('\\nall tenants with payment record counts');
for (const t of tenants) {
  const p = pays[t.id];
  const n = p?.records?.length || 0;
  console.log(t.id, t.name, 'site', t.site, 'records', n, n ? p.records.map(r=>r.amount+ ' '+r.method).join('; ') : '');
}

// Any payment record note containing 11 or jake
console.log('\\npayment records any tenant mentioning jake/deore/site 11');
for (const [id, p] of Object.entries(pays)) {
  for (const r of (p.records||[])) {
    const s = JSON.stringify(r).toLowerCase();
    if (s.includes('jake') || s.includes('deore') || s.includes('space 11')) {
      console.log(id, r);
    }
  }
}
console.log('DONE');
NODE
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
