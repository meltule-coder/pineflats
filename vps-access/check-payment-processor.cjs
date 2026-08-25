const fs = require('fs');
const { Client } = require('ssh2');
const https = require('https');

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
    const req = https.get(url, { timeout: 15000, rejectUnauthorized: true }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        resolve({ status: res.statusCode, body });
      });
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
const path = '/opt/pineflats/data';
const cfgPath = path + '/payment-processor.json';
const secPath = path + '/payment-processor-secrets.json';
let cfg = null;
let secrets = null;
if (fs.existsSync(cfgPath)) {
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { cfg = { parseError: String(e.message) }; }
}
if (fs.existsSync(secPath)) {
  try {
    const s = JSON.parse(fs.readFileSync(secPath, 'utf8'));
    secrets = {
      hasSecretKey: !!(s.secretKey && String(s.secretKey).trim()),
      secretKeyLen: s.secretKey ? String(s.secretKey).length : 0,
      hasWebhookSecret: !!(s.webhookSecret && String(s.webhookSecret).trim()),
    };
  } catch (e) {
    secrets = { parseError: String(e.message) };
  }
}
const env = {
  PAYMENT_PROCESSOR_PROVIDER: process.env.PAYMENT_PROCESSOR_PROVIDER || '',
  hasSecretEnv: !!(process.env.PAYMENT_PROCESSOR_SECRET_KEY || '').trim(),
  hasWebhookEnv: !!(process.env.PAYMENT_PROCESSOR_WEBHOOK_SECRET || '').trim(),
};
console.log(JSON.stringify({ cfg, secrets, env, files: {
  configExists: fs.existsSync(cfgPath),
  secretsExists: fs.existsSync(secPath),
}}, null, 2));
`;

async function main() {
  // Public site endpoints
  const urls = [
    'https://pineflatsrvpark.com/api/payment-processor',
    'https://pineflatsrvpark.com/api/payment-processor/status',
    'https://pineflatsrvpark.com/api/health',
  ];
  console.log('=== Public HTTPS checks ===');
  for (const url of urls) {
    const r = await httpGet(url);
    console.log(url, '→', r.status);
    console.log(r.body.slice(0, 800));
    console.log('---');
  }

  console.log('=== VPS data files ===');
  const client = new Client();
  await new Promise((resolve, reject) => {
    client
      .on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.writeFile('/tmp/check-pp.js', remote, (w) => {
            if (w) return reject(w);
            client.exec(
              'cd /opt/pineflats && node /tmp/check-pp.js && rm -f /tmp/check-pp.js',
              (e, stream) => {
                if (e) return reject(e);
                stream.on('data', (d) => process.stdout.write(d));
                stream.stderr.on('data', (d) => process.stderr.write(d));
                stream.on('close', (code) => {
                  client.end();
                  resolve(code);
                });
              }
            );
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
