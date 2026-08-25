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
const q = /melinda|myers|meyers|775-910-1757|jimmyers|trejo/i;

function load(name) {
  const p = path + '/' + name;
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const ledger = load('tax-ledger.json');
const out = {
  ledgerType: Array.isArray(ledger) ? 'array' : typeof ledger,
  melindaHits: [],
  summaryByYear: {},
  recentEntries: [],
  guestReceiptsHits: [],
};

// normalize entries
let entries = [];
if (Array.isArray(ledger)) entries = ledger;
else if (ledger && Array.isArray(ledger.entries)) entries = ledger.entries;
else if (ledger && typeof ledger === 'object') {
  // maybe keyed by year
  for (const [k, v] of Object.entries(ledger)) {
    if (Array.isArray(v)) entries.push(...v.map(e => ({ ...e, _bucket: k })));
    else if (v && Array.isArray(v.entries)) entries.push(...v.entries.map(e => ({ ...e, _bucket: k })));
  }
}

out.totalEntries = entries.length;

for (const e of entries) {
  const s = JSON.stringify(e);
  if (q.test(s)) out.melindaHits.push(e);
}

// group totals lightly
for (const e of entries) {
  const year = e.year || e.taxYear || (e.checkIn && String(e.checkIn).slice(0, 4)) || e._bucket || 'unknown';
  if (!out.summaryByYear[year]) out.summaryByYear[year] = { count: 0, stateTax: 0, countyTax: 0, rent: 0 };
  out.summaryByYear[year].count += 1;
  out.summaryByYear[year].stateTax += Number(e.stateTax || e.stateTaxAmount || 0) || 0;
  out.summaryByYear[year].countyTax += Number(e.countyTax || e.countyTaxAmount || 0) || 0;
  out.summaryByYear[year].rent += Number(e.rent || e.subtotal || e.taxableAmount || 0) || 0;
}

// sample recent
out.recentEntries = entries
  .slice()
  .sort((a, b) => String(b.recordedAt || b.at || b.checkIn || '').localeCompare(String(a.recordedAt || a.at || a.checkIn || '')))
  .slice(0, 8)
  .map(e => ({
    guest: e.guestName || e.name || e.contactName,
    site: e.siteLabel || e.siteNumber || e.site,
    checkIn: e.checkIn,
    checkOut: e.checkOut,
    rentalType: e.rentalType,
    stateTax: e.stateTax ?? e.stateTaxAmount,
    countyTax: e.countyTax ?? e.countyTaxAmount,
    rent: e.rent ?? e.subtotal ?? e.taxableAmount,
    estimated: e.estimated,
    id: e.id,
  }));

// guest receipts
const gr = load('guest-receipts.json');
if (Array.isArray(gr)) {
  for (const r of gr) {
    if (q.test(JSON.stringify(r))) out.guestReceiptsHits.push(r);
  }
} else if (gr && Array.isArray(gr.receipts)) {
  for (const r of gr.receipts) {
    if (q.test(JSON.stringify(r))) out.guestReceiptsHits.push(r);
  }
}

// structure sample of ledger keys
if (ledger && !Array.isArray(ledger) && typeof ledger === 'object') {
  out.ledgerTopKeys = Object.keys(ledger).slice(0, 20);
  const firstKey = Object.keys(ledger)[0];
  if (firstKey) {
    const sample = ledger[firstKey];
    out.sampleBucket = {
      key: firstKey,
      type: Array.isArray(sample) ? 'array' : typeof sample,
      length: Array.isArray(sample) ? sample.length : undefined,
      entryKeys: sample && !Array.isArray(sample) ? Object.keys(sample).slice(0, 15) : (Array.isArray(sample) && sample[0] ? Object.keys(sample[0]) : []),
    };
  }
} else if (entries[0]) {
  out.entryKeys = Object.keys(entries[0]);
}

// phone reservation customers note
const customers = load('customers.json') || [];
out.melindaCustomer = (Array.isArray(customers) ? customers : []).find(c => /melinda\\s*myers/i.test(c.name || ''));

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
      sftp.writeFile('/tmp/check-tax-melinda.js', remote, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        client.exec('node /tmp/check-tax-melinda.js && rm -f /tmp/check-tax-melinda.js', (e, stream) => {
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
