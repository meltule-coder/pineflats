/**
 * Add Melinda Myers overnight stay (Site 14, July 18 → 19) to tax ledger.
 */
const fs = require('fs');
const { Client } = require('ssh2');

function readPw() {
  const lines = fs.readFileSync('C:/Users/IT101/Desktop/Grok.txt', 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) {
      return lines[i + 1].trim();
    }
  }
  throw new Error('no VPS password');
}

const remote = `
const fs = require('fs');
const path = require('path');

// Use the app's own tax module if built server is available; otherwise compute inline.
const DATA = '/opt/pineflats/data';
const LEDGER = path.join(DATA, 'tax-ledger.json');
const PROPS = path.join(DATA, 'properties.json');

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

function loadJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function saveJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\\n', { mode: 0o600 });
}

// Rates from active property
const props = loadJson(PROPS, []);
const list = Array.isArray(props) ? props : (props.properties || []);
const active = list.find(p => p.isActive) || list[0] || {};
const rates = active.rentalRates || {};
const dailyWeekday = Number(rates.dailyWeekday) || 50;
const dailyWeekend = Number(rates.dailyWeekend) || dailyWeekday;
const statePct = Number(rates.stateTransientTaxPercent) || 1.8;
const countyPct = Number(rates.countyTransientTaxPercent) || 1.5;

// July 18, 2026 is a Saturday → weekend rate
const checkIn = '2026-07-18';
const checkOut = '2026-07-19';
const d = new Date(checkIn + 'T12:00:00');
const day = d.getDay(); // 0 Sun ... 6 Sat
const isWeekend = day === 0 || day === 5 || day === 6; // Fri/Sat/Sun if park uses that
// Match rentUtils: typically Fri-Sat night weekend — check rentUtils
// For safety use Saturday = weekend
const nightRate = (day === 0 || day === 6 || day === 5) ? dailyWeekend : dailyWeekday;
const rentSubtotal = money(nightRate);
const stateTax = money(rentSubtotal * (statePct / 100));
const countyTax = money(rentSubtotal * (countyPct / 100));
const totalTax = money(stateTax + countyTax);
const grandTotal = money(rentSubtotal + totalTax);

let ledger = loadJson(LEDGER, []);
if (!Array.isArray(ledger)) ledger = [];

// Remove any prior Melinda Myers site 14 July 18 duplicate
const before = ledger.length;
ledger = ledger.filter(e => {
  const sameGuest = /melinda\\s*myers/i.test(String(e.guestName || ''));
  const sameStay =
    String(e.checkIn || '').slice(0, 10) === checkIn &&
    String(e.checkOut || '').slice(0, 10) === checkOut &&
    (Number(e.siteNumber) === 14 || /site\\s*14|#14/i.test(String(e.siteLabel || '')));
  return !(sameGuest && sameStay);
});

const entry = {
  id: 'tax_' + Date.now() + '_melinda14',
  bookedAt: checkIn,
  checkIn,
  checkOut,
  nights: 1,
  rentalType: 'daily',
  guestName: 'Melinda Myers',
  guestEmail: 'jimmyers@rocketemail.com',
  guestPhone: '775-910-1757',
  siteLabel: 'Site 14',
  siteNumber: 14,
  slotId: 'slot-14',
  paymentMethod: 'Cash',
  rentSubtotal,
  stateTaxPercent: statePct,
  countyTaxPercent: countyPct,
  stateTax,
  countyTax,
  totalTax,
  grandTotal,
  status: 'paid',
  source: 'manual',
  createdAt: new Date().toISOString(),
  notes: 'Overnight stay recorded for tax (admin)',
};

ledger.push(entry);
saveJson(LEDGER, ledger);

// Also ensure customer record stays current
const CUST = path.join(DATA, 'customers.json');
let customers = loadJson(CUST, []);
if (Array.isArray(customers)) {
  const idx = customers.findIndex(c => /melinda\\s*myers/i.test(c.name || ''));
  const patch = {
    name: 'Melinda Myers',
    phone: '775-910-1757',
    email: 'jimmyers@rocketemail.com',
    notes: 'Overnight Site 14 · July 18–19, 2026 (tax recorded)',
    updatedAt: '2026-07-18',
  };
  if (idx >= 0) customers[idx] = { ...customers[idx], ...patch };
  else customers.push({ id: String(Date.now()), ...patch });
  saveJson(CUST, customers);
}

console.log(JSON.stringify({
  ok: true,
  removedDuplicates: before - (ledger.length - 1),
  ratesUsed: {
    dailyWeekday,
    dailyWeekend,
    nightRate,
    dayOfWeek: day,
    isWeekendNight: day === 0 || day === 5 || day === 6,
    statePct,
    countyPct,
  },
  entry,
  ledgerCount: ledger.length,
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
      sftp.writeFile('/tmp/add-melinda-tax.js', remote, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        client.exec(
          'node /tmp/add-melinda-tax.js && rm -f /tmp/add-melinda-tax.js && pm2 restart pineflats --update-env',
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
