const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

function readPw() {
  const p = path.join('C:/Users/IT101/Desktop', 'Grok.txt');
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) return lines[i + 1].trim();
  }
  return null;
}

const remote = `
const fs = require('fs');
const slots = JSON.parse(fs.readFileSync('/opt/pineflats/data/slots.json', 'utf8'));
const pick = slots.filter(x => x.number === 5 || x.number === 15);
console.log(JSON.stringify({
  slots: pick.map(x => ({
    n: x.number,
    status: x.status,
    rentalType: x.rentalType,
    start: x.startDate,
    end: x.endDate,
    name: x.contactName || x.tenantName,
  })),
  ledger: JSON.parse(fs.readFileSync('/opt/pineflats/data/tax-ledger.json', 'utf8')).map(e => ({
    site: e.siteLabel,
    guest: e.guestName,
    in: e.checkIn,
    out: e.checkOut,
  })),
}, null, 2));
`;

const password = readPw();
const client = new Client();
client
  .on('ready', () => {
    const b64 = Buffer.from(remote, 'utf8').toString('base64');
    client.exec(
      `echo '${b64}' | base64 -d > /tmp/check-slots-5-15.js && node /tmp/check-slots-5-15.js`,
      (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('data', (d) => (out += d));
        stream.stderr.on('data', (d) => (out += d));
        stream.on('close', () => {
          console.log(out);
          client.end();
        });
      }
    );
  })
  .connect({
    host: '74.208.115.104',
    username: 'root',
    password,
    port: 22,
    readyTimeout: 30000,
    tryKeyboard: true,
  });
