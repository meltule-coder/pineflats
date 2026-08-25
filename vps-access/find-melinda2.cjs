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
const dataDir = '/opt/pineflats/data';
const q = /melinda|myers|775-910-1757|jimmyers/i;

function scanFile(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  if (!q.test(raw)) return { hit: false };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { hit: true, rawSnippet: raw.slice(0, 500) }; }
  const hits = [];
  const walk = (node, trail) => {
    if (node == null) return;
    if (typeof node === 'string') {
      if (q.test(node)) hits.push({ trail, value: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, trail + '[' + i + ']'));
      return;
    }
    if (typeof node === 'object') {
      const s = JSON.stringify(node);
      if (q.test(s) && (node.name || node.contactName || node.tenantName || node.guestName)) {
        hits.push({ trail, record: node });
      }
      for (const [k, v] of Object.entries(node)) walk(v, trail + '.' + k);
    }
  };
  walk(parsed, path.basename(p));
  return { hit: true, hits: hits.slice(0, 20) };
}

const out = { files: {}, slotsWithGuest: [] };
for (const f of fs.readdirSync(dataDir)) {
  if (!f.endsWith('.json')) continue;
  const r = scanFile(path.join(dataDir, f));
  if (r && r.hit) out.files[f] = r;
}

// all slots with contact names
try {
  const slots = JSON.parse(fs.readFileSync(path.join(dataDir, 'slots.json'), 'utf8'));
  const list = Array.isArray(slots) ? slots : (slots.slots || []);
  out.slotsWithGuest = list
    .filter(s => s.contactName || s.tenantName)
    .map(s => ({
      id: s.id,
      number: s.number,
      status: s.status,
      tenantName: s.tenantName,
      contactName: s.contactName,
      startDate: s.startDate,
      endDate: s.endDate,
      paymentMethod: s.paymentMethod,
    }));
} catch (e) {
  out.slotsError = String(e.message);
}

// deeper backup search
const backups = '/opt/pineflats-backups';
out.backupScan = [];
if (fs.existsSync(backups)) {
  const dirs = fs.readdirSync(backups).sort().reverse();
  for (const d of dirs) {
    const base = path.join(backups, d, 'data');
    if (!fs.existsSync(base)) continue;
    for (const f of ['tenants.json', 'customers.json', 'slots.json', 'previous-tenants.json', 'payments.json']) {
      const p = path.join(base, f);
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8');
      if (q.test(raw)) {
        out.backupScan.push({ backup: d, file: f, size: raw.length });
      }
    }
  }
}

// guest receipts
try {
  const gr = path.join(dataDir, 'guest-receipts.json');
  if (fs.existsSync(gr)) out.files['guest-receipts.json'] = scanFile(gr);
} catch {}

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
      sftp.writeFile('/tmp/find-melinda2.js', remote, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        client.exec('node /tmp/find-melinda2.js && rm -f /tmp/find-melinda2.js', (e, stream) => {
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
