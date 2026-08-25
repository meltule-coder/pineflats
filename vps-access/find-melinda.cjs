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
const files = ['tenants.json','previous-tenants.json','slots.json','customers.json','payments.json'];
const q = /melinda|myers/i;
const out = { matches: {} };
for (const f of files) {
  const p = path + '/' + f;
  if (!fs.existsSync(p)) {
    out.matches[f] = { exists: false };
    continue;
  }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    if (!q.test(raw)) {
      out.matches[f] = { exists: true, hitCount: 0 };
      continue;
    }
    const data = JSON.parse(raw);
    const hits = [];
    if (Array.isArray(data)) {
      data.forEach((row, i) => {
        const s = JSON.stringify(row);
        if (q.test(s)) hits.push({ index: i, preview: row });
      });
    } else if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        if (q.test(JSON.stringify(v)) || q.test(k)) hits.push({ key: k, preview: v });
      }
    }
    out.matches[f] = { exists: true, hitCount: hits.length, hits: hits.slice(0, 10) };
  } catch (e) {
    out.matches[f] = { exists: true, error: String(e.message) };
  }
}
// also list tenant names for context
try {
  const tenants = JSON.parse(fs.readFileSync(path + '/tenants.json', 'utf8'));
  out.currentTenantNames = tenants.map(t => ({ id: t.id, name: t.name, site: t.site, status: t.status }));
} catch {}
try {
  if (fs.existsSync(path + '/previous-tenants.json')) {
    const prev = JSON.parse(fs.readFileSync(path + '/previous-tenants.json', 'utf8'));
    out.previousCount = prev.length;
    out.previousNames = prev.map(r => ({
      id: r.id,
      name: r.tenant && r.tenant.name,
      site: r.tenant && r.tenant.site,
      archivedAt: r.archivedAt,
      reason: r.reason,
    }));
  } else {
    out.previousCount = 0;
    out.previousFile = false;
  }
} catch (e) {
  out.previousError = String(e.message);
}
// backup folders that might still have her
const backups = '/opt/pineflats-backups';
out.backupHits = [];
if (fs.existsSync(backups)) {
  const dirs = fs.readdirSync(backups).sort().reverse().slice(0, 12);
  for (const d of dirs) {
    const tp = backups + '/' + d + '/data/tenants.json';
    if (!fs.existsSync(tp)) continue;
    try {
      const raw = fs.readFileSync(tp, 'utf8');
      if (q.test(raw)) {
        const tenants = JSON.parse(raw);
        const found = tenants.filter(t => q.test(JSON.stringify(t)));
        out.backupHits.push({ backup: d, file: 'tenants.json', found });
      }
    } catch {}
    const pp = backups + '/' + d + '/data/previous-tenants.json';
    if (fs.existsSync(pp)) {
      try {
        const raw = fs.readFileSync(pp, 'utf8');
        if (q.test(raw)) out.backupHits.push({ backup: d, file: 'previous-tenants.json', note: 'contains match' });
      } catch {}
    }
  }
}
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
      sftp.writeFile('/tmp/find-melinda.js', remote, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        client.exec('node /tmp/find-melinda.js && rm -f /tmp/find-melinda.js', (e, stream) => {
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
