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

const phone = (process.env.PARK_SMS_TO || '').trim();
if (!phone) {
  console.error('Set PARK_SMS_TO');
  process.exit(1);
}

const script = `
const fs = require('fs');
const path = require('path');
const phone = process.argv[2] || process.argv[1];
const cfgPath = '/opt/pineflats/data/config.json';
let cfg = {};
if (fs.existsSync(cfgPath)) {
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { cfg = {}; }
}
const prev = cfg.sms || {};
// Normalize to E.164 US
let alertTo = String(phone).trim();
const digits = alertTo.replace(/\\D/g, '');
if (alertTo.startsWith('+')) {
  alertTo = '+' + alertTo.slice(1).replace(/\\D/g, '');
} else if (digits.length === 10) {
  alertTo = '+1' + digits;
} else if (digits.length === 11 && digits.startsWith('1')) {
  alertTo = '+' + digits;
}
cfg.sms = {
  enabled: prev.enabled !== false,
  alertTo,
  accountSid: prev.accountSid || '',
  authToken: prev.authToken || '',
  fromNumber: prev.fromNumber || '',
};
fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\\n', { mode: 0o600 });
const s = cfg.sms;
const configured = !!(s.enabled && s.alertTo && s.accountSid && s.authToken && s.fromNumber);
console.log(JSON.stringify({
  ok: true,
  alertTo: s.alertTo,
  enabled: s.enabled,
  hasTwilioSid: !!s.accountSid,
  hasAuthToken: !!s.authToken,
  hasFrom: !!s.fromNumber,
  configured,
}));
`;

const client = new Client();
client
  .on('ready', () => {
    client.sftp((err, sftp) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      sftp.writeFile('/tmp/set-sms-phone.js', script, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        // pass phone as arg — safe (digits only after normalize on remote)
        const safe = phone.replace(/[^0-9+]/g, '');
        client.exec(
          `node /tmp/set-sms-phone.js '${safe}' && rm -f /tmp/set-sms-phone.js && pm2 restart pineflats --update-env`,
          (e, stream) => {
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
          }
        );
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
