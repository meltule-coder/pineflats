/**
 * Remove tax ledger entries for Site 5 and Site 15 on the live VPS.
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
  console.log(JSON.stringify({ error: 'tax-ledger.json missing', removed: 0 }));
  process.exit(0);
}
const ledger = JSON.parse(fs.readFileSync(p, 'utf8'));
const list = Array.isArray(ledger) ? ledger : [];

function isSite5or15(e) {
  const n = Number(e.siteNumber);
  if (n === 5 || n === 15) return true;
  const sid = String(e.slotId || '');
  if (sid === 'slot-5' || sid === 'slot-15') return true;
  const label = String(e.siteLabel || '').trim();
  const m =
    label.match(/(?:site|sp|#)\\s*0*(\\d+)\\s*$/i) ||
    label.match(/^0*(\\d+)$/);
  if (m) {
    const num = Number(m[1]);
    if (num === 5 || num === 15) return true;
  }
  return false;
}

const removedEntries = list.filter(isSite5or15);
const kept = list.filter((e) => !isSite5or15(e));
const bak = p + '.bak-' + Date.now();
fs.copyFileSync(p, bak);
fs.writeFileSync(p, JSON.stringify(kept, null, 2));
console.log(JSON.stringify({
  removed: removedEntries.length,
  remaining: kept.length,
  backup: bak,
  entries: removedEntries.map((e) => ({
    id: e.id,
    siteLabel: e.siteLabel,
    siteNumber: e.siteNumber,
    guestName: e.guestName,
    checkIn: e.checkIn,
    checkOut: e.checkOut,
    grandTotal: e.grandTotal,
    bookedAt: e.bookedAt,
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
    console.error('No VPS password found in Grok.txt');
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
    // Write remote script via base64 to avoid shell quoting issues
    const b64 = Buffer.from(REMOTE_SCRIPT, 'utf8').toString('base64');
    const write = await sshExec(
      client,
      `echo '${b64}' | base64 -d > /tmp/clear-tax-sites-5-15.js && node /tmp/clear-tax-sites-5-15.js`
    );
    process.stdout.write(write.stdout);
    if (write.stderr) process.stderr.write(write.stderr);
    if (write.code !== 0) {
      throw new Error(`Remote script failed (exit ${write.code})`);
    }

    const restart = await sshExec(client, 'pm2 restart pineflats');
    process.stdout.write(restart.stdout || '');
    if (restart.stderr) process.stderr.write(restart.stderr);

    console.log('\nDONE — Site 5 and 15 tax entries removed on VPS.');
  } finally {
    client.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
