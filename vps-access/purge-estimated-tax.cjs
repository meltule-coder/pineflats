/**
 * Remove estimated / slot-synced tax ledger rows on the live VPS.
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

function readPw() {
  const p = path.join('C:/Users/IT101/Desktop', 'Grok.txt');
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) {
      return lines[i + 1].trim();
    }
  }
  return null;
}

const REMOTE_SCRIPT = `
const fs = require('fs');
const p = '/opt/pineflats/data/tax-ledger.json';
if (!fs.existsSync(p)) {
  console.log(JSON.stringify({ error: 'missing', removed: 0 }));
  process.exit(0);
}
const ledger = JSON.parse(fs.readFileSync(p, 'utf8'));
const list = Array.isArray(ledger) ? ledger : [];
const next = list.filter(e => e.status !== 'estimated' && e.source !== 'slot');
const removed = list.length - next.length;
const bak = p + '.bak-est-' + Date.now();
fs.copyFileSync(p, bak);
fs.writeFileSync(p, JSON.stringify(next, null, 2));
console.log(JSON.stringify({
  removed,
  remaining: next.length,
  backup: bak,
  remainingEntries: next.map(e => ({
    site: e.siteLabel,
    guest: e.guestName,
    status: e.status,
    source: e.source,
  })),
}, null, 2));
`;

function sshExec(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
        .on('data', (d) => {
          stdout += d.toString();
        });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
      });
    });
  });
}

async function main() {
  const password = readPw();
  if (!password) {
    console.error('No VPS password found');
    process.exit(1);
  }
  const client = new Client();
  await new Promise((resolve, reject) => {
    client
      .on('ready', resolve)
      .on('error', reject)
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => password));
      })
      .connect({
        host: '74.208.115.104',
        port: 22,
        username: 'root',
        password,
        readyTimeout: 30000,
        tryKeyboard: true,
      });
  });

  try {
    const b64 = Buffer.from(REMOTE_SCRIPT, 'utf8').toString('base64');
    const result = await sshExec(
      client,
      `echo '${b64}' | base64 -d > /tmp/purge-estimated-tax.js && node /tmp/purge-estimated-tax.js`
    );
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.code !== 0) throw new Error(`exit ${result.code}`);
    console.log('PURGE_OK');
  } finally {
    client.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
