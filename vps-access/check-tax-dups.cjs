const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

function readPw() {
  const p = path.join('C:/Users/IT101/Desktop', 'Grok.txt');
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) {
      return lines[i + 1].trim();
    }
  }
  throw new Error('no pw');
}

const remoteScript = `
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/opt/pineflats/data/tax-ledger.json', 'utf8'));
console.log('count', data.length);
const key = e => [e.guestName, e.checkIn, e.checkOut, e.siteLabel || e.siteNumber, e.rentalType].join('|');
const map = new Map();
for (const e of data) {
  const k = key(e);
  if (!map.has(k)) map.set(k, []);
  map.get(k).push({
    id: e.id,
    source: e.source,
    status: e.status,
    bookedAt: e.bookedAt,
    slotId: e.slotId,
    total: e.grandTotal,
  });
}
const dups = [...map.entries()].filter(([, v]) => v.length > 1);
console.log('dup groups', dups.length);
for (const [k, v] of dups.slice(0, 25)) {
  console.log('---', k);
  console.log(JSON.stringify(v));
}
// also by slotId+checkIn only
const key2 = e => [e.slotId || e.siteNumber, e.checkIn, e.rentalType].join('|');
const map2 = new Map();
for (const e of data) {
  const k = key2(e);
  if (!map2.has(k)) map2.set(k, []);
  map2.get(k).push(e.id + ':' + e.source + ':' + e.status);
}
const dups2 = [...map2.entries()].filter(([, v]) => v.length > 1);
console.log('dup by slot+checkin', dups2.length);
for (const [k, v] of dups2.slice(0, 15)) console.log(k, v);
`;

const password = readPw();
const client = new Client();
client
  .on('ready', () => {
    const b64 = Buffer.from(remoteScript, 'utf8').toString('base64');
    client.exec(
      `echo '${b64}' | base64 -d > /tmp/check-tax-dups.js && node /tmp/check-tax-dups.js`,
      (err, stream) => {
        if (err) {
          console.error(err);
          client.end();
          process.exit(1);
        }
        stream.on('data', (d) => process.stdout.write(d));
        stream.stderr.on('data', (d) => process.stderr.write(d));
        stream.on('close', (code) => {
          client.end();
          process.exit(code || 0);
        });
      }
    );
  })
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({
    host: '74.208.115.104',
    username: 'root',
    password,
    readyTimeout: 30000,
    tryKeyboard: true,
  });
