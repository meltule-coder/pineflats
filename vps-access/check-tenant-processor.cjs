/**
 * Verify tenant payments processor path is ready (Clover + code + status).
 */
const fs = require('fs');
const https = require('https');
const { Client } = require('ssh2');

function readPw() {
  const lines = fs.readFileSync('C:/Users/IT101/Desktop/Grok.txt', 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) return lines[i + 1].trim();
  }
  throw new Error('no password');
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

const report = {
  config: {
    provider: cfg.provider,
    enabled: cfg.enabled === true,
    testMode: cfg.testMode === true,
    merchantId,
    publicKeySet: !!publicKey,
    secretKeySet: !!secretKey,
  },
  readyForTenantProcessor:
    cfg.provider === 'clover' &&
    cfg.enabled === true &&
    !!secretKey &&
    !!merchantId &&
    !!publicKey,
  tests: {},
  code: {},
};

// Live Clover PAKMS
async function main() {
  try {
    const res = await fetch('https://scl.clover.com/pakms/apikey', {
      headers: { Authorization: 'Bearer ' + secretKey, Accept: 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    report.tests.pakms = {
      httpStatus: res.status,
      ok: res.ok && !!(body.apiAccessKey || body.merchantUuid || body.active === true),
      merchantUuid: body.merchantUuid || null,
    };
  } catch (e) {
    report.tests.pakms = { ok: false, error: String(e.message || e) };
  }

  try {
    const res = await fetch('https://api.clover.com/v3/merchants/' + encodeURIComponent(merchantId), {
      headers: { Authorization: 'Bearer ' + secretKey, Accept: 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    report.tests.merchant = {
      httpStatus: res.status,
      ok: res.ok,
      name: body.name || null,
    };
  } catch (e) {
    report.tests.merchant = { ok: false, error: String(e.message || e) };
  }

  // Built server contains tenant initiate-card + charge
  const serverSrc = fs.readFileSync('/opt/pineflats/dist/server.cjs', 'utf8');
  report.code = {
    hasInitiateCardRoute: serverSrc.includes('initiate-card'),
    hasChargeWithProcessor: serverSrc.includes('chargeWithProcessor') || serverSrc.includes('/v1/charges'),
    hasPublicPaymentProcessor: serverSrc.includes('/api/public/payment-processor'),
  };

  // Client bundle mentions processor mode / Clover iframe for tenant payments
  const assetsDir = '/opt/pineflats/dist/assets';
  let mainJs = '';
  try {
    const files = fs.readdirSync(assetsDir).filter((f) => f.startsWith('main-') && f.endsWith('.js'));
    if (files[0]) mainJs = fs.readFileSync(path.join(assetsDir, files[0]), 'utf8');
  } catch {}
  report.frontend = {
    hasInitiateCardCall: mainJs.includes('initiate-card'),
    hasProcessorMode: mainJs.includes('processor') && mainJs.includes('paymentMethodToken'),
    hasCloverIframe: mainJs.includes('checkout.clover.com') || mainJs.includes('Clover') || mainJs.includes('CARD_NUMBER'),
  };

  // Sample active tenant for admin path guidance
  try {
    const tenants = JSON.parse(fs.readFileSync('/opt/pineflats/data/tenants.json', 'utf8'));
    const t = (Array.isArray(tenants) ? tenants : []).find((x) => x.status === 'Active') || tenants[0];
    report.sampleTenant = t ? { id: t.id, name: t.name, site: t.site } : null;
  } catch {
    report.sampleTenant = null;
  }

  report.summary = {
    cloverCredentialsOk: report.readyForTenantProcessor && !!report.tests.pakms?.ok,
    merchantOk: !!report.tests.merchant?.ok,
    serverRoutesOk: !!(report.code.hasInitiateCardRoute && report.code.hasChargeWithProcessor),
    frontendWired: !!(report.frontend.hasInitiateCardCall),
    tenantPaymentsProcessorShouldWork:
      report.readyForTenantProcessor &&
      !!report.tests.pakms?.ok &&
      !!report.code.hasInitiateCardRoute &&
      !!report.frontend.hasInitiateCardCall,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
});
`;

async function main() {
  console.log('=== Public Clover checkout info ===');
  const pub = await httpGet('https://pineflatsrvpark.com/api/public/payment-processor');
  console.log(pub.status, pub.body.slice(0, 400));
  console.log('');

  console.log('=== VPS tenant-processor readiness ===');
  const client = new Client();
  await new Promise((resolve, reject) => {
    client
      .on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.writeFile('/tmp/check-tenant-proc.js', remote, (w) => {
            if (w) return reject(w);
            client.exec('node /tmp/check-tenant-proc.js && rm -f /tmp/check-tenant-proc.js', (e, stream) => {
              if (e) return reject(e);
              stream.on('data', (d) => process.stdout.write(d));
              stream.stderr.on('data', (d) => process.stderr.write(d));
              stream.on('close', () => {
                client.end();
                resolve();
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
