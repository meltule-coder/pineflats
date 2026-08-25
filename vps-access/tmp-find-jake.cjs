const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const VPS_USER_DATA = path.join(process.env.APPDATA || '', 'pineflats-vps-access');
try { app.setName('pineflats-vps-access'); app.setPath('userData', VPS_USER_DATA); } catch {}
const CONNECTIONS_FILE = path.join(VPS_USER_DATA, 'ssh-connections.json');
function decryptPassword(stored) {
  if (!stored) return '';
  if (typeof stored === 'string') return stored;
  try {
    if (stored.encrypted && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
    if (stored.value) return Buffer.from(stored.value, 'base64').toString('utf8');
  } catch { return ''; }
  return '';
}
function sshConnect(conn, password) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => resolve(client))
      .on('keyboard-interactive', (_n,_i,_l,prompts,finish) => finish(prompts.map(() => password)))
      .on('error', reject)
      .connect({ host: conn.host, port: Number(conn.port)||22, username: conn.username, password: password||undefined, tryKeyboard: true, readyTimeout: 45000 });
  });
}
function execRemote(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout='', stderr='';
      stream.on('close', (code) => resolve({ code: code??0, stdout, stderr }))
        .on('data', d => { stdout += d.toString(); });
      stream.stderr.on('data', d => { stderr += d.toString(); });
    });
  });
}
const REMOTE = ` + String.raw
set +e
cd /opt/pineflats
node <<'NODE'
const fs = require('fs');
const email = JSON.parse(fs.readFileSync('data/email-log.json','utf8'));
const prev = JSON.parse(fs.readFileSync('data/previous-tenants.json','utf8'));
const tax = JSON.parse(fs.readFileSync('data/tax-ledger.json','utf8'));
const hits = email.filter(e => {
  const s = JSON.stringify(e).toLowerCase();
  return s.includes('webopj') || s.includes('337-1860') || s.includes('3371860') ||
    s.includes('jake') || s.includes('deore') || s.includes('de ore') ||
    (s.includes('space 11') && (s.includes('receipt') || s.includes('payment') || s.includes('booking')));
});
console.log('email hits', hits.length);
console.log(JSON.stringify(hits.map(e => ({
  at: e.at || e.createdAt || e.timestamp,
  to: e.to,
  subject: e.subject,
  kind: e.kind || e.type,
  mode: e.mode,
})), null, 2));

// space 11 in any email
const s11 = email.filter(e => /space\s*11|site\s*11/i.test(JSON.stringify(e)));
console.log('\\nspace 11 emails', s11.length);
console.log(JSON.stringify(s11.slice(-15).map(e => ({
  at: e.at || e.createdAt, to: e.to, subject: e.subject, kind: e.kind
})), null, 2));

console.log('\\nprevious tenants all names');
console.log((prev||[]).map(r => r.tenant?.name + ' site ' + r.tenant?.site + ' pays ' + (r.payment?.records?.length||0)));

console.log('\\ntax ledger');
console.log(JSON.stringify(tax, null, 2).slice(0, 3000));

// payments keys and any non-empty records mentioning 11
const pays = JSON.parse(fs.readFileSync('data/payments.json','utf8'));
for (const [id, p] of Object.entries(pays)) {
  const recs = p.records || [];
  if (recs.length) {
    // skip unless interesting
  }
}
console.log('\\npayments with records count by tenant');
const tenants = JSON.parse(fs.readFileSync('data/tenants.json','utf8'));
for (const [id, p] of Object.entries(pays)) {
  const n = (p.records||[]).length;
  if (n > 0) {
    const t = tenants.find(x => String(x.id)===String(id));
    console.log(id, t?.name, 'site', t?.site, 'records', n, 'amounts', (p.records||[]).map(r=>r.amount).join(','));
  }
}
console.log('DONE');
NODE
 + `;
app.whenReady().then(async () => {
  const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
  const conn = Array.isArray(list) ? list[0] : null;
  const password = decryptPassword(conn.password);
  const client = await sshConnect(conn, password);
  const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
  const r = await execRemote(client, cho '' | base64 -d | bash);
  console.log(r.stdout || '');
  if (r.stderr) console.error(r.stderr);
  client.end();
  app.exit(0);
});
