/**
 * Write SMTP app password into VPS data/config.json (preserved across deploys).
 * Usage: node set-smtp.cjs
 * Pass via env SMTP_APP_PASS so it does not sit in shell history as long.
 */
const fs = require('fs');
const path = require('path');
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

const appPass = (process.env.SMTP_APP_PASS || '').trim();
if (!appPass) {
  console.error('Set SMTP_APP_PASS env var');
  process.exit(1);
}

// Remote script receives password as base64 arg to avoid shell escaping issues
const passB64 = Buffer.from(appPass, 'utf8').toString('base64');

const remote = `
const fs = require('fs');
const path = require('path');
const pass = Buffer.from(process.argv[1], 'base64').toString('utf8');
const cfgPath = '/opt/pineflats/data/config.json';
let cfg = {};
if (fs.existsSync(cfgPath)) {
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { cfg = {}; }
}
const contactEmail = (cfg.contact && cfg.contact.email) || 'pineflatsrvpark@hotmail.com';
cfg.smtp = {
  host: 'smtp-mail.outlook.com',
  port: 587,
  secure: false,
  user: 'pineflatsrvpark@hotmail.com',
  pass,
  from: 'Pine Flats RV Park <pineflatsrvpark@hotmail.com>',
  parkNotifyEmail: contactEmail || 'pineflatsrvpark@hotmail.com',
  enabled: true,
};
fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\\n', { mode: 0o600 });
// Confirm without printing password
const check = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
console.log(JSON.stringify({
  ok: true,
  host: check.smtp.host,
  user: check.smtp.user,
  parkNotifyEmail: check.smtp.parkNotifyEmail,
  hasPassword: !!(check.smtp.pass && check.smtp.pass.length > 0),
  passLen: check.smtp.pass ? check.smtp.pass.length : 0,
  enabled: check.smtp.enabled,
}));
// Restart app so email transport reloads
const { execSync } = require('child_process');
try {
  execSync('pm2 restart pineflats --update-env', { encoding: 'utf8', stdio: 'pipe' });
  console.log('pm2 restarted');
} catch (e) {
  console.log('pm2 restart note:', e.message);
}
`;

const client = new Client();
const password = readPw();
client
  .on('ready', () => {
    const b64 = Buffer.from(remote, 'utf8').toString('base64');
    const cmd = `echo '${b64}' | base64 -d > /tmp/set-smtp.js && node /tmp/set-smtp.js '${passB64}' && rm -f /tmp/set-smtp.js`;
    client.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err);
        client.end();
        process.exit(1);
      }
      stream.on('data', (d) => process.stdout.write(d));
      stream.stderr.on('data', (d) => process.stderr.write(d));
      stream.on('close', (code) => {
        client.end();
        process.exit(code || 0);
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
    password,
    tryKeyboard: true,
    readyTimeout: 30000,
  });
