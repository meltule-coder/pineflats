/**
 * Check whether CARD_DATA_KEY / PAYMENT_CARD_KEY is set on the VPS (no secret printed).
 * Usage: npx electron check-card-key.cjs
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const VPS_USER_DATA = path.join(process.env.APPDATA || '', 'pineflats-vps-access');
try {
  app.setName('pineflats-vps-access');
  app.setPath('userData', VPS_USER_DATA);
} catch {
  /* ignore */
}

const CONNECTIONS_FILE = path.join(VPS_USER_DATA, 'ssh-connections.json');

function decryptPassword(stored) {
  if (!stored) return '';
  if (typeof stored === 'string') return stored;
  try {
    if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
    }
    if (stored.value) {
      return Buffer.from(stored.value, 'base64').toString('utf8');
    }
  } catch (e) {
    console.error('Password decrypt failed:', e.message);
    return '';
  }
  return '';
}

function sshConnect(conn, password) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const pass = password || '';
    const config = {
      host: conn.host,
      port: Number(conn.port) || 22,
      username: conn.username,
      readyTimeout: 45000,
      tryKeyboard: true,
    };
    if (pass) config.password = pass;
    client
      .on('ready', () => resolve(client))
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => pass));
      })
      .on('error', reject)
      .connect(config);
  });
}

function execRemote(client, command) {
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

/** Node on remote: presence check only, never print key values */
const REMOTE_JS = `
const fs = require('fs');
const path = require('path');
const dir = fs.existsSync('/opt/pineflats') ? '/opt/pineflats' : process.cwd();
console.log('APP_DIR=' + dir);
function checkEnvFile(f) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) {
    console.log('FILE|' + f + '|missing');
    return;
  }
  console.log('FILE|' + f + '|exists');
  const text = fs.readFileSync(p, 'utf8');
  for (const name of ['CARD_DATA_KEY', 'PAYMENT_CARD_KEY']) {
    const re = new RegExp('^\\\\s*' + name + '\\\\s*=(.*)$', 'm');
    const m = text.match(re);
    if (!m) {
      console.log(name + '|not_in_file');
      continue;
    }
    let val = (m[1] || '').trim().replace(/^[\"']|[\"']$/g, '');
    if (!val || val === 'change-me' || val === 'your-key-here') {
      console.log(name + '|empty_or_placeholder');
    } else {
      console.log(name + '|set|length=' + val.length + '|looks_random=' + (val.length >= 24 ? 'yes' : 'short'));
    }
  }
}
checkEnvFile('.env.local');
checkEnvFile('.env');
const pay = path.join(dir, 'data', 'payments.json');
if (fs.existsSync(pay)) {
  const t = fs.readFileSync(pay, 'utf8');
  console.log('SEALED_CARDS|' + (t.includes('enc:v1:') ? 'yes' : 'no'));
  console.log('SAVED_CARDS_FIELD|' + (t.includes('savedCards') ? 'yes' : 'no'));
} else {
  console.log('PAYMENTS_FILE|missing');
}
const refs = path.join(dir, 'data', 'card-refs.json');
console.log('CARD_REFS_FILE|' + (fs.existsSync(refs) ? 'exists' : 'missing'));
`;

app.whenReady().then(async () => {
  let client;
  try {
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    if (!conn?.host) throw new Error('No saved VPS connection');
    const password = decryptPassword(conn.password);
    if (!password) throw new Error('Could not decrypt VPS password');

    client = await sshConnect(
      { host: conn.host, username: conn.username, port: conn.port },
      password
    );

    const b64 = Buffer.from(REMOTE_JS, 'utf8').toString('base64');
    const result = await execRemote(
      client,
      `echo '${b64}' | base64 -d | node`
    );
    console.log(result.stdout || '');
    if (result.stderr) console.error(result.stderr);
    if (result.code !== 0) {
      app.exit(1);
      return;
    }
    app.exit(0);
  } catch (e) {
    console.error('CHECK FAILED:', e.message || e);
    app.exit(1);
  } finally {
    try {
      client?.end();
    } catch {
      /* ignore */
    }
  }
});

app.on('window-all-closed', (e) => e.preventDefault());
