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
const path = '/opt/pineflats/data';
const q = /jacob|jake|deore|de ore/i;
const out = {};

function load(name) {
  const p = path + '/' + name;
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { _error: e.message }; }
}

const tenants = load('tenants.json') || [];
out.tenants = (Array.isArray(tenants) ? tenants : []).filter(t => q.test(JSON.stringify(t)));

const guests = load('guest-receipts.json');
const guestList = Array.isArray(guests) ? guests : (guests && guests.receipts) || [];
out.guestReceipts = guestList.filter(r => q.test(JSON.stringify(r)));
out.guestReceiptsFileShape = Array.isArray(guests) ? 'array' : typeof guests;

const payments = load('payments.json') || {};
out.paymentMatches = [];
if (payments && typeof payments === 'object' && !payments._error) {
  for (const [tid, pay] of Object.entries(payments)) {
    if (q.test(JSON.stringify(pay)) || out.tenants.some(t => t.id === tid)) {
      const t = (Array.isArray(tenants) ? tenants : []).find(x => x.id === tid);
      out.paymentMatches.push({
        tenantId: tid,
        tenantName: t && t.name,
        recordCount: (pay.records || []).length,
        records: (pay.records || []).map(r => ({ id: r.id, date: r.date, amount: r.amount, method: r.method, note: r.note })),
      });
    }
  }
}

// also match tenant name on payment keys via tenant list
for (const t of out.tenants) {
  const pay = payments[t.id];
  if (pay && !out.paymentMatches.some(m => m.tenantId === t.id)) {
    out.paymentMatches.push({
      tenantId: t.id,
      tenantName: t.name,
      recordCount: (pay.records || []).length,
      records: (pay.records || []).map(r => ({ id: r.id, date: r.date, amount: r.amount, method: r.method, note: r.note })),
    });
  }
}

const ledger = load('tax-ledger.json') || [];
out.tax = (Array.isArray(ledger) ? ledger : []).filter(e => q.test(JSON.stringify(e)));

const customers = load('customers.json') || [];
out.customers = (Array.isArray(customers) ? customers : []).filter(c => q.test(JSON.stringify(c)));

// list guest receipt files
out.dataFiles = fs.readdirSync(path).filter(f => /receipt/i.test(f));

console.log(JSON.stringify(out, null, 2));
`;

const client = new Client();
client
  .on('ready', () => {
    client.sftp((err, sftp) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      sftp.writeFile('/tmp/find-deore.js', remote, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        client.exec('node /tmp/find-deore.js && rm -f /tmp/find-deore.js', (e, stream) => {
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
        });
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
