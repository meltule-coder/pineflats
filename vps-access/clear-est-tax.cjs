const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
function readPw() {
  const p = path.join('C:/Users/IT101/Desktop', 'Grok.txt');
  const lines = fs.readFileSync(p, 'utf8').split(/\\r?\\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\\s*password:\\s*$/i.test(lines[i]) && i + 1 < lines.length) return lines[i + 1].trim();
  }
  return null;
}
const remote = `
const fs = require('fs');
const p = '/opt/pineflats/data/tax-ledger.json';
const ledger = JSON.parse(fs.readFileSync(p, 'utf8'));
const next = ledger.filter(e => e.status !== 'estimated' && e.source !== 'slot');
const removed = ledger.length - next.length;
fs.copyFileSync(p, p + '.bak-est-' + Date.now());
fs.writeFileSync(p, JSON.stringify(next, null, 2));
console.log(JSON.stringify({ removed, remaining: next.length, remainingEntries: next.map(e => ({ site: e.siteLabel, guest: e.guestName, status: e.status, source: e.source })) }));
`;
const password = readPw();
const client = new Client();
client.on('ready', () => {
  const b64 = Buffer.from(remote, 'utf8').toString('base64');
  client.exec("echo '" + b64 + "' | base64 -d > /tmp/purge-est-tax.js && node /tmp/purge-est-tax.js", (err, stream) => {
    let o = '';
    stream.on('data', d => o += d);
    stream.stderr.on('data', d => o += d);
    stream.on('close', () => { console.log(o); client.end(); });
  });
}).connect({ host: '74.208.115.104', username: 'root', password, port: 22, readyTimeout: 30000, tryKeyboard: true });
