/**
 * Full Clover health check: config, public API, live Clover auth, code paths.
 */
const fs = require('fs');
const https = require('https');
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

function httpGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e.message || e) }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: 'timeout' });
    });
  });
}

const remote = `
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync('/opt/pineflats/data/payment-processor.json', 'utf8'));
const secrets = JSON.parse(fs.readFileSync('/opt/pineflats/data/payment-processor-secrets.json', 'utf8'));
const secretKey = String(secrets.secretKey || '').trim();
const merchantId = String(cfg.merchantId || '').trim();
const publicKey = String(cfg.publicKey || '').trim();
const testMode = cfg.testMode === true;
const enabled = cfg.enabled === true;
const provider = cfg.provider;

const report = {
  config: {
    provider,
    enabled,
    testMode,
    displayName: cfg.displayName || '',
    merchantId,
    publicKeySet: !!publicKey,
    publicKeyPrefix: publicKey ? publicKey.slice(0, 8) + '…' : '',
    secretKeySet: !!secretKey,
    secretKeyLen: secretKey.length,
    webhookSet: !!(secrets.webhookSecret && String(secrets.webhookSecret).trim()),
    updatedAt: cfg.updatedAt,
  },
  readyHeuristic: provider === 'clover' && enabled && !!secretKey && !!merchantId && !!publicKey,
  tests: {},
};

async function main() {
  // PAKMS via SCL (production then sandbox)
  const modes = [
    { name: 'production', scl: 'https://scl.clover.com', api: 'https://api.clover.com' },
    { name: 'sandbox', scl: 'https://scl-sandbox.dev.clover.com', api: 'https://apisandbox.dev.clover.com' },
  ];
  report.tests.pakms = { attempts: [] };
  for (const m of modes) {
    try {
      const res = await fetch(m.scl + '/pakms/apikey', {
        headers: { Authorization: 'Bearer ' + secretKey, Accept: 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && !!(body.active === true || body.apiAccessKey || body.merchantUuid);
      report.tests.pakms.attempts.push({
        mode: m.name,
        httpStatus: res.status,
        ok,
        merchantUuid: body.merchantUuid || null,
        apiAccessKeyPresent: !!body.apiAccessKey,
      });
      if (ok) {
        report.tests.pakms.ok = true;
        report.tests.pakms.workingMode = m.name;
        report.tests.pakms.merchantUuid = body.merchantUuid || null;
        break;
      }
    } catch (e) {
      report.tests.pakms.attempts.push({ mode: m.name, ok: false, error: String(e.message || e) });
    }
  }
  if (!report.tests.pakms.ok) report.tests.pakms.ok = false;

  // Merchant GET
  try {
    const base = (report.tests.pakms.workingMode === 'sandbox')
      ? 'https://apisandbox.dev.clover.com'
      : 'https://api.clover.com';
    const res = await fetch(base + '/v3/merchants/' + encodeURIComponent(merchantId), {
      headers: { Authorization: 'Bearer ' + secretKey, Accept: 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    report.tests.merchant = {
      httpStatus: res.status,
      ok: res.ok,
      name: body.name || null,
      message: body.message || (res.ok ? 'OK' : JSON.stringify(body).slice(0, 200)),
    };
  } catch (e) {
    report.tests.merchant = { ok: false, error: String(e.message || e) };
  }

  // SCL charges list
  try {
    const scl = (report.tests.pakms.workingMode === 'sandbox')
      ? 'https://scl-sandbox.dev.clover.com'
      : 'https://scl.clover.com';
    const res = await fetch(scl + '/v1/charges?limit=3', {
      headers: { Authorization: 'Bearer ' + secretKey, Accept: 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    const data = Array.isArray(body.data) ? body.data : [];
    report.tests.sclChargesList = {
      httpStatus: res.status,
      ok: res.ok,
      recentCount: data.length,
      recent: data.slice(0, 3).map((c) => ({
        id: c.id,
        amount: c.amount,
        status: c.status || c.paid,
        created: c.created,
      })),
      message: body.message || body.error || (res.ok ? 'OK' : 'failed'),
    };
  } catch (e) {
    report.tests.sclChargesList = { ok: false, error: String(e.message || e) };
  }

  // Grep built server for charge/tokenize paths
  try {
    const serverPath = '/opt/pineflats/dist/server.cjs';
    const src = fs.readFileSync(serverPath, 'utf8');
    report.codePaths = {
      hasTokenizeClover: src.includes('tokenizeClover') || src.includes('/v1/tokens'),
      hasChargeClover: src.includes('/v1/charges') || src.includes('chargeWithClover'),
      hasPublicPaymentProcessor: src.includes('/api/public/payment-processor'),
      hasBookingsCardCharge: src.includes('wantsCard') || src.includes('paymentMethodToken'),
      hasInitiateCard: src.includes('initiate-card') || src.includes('/payments/initiate-card'),
    };
  } catch (e) {
    report.codePaths = { error: String(e.message || e) };
  }

  report.summary = {
    credentialsOk: !!(report.config.secretKeySet && report.config.merchantId && report.config.publicKeySet),
    cloverAuthOk: !!report.tests.pakms.ok,
    merchantOk: !!report.tests.merchant?.ok,
    chargesApiOk: !!report.tests.sclChargesList?.ok,
    onlineCardReady:
      report.config.provider === 'clover' &&
      report.config.enabled &&
      !!report.tests.pakms.ok &&
      !!report.config.publicKeySet,
    liveMode: report.config.testMode === false,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
});
`;

async function main() {
  console.log('=== A) Public HTTPS endpoints ===\n');
  for (const url of [
    'https://pineflatsrvpark.com/api/public/payment-processor',
    'https://pineflatsrvpark.com/api/health',
    'https://pineflatsrvpark.com/api/payment-processor/status',
  ]) {
    const r = await httpGet(url);
    console.log(url, '→', r.status);
    console.log(r.body.slice(0, 500));
    console.log('---');
  }

  console.log('\n=== B) VPS Clover config + live API ===\n');
  const client = new Client();
  await new Promise((resolve, reject) => {
    client
      .on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.writeFile('/tmp/check-clover-full.js', remote, (w) => {
            if (w) return reject(w);
            client.exec('node /tmp/check-clover-full.js && rm -f /tmp/check-clover-full.js', (e, stream) => {
              if (e) return reject(e);
              stream.on('data', (d) => process.stdout.write(d));
              stream.stderr.on('data', (d) => process.stderr.write(d));
              stream.on('close', (code) => {
                client.end();
                resolve(code);
              });
            });
          });
        });
      })
      .on('error', reject)
      .connect({
        host: '74.208.115.104',
        username: 'root',
        password: readPw(),
        tryKeyboard: true,
        readyTimeout: 30000,
      });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
