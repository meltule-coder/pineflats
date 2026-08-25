const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

function readPw() {
  const p = path.join('C:/Users/IT101/Desktop', 'Grok.txt');
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) {
      return lines[i + 1].trim();
    }
  }
  throw new Error('no pw');
}

const remote = `
const fs = require('fs');
const path = require('path');
const dir = '/opt/pineflats';
function redact(line) {
  return line
    .replace(/(PASS|PASSWORD|SECRET|KEY)=.*/i, '$1=***')
    .replace(/(smtp_pass|SMTP_PASS)=.*/i, 'SMTP_PASS=***');
}
for (const f of ['.env.local', '.env', '.env.production']) {
  const p = path.join(dir, f);
  console.log('---', f, fs.existsSync(p) ? 'exists' : 'missing');
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p, 'utf8').split(/\\n/);
  for (const line of lines) {
    if (/SMTP_|PARK_|MAIL|FROM/i.test(line) && !/^\\s*#/.test(line)) {
      console.log(redact(line.trim()));
    }
  }
}
// contact email from config
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'data/config.json'), 'utf8'));
  console.log('contact.email=', cfg.contact && cfg.contact.email);
} catch (e) {
  console.log('config error', e.message);
}
// pm2 env peek
const { execSync } = require('child_process');
try {
  const j = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
  const app = j.find(p => p.name === 'pineflats');
  if (app && app.pm2_env) {
    const e = app.pm2_env;
    console.log('pm2 SMTP_HOST=', e.SMTP_HOST || '(not in pm2 env)');
    console.log('pm2 SMTP_USER=', e.SMTP_USER || '(not in pm2 env)');
    console.log('pm2 PARK_NOTIFY_EMAIL=', e.PARK_NOTIFY_EMAIL || '(not in pm2 env)');
    console.log('pm2 has SMTP_PASS=', e.SMTP_PASS ? 'yes' : 'no');
  }
} catch (e) {
  console.log('pm2', e.message);
}
`;

const password = readPw();
const client = new Client();
client
  .on('ready', () => {
    const b64 = Buffer.from(remote, 'utf8').toString('base64');
    client.exec(
      `echo '${b64}' | base64 -d > /tmp/check-smtp.js && node /tmp/check-smtp.js`,
      (err, stream) => {
        if (err) {
          console.error(err);
          client.end();
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
  })
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({
    host: '74.208.115.104',
    username: 'root',
    password,
    readyTimeout: 30000,
    tryKeyboard: true,
  });
