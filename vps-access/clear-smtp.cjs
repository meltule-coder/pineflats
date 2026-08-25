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

const script = `
const fs = require('fs');
const cfgPath = '/opt/pineflats/data/config.json';
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
const had = !!(cfg.smtp && (cfg.smtp.user || cfg.smtp.pass || cfg.smtp.host));
cfg.smtp = {
  host: '',
  port: 587,
  secure: false,
  user: '',
  pass: '',
  from: '',
  parkNotifyEmail: '',
  enabled: false,
};
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\\n', { mode: 0o600 });
console.log(JSON.stringify({ ok: true, clearedHotmailSmtp: had, smtpEnabled: false }));
`;

const client = new Client();
client
  .on('ready', () => {
    client.sftp((err, sftp) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      sftp.writeFile('/tmp/clear-smtp.js', script, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        client.exec(
          'node /tmp/clear-smtp.js && rm -f /tmp/clear-smtp.js && pm2 restart pineflats --update-env',
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
