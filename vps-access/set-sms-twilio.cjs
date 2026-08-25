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

const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const fromNumber = (process.env.TWILIO_FROM || '').trim();

if (!accountSid && !authToken && !fromNumber) {
  console.error('Set at least one of TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM');
  process.exit(1);
}

const script = `
const fs = require('fs');
const path = require('path');
const cfgPath = '/opt/pineflats/data/config.json';
let cfg = {};
if (fs.existsSync(cfgPath)) {
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { cfg = {}; }
}
const prev = cfg.sms || {};
const sid = ${JSON.stringify(accountSid)};
const token = ${JSON.stringify(authToken)};
const from = ${JSON.stringify(fromNumber)};
let fromNorm = (from || prev.fromNumber || '').trim();
if (fromNorm) {
  const digits = fromNorm.replace(/\\D/g, '');
  if (fromNorm.startsWith('+')) fromNorm = '+' + fromNorm.slice(1).replace(/\\D/g, '');
  else if (digits.length === 10) fromNorm = '+1' + digits;
  else if (digits.length === 11 && digits.startsWith('1')) fromNorm = '+' + digits;
}
cfg.sms = {
  enabled: prev.enabled !== false,
  alertTo: prev.alertTo || '',
  accountSid: sid || prev.accountSid || '',
  authToken: token || prev.authToken || '',
  fromNumber: fromNorm || prev.fromNumber || '',
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
  accountSidPrefix: s.accountSid ? s.accountSid.slice(0, 6) + '…' : '',
  hasAuthToken: !!s.authToken,
  hasFrom: !!s.fromNumber,
  fromNumber: s.fromNumber || '',
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
      sftp.writeFile('/tmp/set-sms-twilio.js', script, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        client.exec(
          `node /tmp/set-sms-twilio.js && rm -f /tmp/set-sms-twilio.js && pm2 restart pineflats --update-env`,
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
