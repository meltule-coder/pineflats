/**
 * Remove specific booking receipts and related tax/revenue records from VPS data.
 * Usage: VPS_PW=... node remove-receipts.cjs
 */
const { Client } = require('ssh2');

const TARGETS = ['PF-BK-14-82423936', 'PF-BK-13-01243452'];
const password = process.env.VPS_PW;
if (!password) {
  console.error('Set VPS_PW');
  process.exit(1);
}

const remoteScript = `
const fs = require('fs');
const path = require('path');
const DATA = '/opt/pineflats/data';
const TARGETS = ${JSON.stringify(TARGETS)};

function money(n) { return Math.round(n * 100) / 100; }

function loadJson(file, fallback) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function saveJson(file, data) {
  const p = path.join(DATA, file);
  const tmp = p + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

const report = { emailRemoved: 0, taxRemoved: 0, taxBefore: 0, taxAfter: 0, emailBefore: 0, emailAfter: 0, matched: [] };

// --- email-log.json ---
let emails = loadJson('email-log.json', []);
report.emailBefore = emails.length;
const emailKeep = [];
for (const e of emails) {
  const blob = JSON.stringify(e);
  const hit = TARGETS.some(t => blob.includes(t));
  if (hit) {
    report.emailRemoved++;
    report.matched.push({ type: 'email', id: e.id, receiptId: e.receiptId, kind: e.kind, subject: e.subject });
  } else {
    emailKeep.push(e);
  }
}
emails = emailKeep;
report.emailAfter = emails.length;
saveJson('email-log.json', emails);

// --- tax-ledger.json ---
let tax = loadJson('tax-ledger.json', []);
if (!Array.isArray(tax)) tax = [];
report.taxBefore = tax.length;

// Also match by guest/site if we can extract from removed email subjects
// Parse guests from matched email subjects for broader cleanup
const guestHints = [];
for (const m of report.matched) {
  if (m.subject) {
    // "New booking receipt — Name · Site X"
    const mm = String(m.subject).match(/—\\s*(.+?)\\s*·/);
    if (mm) guestHints.push(mm[1].trim().toLowerCase());
  }
}

const taxKeep = [];
for (const e of tax) {
  const blob = JSON.stringify(e);
  let hit = TARGETS.some(t => blob.includes(t));
  // If receipt id embedded in id field
  if (!hit && e.id && TARGETS.some(t => String(e.id).includes(t.replace(/PF-BK-/, '').replace(/-/g, '')))) {
    // weak match skip
  }
  if (hit) {
    report.taxRemoved++;
    report.matched.push({ type: 'tax', id: e.id, guest: e.guestName, site: e.siteLabel, total: e.grandTotal });
  } else {
    taxKeep.push(e);
  }
}
tax = taxKeep;
report.taxAfter = tax.length;
saveJson('tax-ledger.json', tax);

// Extract more context from remaining email? already removed.
// Search slots for notes containing receipt ids
let slots = loadJson('slots.json', []);
let slotsChanged = false;
if (Array.isArray(slots)) {
  for (const s of slots) {
    const blob = JSON.stringify(s);
    if (TARGETS.some(t => blob.includes(t))) {
      report.matched.push({ type: 'slot_note', id: s.id, label: s.label, before: { notes: s.notes, rentAmount: s.rentAmount } });
      // Clear booking residue if notes/payment mention these receipts
      if (s.notes && TARGETS.some(t => s.notes.includes(t))) {
        s.notes = undefined;
        slotsChanged = true;
      }
    }
  }
  if (slotsChanged) saveJson('slots.json', slots);
}

console.log(JSON.stringify(report, null, 2));
`;

function exec(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('data', d => { out += d; process.stdout.write(d); });
      stream.stderr.on('data', d => { errOut += d; process.stderr.write(d); });
      stream.on('close', code => resolve({ code: code ?? 0, out, errOut }));
    });
  });
}

function sftpWrite(client, remote, content) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      const ws = sftp.createWriteStream(remote);
      ws.on('close', resolve);
      ws.on('error', reject);
      ws.end(content);
    });
  });
}

async function main() {
  const client = new Client();
  await new Promise((resolve, reject) => {
    client.on('ready', resolve).on('error', reject)
      .connect({ host: '74.208.115.104', port: 22, username: 'root', password });
  });

  // Backup first
  await exec(client, 'mkdir -p /opt/pineflats-backups && cp -a /opt/pineflats/data "/opt/pineflats-backups/pre-receipt-remove-$(date +%Y%m%d-%H%M%S)" && echo BACKUP_OK');

  await sftpWrite(client, '/tmp/remove-receipts.js', remoteScript);
  const result = await exec(client, 'cd /opt/pineflats && node /tmp/remove-receipts.js');
  client.end();
  if (result.code !== 0) process.exit(result.code);
}

main().catch(e => { console.error(e); process.exit(1); });
