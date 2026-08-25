/**
 * Zero balance due for Jake DeOre, space 11 (tenant id 15).
 * Usage: npx electron zero-jake-balance.cjs
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
set -e
cd /opt/pineflats
node <<'NODE'
const fs = require('fs');
const path = require('path');
const KWH_RATE = 0.24;

const paymentsPath = 'data/payments.json';
const slotsPath = 'data/slots.json';
const tenantsPath = 'data/tenants.json';

const payments = JSON.parse(fs.readFileSync(paymentsPath, 'utf8'));
const tenants = JSON.parse(fs.readFileSync(tenantsPath, 'utf8'));
const slots = JSON.parse(fs.readFileSync(slotsPath, 'utf8'));

// Prefer known id 15 (Jake DeOre · Space 11), then name/site match
let tenant = tenants.find(t => String(t.id) === '15');
if (!tenant) {
  tenant = tenants.find(t => String(t.site) === '11');
}
if (!tenant) {
  console.error('Tenant not found. Tenants:', tenants.map(t => t.id + ' ' + t.name + ' ' + t.site).join(' | '));
  process.exit(1);
}
console.log('Using tenant', tenant.id, tenant.name, 'site', tenant.site);

const id = String(tenant.id);
const p = payments[id];
if (!p) {
  console.error('No payment record for', id);
  process.exit(1);
}

const bakDir = 'data/backups';
if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(paymentsPath, path.join(bakDir, 'payments-before-zero-jake-' + stamp + '.json'));

const rent = Number(p.rentAmount) || 0;
const usage = Number(p.currentReadingTotal) || 0;
const baseline = Number(p.baselineCredit) || 0;
const util = Math.max(0, usage - baseline) * KWH_RATE;
const extras = (p.extraCharges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
const credits = (p.credits || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
const carried = Number(p.carriedBalance) || 0;
const period = p.billingPeriod || new Date().toISOString().slice(0, 7);
const paidPeriod = (p.records || [])
  .filter(r => (r.date || '').startsWith(period))
  .reduce((s, r) => s + (Number(r.amount) || 0), 0);

const before = Math.max(0, Math.round((carried + rent + util + extras - credits - paidPeriod) * 100) / 100);

console.log(JSON.stringify({
  tenant: { id, name: tenant.name, site: tenant.site },
  before: {
    balanceDue: p.balanceDue,
    computed: before,
    carriedBalance: carried,
    rent,
    util: Math.round(util * 100) / 100,
    extras,
    credits,
    paidPeriod,
  },
}, null, 2));

// Zero debt sustainably: clear carried, write off period charges with admin adjustment payment
const writeOff = Math.max(0, Math.round((rent + util + extras - credits - paidPeriod) * 100) / 100);
const today = new Date().toISOString().slice(0, 10);

p.carriedBalance = 0;
// Ensure billing period is set so payment counts in current period
if (!p.billingPeriod) p.billingPeriod = period;

if (writeOff > 0.009) {
  p.records = Array.isArray(p.records) ? p.records : [];
  p.records.unshift({
    id: 'pay-admin-zero-' + Date.now(),
    date: today,
    amount: writeOff,
    method: 'Adjustment',
    note: 'Balance zeroed by admin (Jake DeOre · Space 11)',
  });
}

// Final balance
const paidAfter = (p.records || [])
  .filter(r => (r.date || '').startsWith(p.billingPeriod || period))
  .reduce((s, r) => s + (Number(r.amount) || 0), 0);
const after = Math.max(0, Math.round((0 + rent + util + extras - credits - paidAfter) * 100) / 100);
p.balanceDue = after;
p.updatedAt = new Date().toISOString();

// Slot field if present
const slot = slots.find(s => Number(s.number) === 11 || String(s.tenantId) === id);
if (slot) {
  slot.balanceDue = 0;
  fs.writeFileSync(slotsPath, JSON.stringify(slots, null, 2) + '\\n');
}

fs.writeFileSync(paymentsPath, JSON.stringify(payments, null, 2) + '\\n');

console.log(JSON.stringify({
  after: {
    balanceDue: p.balanceDue,
    carriedBalance: p.carriedBalance,
    writeOffPayment: writeOff,
    records: (p.records || []).map(r => ({ date: r.date, amount: r.amount, method: r.method, note: r.note })),
  },
  backup: 'data/backups/payments-before-zero-jake-' + stamp + '.json',
}, null, 2));
console.log('ZERO_OK');
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
    app.exit((r.stdout || '').includes('ZERO_OK') ? 0 : 1);
  } catch (e) {
    console.error(e.message || e);
    app.exit(1);
  }
});
