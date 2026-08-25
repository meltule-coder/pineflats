const fs = require('fs');
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

// Run on the server inside /opt/pineflats using the built dist modules if possible.
// Safer: shell out to a small script that uses fetch like paymentProcessor does.
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

const apiBase = testMode ? 'https://apisandbox.dev.clover.com' : 'https://api.clover.com';
const pakmsBase = testMode ? 'https://apisandbox.dev.clover.com' : 'https://api.clover.com';
// Ecommerce PAKMS path used by app:
// GET {cloverApiBase}/pakms/apikey with Authorization: Bearer private_token

async function main() {
  const report = {
    provider,
    enabled,
    testMode,
    merchantId,
    publicKeySet: !!publicKey,
    publicKeyPrefix: publicKey ? publicKey.slice(0, 6) + '…' : '',
    secretKeySet: !!secretKey,
    secretKeyLen: secretKey.length,
    readyHeuristic: !!(provider === 'clover' && enabled && secretKey && merchantId),
    tests: {},
  };

  // 1) PAKMS apikey via Ecommerce (SCL) — same path as the app
  // Try production then sandbox
  try {
    const modes = [
      { name: 'production', base: 'https://scl.clover.com' },
      { name: 'sandbox', base: 'https://scl-sandbox.dev.clover.com' },
    ];
    report.tests.pakms = { attempts: [] };
    for (const m of modes) {
      const res = await fetch(m.base + '/pakms/apikey', {
        headers: { Authorization: 'Bearer ' + secretKey, Accept: 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      const attempt = {
        mode: m.name,
        httpStatus: res.status,
        ok: res.ok && !!(body.active === true || body.apiAccessKey || body.merchantUuid),
        merchantUuid: body.merchantUuid || null,
        apiAccessKeyPresent: !!body.apiAccessKey,
        message: body.message || body.error || (res.ok ? 'OK' : 'failed'),
      };
      report.tests.pakms.attempts.push(attempt);
      if (attempt.ok) {
        report.tests.pakms.ok = true;
        report.tests.pakms.workingMode = m.name;
        report.tests.pakms.merchantUuid = attempt.merchantUuid;
        break;
      }
    }
    if (!report.tests.pakms.ok) report.tests.pakms.ok = false;
  } catch (e) {
    report.tests.pakms = { ok: false, error: String(e.message || e) };
  }

  // 2) Merchant GET
  try {
    const url = apiBase + '/v3/merchants/' + encodeURIComponent(merchantId);
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + secretKey, Accept: 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    report.tests.merchant = {
      httpStatus: res.status,
      ok: res.ok,
      name: body.name || body.merchantName || null,
      message: body.message || (res.ok ? 'OK' : JSON.stringify(body).slice(0, 200)),
    };
  } catch (e) {
    report.tests.merchant = { ok: false, error: String(e.message || e) };
  }

  // 3) If dist has test endpoint logic — also try SCL me or account
  try {
    const scl = (testMode ? 'https://scl-sandbox.dev.clover.com' : 'https://scl.clover.com') + '/v1/charges?limit=1';
    const res = await fetch(scl, {
      headers: { Authorization: 'Bearer ' + secretKey, Accept: 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    report.tests.sclChargesList = {
      httpStatus: res.status,
      ok: res.ok,
      message: body.message || body.error || (res.ok ? 'OK (list reachable)' : 'failed'),
    };
  } catch (e) {
    report.tests.sclChargesList = { ok: false, error: String(e.message || e) };
  }

  // Summary
  report.summary = {
    credentialsPresent: report.readyHeuristic,
    cloverApiAuthOk: !!(report.tests.pakms?.ok || report.tests.merchant?.ok),
    liveChargesPossible: !!(report.readyHeuristic && (report.tests.pakms?.ok || report.tests.merchant?.ok)),
    publicBookingNote:
      'Public booking page collects card fields but does not send card numbers to the processor API; it only records paymentMethod Card on the reservation.',
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
});
`;

const client = new Client();
client
  .on('ready', () => {
    client.sftp((err, sftp) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      sftp.writeFile('/tmp/test-pp-live.js', remote, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        client.exec('node /tmp/test-pp-live.js && rm -f /tmp/test-pp-live.js', (e, stream) => {
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
