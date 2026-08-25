/**
 * Look up Dawn Beinke payment(s) and Clover processor refs.
 * Usage: npx electron check-dawn-payment.cjs
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
node <<'NODE'
const fs = require('fs');
const path = require('path');

function loadJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

const tenants = loadJson('data/tenants.json', []);
const payments = loadJson('data/payments.json', {});
const previous = loadJson('data/previous-tenants.json', []);
const emailLog = loadJson('data/email-log.json', []);

const nameRe = /dawn\\s*beinke/i;
const amountTarget = 807.6;

const matchTenants = (Array.isArray(tenants) ? tenants : []).filter(t =>
  nameRe.test(String(t.name || ''))
);

console.log('=== TENANTS matching Dawn Beinke ===');
console.log(JSON.stringify(matchTenants.map(t => ({
  id: t.id, name: t.name, site: t.site, status: t.status, email: t.email, phone: t.phone
})), null, 2));

console.log('\\n=== PAYMENTS for those tenants ===');
for (const t of matchTenants) {
  const p = payments[t.id];
  if (!p) {
    console.log(t.id, 'no payment file entry');
    continue;
  }
  const records = Array.isArray(p.records) ? p.records : [];
  console.log(JSON.stringify({
    tenantId: t.id,
    name: t.name,
    site: t.site,
    rentAmount: p.rentAmount,
    balanceDue: p.balanceDue,
    billingPeriod: p.billingPeriod,
    records: records.map(r => ({
      id: r.id,
      date: r.date,
      amount: r.amount,
      method: r.method,
      note: r.note,
    })),
    match807: records.filter(r => Math.abs(Number(r.amount) - amountTarget) < 0.02),
  }, null, 2));
}

// Search all payments for 807.60
console.log('\\n=== ALL payments near 807.60 ===');
const hits = [];
for (const [tid, p] of Object.entries(payments || {})) {
  const records = Array.isArray(p.records) ? p.records : [];
  for (const r of records) {
    if (Math.abs(Number(r.amount) - amountTarget) < 0.02) {
      const t = (Array.isArray(tenants) ? tenants : []).find(x => String(x.id) === String(tid));
      hits.push({
        tenantId: tid,
        tenantName: t?.name || p.name || '?',
        site: t?.site,
        ...r,
      });
    }
  }
}
console.log(JSON.stringify(hits, null, 2));

// Previous tenants
console.log('\\n=== PREVIOUS tenants Dawn ===');
const prevHits = (Array.isArray(previous) ? previous : []).filter(r =>
  nameRe.test(String(r.tenant?.name || ''))
);
for (const r of prevHits) {
  const pay = r.payment;
  console.log(JSON.stringify({
    archiveId: r.id,
    archivedAt: r.archivedAt,
    name: r.tenant?.name,
    site: r.tenant?.site,
    payment: pay ? {
      totalPaid: pay.totalPaid,
      records: (pay.records || []).map(x => ({
        date: x.date, amount: x.amount, method: x.method, note: x.note
      })),
    } : null,
  }, null, 2));
}

// Email log for 807 / Dawn / Clover
console.log('\\n=== EMAIL LOG matches ===');
const logs = Array.isArray(emailLog) ? emailLog : [];
const emailHits = logs.filter(e => {
  const s = JSON.stringify(e).toLowerCase();
  return s.includes('dawn') || s.includes('807.6') || s.includes('807.60') || s.includes('beinke');
}).slice(-20);
console.log(JSON.stringify(emailHits.map(e => ({
  at: e.at || e.date || e.createdAt,
  to: e.to,
  subject: e.subject,
  kind: e.kind,
  preview: String(e.text || e.body || '').slice(0, 200),
})), null, 2));

// Heuristic: note fields with Processor ref / Clover
console.log('\\n=== Records with Clover/processor note for Dawn or 807.60 ===');
const cloverish = [];
for (const [tid, p] of Object.entries(payments || {})) {
  const t = (Array.isArray(tenants) ? tenants : []).find(x => String(x.id) === String(tid));
  const name = t?.name || '';
  for (const r of (p.records || [])) {
    const note = String(r.note || '');
    const amt = Number(r.amount);
    if (
      (nameRe.test(name) || Math.abs(amt - amountTarget) < 0.02) &&
      (/clover|processor ref|clv_|via processor/i.test(note) || Math.abs(amt - amountTarget) < 0.02)
    ) {
      cloverish.push({
        tenantId: tid,
        name,
        site: t?.site,
        date: r.date,
        amount: r.amount,
        method: r.method,
        note: r.note,
        likelyCloverCharge: /processor ref|via processor|clover/i.test(note),
      });
    }
  }
}
console.log(JSON.stringify(cloverish, null, 2));
console.log('DONE');
NODE
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
