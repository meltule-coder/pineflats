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

const appPass = (process.env.SMTP_APP_PASS || '').trim().replace(/\s+/g, '');
if (!appPass) {
  console.error('Set SMTP_APP_PASS');
  process.exit(1);
}

const setupJs = `
const fs = require('fs');
const path = require('path');
const pass = fs.readFileSync('/tmp/smtp-app-pass.txt', 'utf8').trim().replace(/\\s+/g, '');
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
try { fs.unlinkSync('/tmp/smtp-app-pass.txt'); } catch {}
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
const { execSync } = require('child_process');
execSync('pm2 restart pineflats --update-env', { encoding: 'utf8' });
console.log('pm2 restarted');
`;

const client = new Client();
client
  .on('ready', () => {
    client.sftp((err, sftp) => {
      if (err) {
        console.error(err);
        client.end();
        process.exit(1);
      }
      sftp.writeFile('/tmp/smtp-app-pass.txt', appPass, { mode: 0o600 }, (wErr) => {
        if (wErr) {
          console.error(wErr);
          client.end();
          process.exit(1);
        }
        sftp.writeFile('/tmp/set-smtp.js', setupJs, (w2) => {
          if (w2) {
            console.error(w2);
            client.end();
            process.exit(1);
          }
          client.exec('node /tmp/set-smtp.js && rm -f /tmp/set-smtp.js /tmp/smtp-app-pass.txt', (e, stream) => {
            if (e) {
              console.error(e);
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
