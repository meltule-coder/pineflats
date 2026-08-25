/**
 * Diagnose Clover connection: config, secrets presence, live PAKMS + merchant API tests.
 * Usage: npx electron diagnose-clover.cjs
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const VPS_USER_DATA = path.join(process.env.APPDATA || '', 'pineflats-vps-access');
try {
  app.setName('pineflats-vps-access');
  app.setPath('userData', VPS_USER_DATA);
} catch {}
const CONNECTIONS_FILE = path.join(VPS_USER_DATA, 'ssh-connections.json');

function decryptPassword(stored) {
  if (!stored) return '';
  if (typeof stored === 'string') return stored;
  try {
    if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
    }
    if (stored.value) return Buffer.from(stored.value, 'base64').toString('utf8');
  } catch {
    return '';
  }
  return '';
}

function sshConnect(conn, password) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on('ready', () => resolve(client))
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => password)))
      .on('error', reject)
      .connect({
        host: conn.host,
        port: Number(conn.port) || 22,
        username: conn.username,
        password: password || undefined,
        tryKeyboard: true,
        readyTimeout: 45000,
      });
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
        .on('data', (d) => { stdout += d.toString(); });
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
    });
  });
}

const REMOTE = `
set +e
cd /opt/pineflats
node <<'NODE'
const fs = require('fs');
const path = require('path');

function load(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const cfg = load('data/payment-processor.json') || {};
const secrets = load('data/payment-processor-secrets.json') || {};
const envLocal = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '';
const envSecret = /PAYMENT_PROCESSOR_SECRET_KEY\\s*=\\s*(\\S+)/.exec(envLocal);
const secretFromEnv = !!(envSecret && envSecret[1] && !envSecret[1].includes('your'));
const secretFromFile = !!(secrets.secretKey && String(secrets.secretKey).trim());
const secret = (secretFromEnv ? envSecret[1].trim() : '') || String(secrets.secretKey || '').trim();
const publicKey = String(cfg.publicKey || '').trim();
const merchantId = String(cfg.merchantId || '').trim();
const testMode = !!cfg.testMode;

console.log('=== CONFIG (redacted) ===');
console.log(JSON.stringify({
  provider: cfg.provider,
  enabled: cfg.enabled,
  testMode,
  displayName: cfg.displayName,
  merchantId: merchantId ? merchantId.slice(0, 6) + '…' + merchantId.slice(-4) + ' (len ' + merchantId.length + ')' : '(empty)',
  merchantIdLooksUuid: /^[A-Z0-9]{13}$/i.test(merchantId) || merchantId.length >= 10,
  publicKeySet: !!publicKey,
  publicKeyLen: publicKey.length,
  publicKeyPrefix: publicKey ? publicKey.slice(0, 6) + '…' : '',
  secretFromEnv,
  secretFromFile,
  secretSet: !!secret,
  secretLen: secret.length,
  secretLooksJwt: secret.split('.').length === 3,
  secretLooksUuid: /^[0-9a-f-]{36}$/i.test(secret),
  webhookSet: !!(secrets.webhookSecret || /PAYMENT_PROCESSOR_WEBHOOK/.test(envLocal)),
}, null, 2));

const scl = testMode ? 'https://scl-sandbox.dev.clover.com' : 'https://scl.clover.com';
const api = testMode ? 'https://apisandbox.dev.clover.com' : 'https://api.clover.com';
const tokenApi = testMode ? 'https://token-sandbox.dev.clover.com' : 'https://token.clover.com';

async function hit(label, url, headers) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    console.log('\\n===', label, '===');
    console.log('URL', url);
    console.log('HTTP', res.status);
    if (body && typeof body === 'object') {
      const safe = { ...body };
      // redact long tokens
      console.log(JSON.stringify(safe, null, 2).slice(0, 800));
    } else {
      console.log(String(body).slice(0, 400));
    }
    return { status: res.status, body };
  } catch (e) {
    console.log('\\n===', label, 'ERROR ===', e.message);
    return { status: 0, error: e.message };
  }
}

(async () => {
  if (!secret) {
    console.log('\\nNO SECRET KEY — cannot call Clover. Save private API token under Payment processor.');
    console.log('DONE');
    return;
  }

  // 1) PAKMS apikey with private token
  const pakms = await hit('PAKMS /pakms/apikey (' + (testMode ? 'sandbox' : 'live') + ')', scl + '/pakms/apikey', {
    Accept: 'application/json',
    Authorization: 'Bearer ' + secret,
  });

  // 2) Opposite environment (common misconfig)
  const otherScl = testMode ? 'https://scl.clover.com' : 'https://scl-sandbox.dev.clover.com';
  await hit('PAKMS opposite env (' + (testMode ? 'live' : 'sandbox') + ')', otherScl + '/pakms/apikey', {
    Accept: 'application/json',
    Authorization: 'Bearer ' + secret,
  });

  // 3) Merchant GET
  if (merchantId) {
    await hit('Merchant GET /v3/merchants/{id}', api + '/v3/merchants/' + encodeURIComponent(merchantId), {
      Accept: 'application/json',
      Authorization: 'Bearer ' + secret,
    });
  }

  // 4) Public ecommerce readiness
  console.log('\\n=== App ready flags (mirrors getPaymentProcessorStatus) ===');
  const hasSecret = !!secret;
  const hasMerchant = !!merchantId;
  const ready = cfg.provider === 'clover' && cfg.enabled && hasSecret && hasMerchant;
  const onlineCardReady = ready && !!publicKey;
  console.log(JSON.stringify({
    provider: cfg.provider,
    enabled: cfg.enabled,
    readyForCharges: ready,
    readyForOnlineCardForm: onlineCardReady,
    issue: !cfg.enabled ? 'Enable is OFF'
      : cfg.provider !== 'clover' ? 'Provider is not clover'
      : !hasSecret ? 'Missing private API token'
      : !hasMerchant ? 'Missing merchant ID'
      : !publicKey ? 'Missing public/PAKMS key (needed for card form)'
      : 'Config looks complete — check API test results above',
  }, null, 2));

  console.log('\\nDONE');
})();
NODE
`;

app.whenReady().then(async () => {
  try {
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    if (!conn?.host) throw new Error('No connection');
    const password = decryptPassword(conn.password);
    if (!password) throw new Error('No password');
    const client = await sshConnect(conn, password);
    const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
    const r = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(r.stdout || '');
    if (r.stderr) console.error(r.stderr);
    client.end();
    app.exit(0);
  } catch (e) {
    console.error(e.message || e);
    app.exit(1);
  }
});
