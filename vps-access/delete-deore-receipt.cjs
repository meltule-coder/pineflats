/**
 * Delete payment receipt(s) for Jake/Jacob DeOre (tenant id 15).
 * Removes payment records that drive printable receipts; keeps tenant.
 */
const fs = require('fs');
const { Client } = require('ssh2');

function readPw() {
  const lines = fs.readFileSync('C:/Users/IT101/Desktop/Grok.txt', 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) return lines[i + 1].trim();
  }
  throw new Error('no password');
}

const remote = `
const fs = require('fs');
const path = require('path');
const DATA = '/opt/pineflats/data';

function load(p, fb) {
  if (!fs.existsSync(p)) return fb;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; }
}
function save(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\\n', { mode: 0o600 });
}

const tenants = load(path.join(DATA, 'tenants.json'), []);
const tenant = (Array.isArray(tenants) ? tenants : []).find(t =>
  /deore|de ore/i.test(t.name || '') || /jake|jacob/i.test(t.name || '') && /de/i.test(t.name || '')
);
if (!tenant) {
  console.log(JSON.stringify({ ok: false, error: 'Tenant Jake/Jacob DeOre not found' }));
  process.exit(1);
}

const paymentsPath = path.join(DATA, 'payments.json');
const payments = load(paymentsPath, {});
const pay = payments[tenant.id];
const removed = [];

if (pay && Array.isArray(pay.records) && pay.records.length) {
  removed.push(...pay.records);
  pay.records = [];
  // keep structure so rent/electric still work
  payments[tenant.id] = pay;
  save(paymentsPath, payments);
}

// Guest overnight/weekly receipts
const grPath = path.join(DATA, 'guest-receipts.json');
let gr = load(grPath, null);
let guestRemoved = [];
if (gr) {
  if (Array.isArray(gr)) {
    const next = gr.filter(r => {
      const hit = /deore|de ore|jake|jacob/i.test(JSON.stringify(r));
      if (hit) guestRemoved.push(r);
      return !hit;
    });
    if (guestRemoved.length) save(grPath, next);
  } else if (gr.receipts && Array.isArray(gr.receipts)) {
    const next = gr.receipts.filter(r => {
      const hit = /deore|de ore|jake|jacob/i.test(JSON.stringify(r));
      if (hit) guestRemoved.push(r);
      return !hit;
    });
    if (guestRemoved.length) {
      gr.receipts = next;
      save(grPath, gr);
    }
  }
}

// hidden guest receipts if any
const hiddenPath = path.join(DATA, 'guest-receipts-hidden.json');
let hiddenRemoved = [];
if (fs.existsSync(hiddenPath)) {
  let hidden = load(hiddenPath, []);
  if (Array.isArray(hidden)) {
    const next = hidden.filter(r => {
      const hit = /deore|de ore/i.test(JSON.stringify(r));
      if (hit) hiddenRemoved.push(r);
      return !hit;
    });
    if (hiddenRemoved.length) save(hiddenPath, next);
  } else if (hidden && Array.isArray(hidden.receipts)) {
    const next = hidden.receipts.filter(r => {
      const hit = /deore|de ore/i.test(JSON.stringify(r));
      if (hit) hiddenRemoved.push(r);
      return !hit;
    });
    if (hiddenRemoved.length) {
      hidden.receipts = next;
      save(hiddenPath, hidden);
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  tenant: { id: tenant.id, name: tenant.name, site: tenant.site },
  paymentRecordsRemoved: removed.map(r => ({
    id: r.id, date: r.date, amount: r.amount, method: r.method, note: r.note
  })),
  guestReceiptsRemoved: guestRemoved.length,
  hiddenReceiptsRemoved: hiddenRemoved.length,
  remainingPaymentRecords: (payments[tenant.id] && payments[tenant.id].records || []).length,
}, null, 2));
`;

const client = new Client();
client
  .on('ready', () => {
    client.sftp((err, sftp) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      sftp.writeFile('/tmp/del-deore-receipt.js', remote, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        client.exec(
          'node /tmp/del-deore-receipt.js && rm -f /tmp/del-deore-receipt.js && pm2 restart pineflats --update-env',
          (e, stream) => {
            if (e) {
              console.error(e);
              process.exit(1);
            }
            stream.on('data', (d) => process.stdout.write(d));
            stream.stderr.on('data', (d) => process.stderr.write(d));
            stream.on('close', (c) => {
              client.end();
              process.exit(c || 0);
            });
          }
        );
      });
    });
  })
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({
    host: '74.208.115.104',
    username: 'root',
    password: readPw(),
    tryKeyboard: true,
    readyTimeout: 30000,
  });
