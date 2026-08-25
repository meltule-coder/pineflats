/**
 * Clear all payment receipts for Jacob Deore, space 11.
 * Dry-run by default. Apply with: npx electron clear-jacob-receipts.cjs --apply
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
const APPLY = process.argv.includes('--apply');

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
export APPLY=${APPLY ? '1' : '0'}
node <<'NODE'
const fs = require('fs');
const path = require('path');
const APPLY = process.env.APPLY === '1';

function load(p, fb) {
  try {
    if (!fs.existsSync(p)) return fb;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fb;
  }
}
function save(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\\n', 'utf8');
}

const tenantsPath = 'data/tenants.json';
const paymentsPath = 'data/payments.json';
const previousPath = 'data/previous-tenants.json';
const emailPath = 'data/email-log.json';

const tenants = load(tenantsPath, []);
const payments = load(paymentsPath, {});
const previous = load(previousPath, []);
const emailLog = load(emailPath, []);

const nameRe = /jacob\\s*deore/i;
const site = '11';

const matches = (Array.isArray(tenants) ? tenants : []).filter(t => {
  const siteMatch = String(t.site || '') === site || String(t.site || '') === 'Space 11';
  return nameRe.test(String(t.name || '')) && siteMatch;
});

// Also match by site alone if name is close
const bySite = (Array.isArray(tenants) ? tenants : []).filter(t =>
  String(t.site || '') === site && /jacob|deore/i.test(String(t.name || ''))
);

const targets = matches.length ? matches : bySite;
console.log('=== MATCHING TENANTS ===');
console.log(JSON.stringify(targets.map(t => ({ id: t.id, name: t.name, site: t.site, status: t.status })), null, 2));

if (!targets.length) {
  console.log('No current tenant match. Checking previous-tenants...');
}

const prevMatches = (Array.isArray(previous) ? previous : []).filter(r => {
  const t = r.tenant || {};
  return nameRe.test(String(t.name || '')) && String(t.site || '') === site;
});
console.log('=== PREVIOUS TENANTS ===');
console.log(JSON.stringify(prevMatches.map(r => ({
  id: r.id, name: r.tenant?.name, site: r.tenant?.site, archivedAt: r.archivedAt,
  paymentCount: r.payment?.records?.length, totalPaid: r.payment?.totalPaid
})), null, 2));

const tenantIds = targets.map(t => String(t.id));
// also original tenant ids from previous
for (const r of prevMatches) {
  if (r.tenant?.id) tenantIds.push(String(r.tenant.id));
}

console.log('\\n=== PAYMENT RECORDS BEFORE ===');
for (const id of [...new Set(tenantIds)]) {
  const p = payments[id];
  if (!p) {
    console.log(id, 'no payments entry');
    continue;
  }
  console.log(JSON.stringify({
    tenantId: id,
    records: (p.records || []).map(r => ({ id: r.id, date: r.date, amount: r.amount, method: r.method, note: r.note })),
    extraCharges: (p.extraCharges || []).length,
    credits: (p.credits || []).length,
  }, null, 2));
}

// Email receipts mentioning Jacob / space 11
const emailHits = (Array.isArray(emailLog) ? emailLog : []).filter(e => {
  const s = JSON.stringify(e).toLowerCase();
  return (s.includes('jacob') && s.includes('deore')) ||
    (s.includes('jacob') && (s.includes('space 11') || s.includes('site 11') || s.includes('"11"')));
});
console.log('\\n=== EMAIL LOG RECEIPTS (count) ===', emailHits.length);
console.log(JSON.stringify(emailHits.slice(0, 15).map(e => ({
  at: e.at || e.date || e.createdAt,
  to: e.to,
  subject: e.subject,
  kind: e.kind,
})), null, 2));

if (!APPLY) {
  console.log('\\nDRY_RUN — re-run with --apply to clear payment records + previous payment snapshot + matching email receipts');
  console.log('DRY_RUN_OK');
  process.exit(0);
}

// Backup
const bakDir = 'data/backups';
if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(paymentsPath, path.join(bakDir, 'payments-before-jacob-clear-' + stamp + '.json'));
if (fs.existsSync(previousPath)) {
  fs.copyFileSync(previousPath, path.join(bakDir, 'previous-tenants-before-jacob-clear-' + stamp + '.json'));
}
if (fs.existsSync(emailPath)) {
  fs.copyFileSync(emailPath, path.join(bakDir, 'email-log-before-jacob-clear-' + stamp + '.json'));
}

// Clear payment records for matching current tenants
for (const t of targets) {
  const id = String(t.id);
  if (!payments[id]) {
    payments[id] = {
      tenantId: id,
      rentalType: t.rentalType || 'monthly',
      rentAmount: 0,
      balanceDue: 0,
      records: [],
    };
  }
  const p = payments[id];
  p.records = [];
  p.extraCharges = [];
  p.credits = [];
  // Reset totals that depend on payments
  if (typeof p.totalPaid === 'number') p.totalPaid = 0;
  // Recalculate balance as rent + extras - credits - paid (simple)
  const rent = Number(p.rentAmount) || 0;
  p.balanceDue = rent;
  p.updatedAt = new Date().toISOString();
  console.log('Cleared payments for tenant', id, t.name);
}

// Clear payment snapshot on previous-tenant archives
for (const r of previous) {
  if (!prevMatches.find(m => m.id === r.id)) continue;
  if (r.payment) {
    r.payment = {
      ...r.payment,
      totalPaid: 0,
      paymentCount: 0,
      records: [],
      extraCharges: [],
      credits: [],
    };
    console.log('Cleared payment snapshot on previous archive', r.id);
  }
}

// Remove matching receipt emails from log
const keepEmail = (Array.isArray(emailLog) ? emailLog : []).filter(e => {
  const s = JSON.stringify(e).toLowerCase();
  const isJacob = s.includes('jacob') && s.includes('deore');
  const isSpace11 = s.includes('space 11') || s.includes('site 11');
  if (isJacob) return false;
  if (isJacob || (s.includes('jacob deore'))) return false;
  return true;
});
// more precise: drop if subject/body has jacob deore
const filteredEmail = (Array.isArray(emailLog) ? emailLog : []).filter(e => {
  const s = JSON.stringify(e).toLowerCase();
  return !(s.includes('jacob') && s.includes('deore'));
});
const removedEmail = (Array.isArray(emailLog) ? emailLog : []).length - filteredEmail.length;

save(paymentsPath, payments);
if (fs.existsSync(previousPath)) save(previousPath, previous);
if (fs.existsSync(emailPath)) save(emailPath, filteredEmail);

console.log('\\nAPPLY_OK cleared payment records for', targets.length, 'tenant(s); email receipts removed:', removedEmail);
console.log('Backup under data/backups/*jacob-clear*');
NODE
`;

app.whenReady().then(async () => {
  let client;
  try {
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    if (!conn?.host) throw new Error('No connection');
    const password = decryptPassword(conn.password);
    if (!password) throw new Error('No password');
    console.log(APPLY ? 'APPLY mode' : 'DRY RUN (pass --apply to clear)');
    client = await sshConnect(conn, password);
    const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
    const r = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(r.stdout || '');
    if (r.stderr) console.error(r.stderr);
    client.end();
    const ok = (r.stdout || '').includes('DRY_RUN_OK') || (r.stdout || '').includes('APPLY_OK');
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.error(e.message || e);
    app.exit(1);
  }
});
