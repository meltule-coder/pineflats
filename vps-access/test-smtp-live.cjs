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
const nodemailer = require('nodemailer');
const cfg = JSON.parse(fs.readFileSync('/opt/pineflats/data/config.json', 'utf8'));
const s = cfg.smtp;
if (!s || !s.pass) {
  console.log(JSON.stringify({ ok: false, error: 'no smtp config' }));
  process.exit(1);
}
const t = nodemailer.createTransport({
  host: s.host,
  port: s.port,
  secure: !!s.secure,
  auth: { user: s.user, pass: s.pass },
});
t.sendMail({
  from: s.from || s.user,
  to: s.parkNotifyEmail || s.user,
  subject: 'Pine Flats SMTP live test',
  text:
    'SMTP is configured and working. Receipt emails can be sent when customers pay.\\n' +
    new Date().toISOString(),
})
  .then((info) => {
    console.log(
      JSON.stringify({
        ok: true,
        messageId: info.messageId,
        to: s.parkNotifyEmail || s.user,
        host: s.host,
        user: s.user,
      })
    );
    process.exit(0);
  })
  .catch((err) => {
    console.log(
      JSON.stringify({
        ok: false,
        error: err.message,
        code: err.code,
        response: err.response,
        responseCode: err.responseCode,
      })
    );
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
      sftp.writeFile('/tmp/smtp-test.js', script, (w) => {
        if (w) {
          console.error(w);
          process.exit(1);
        }
        client.exec(
          'cd /opt/pineflats && NODE_PATH=/opt/pineflats/node_modules node /tmp/smtp-test.js; rm -f /tmp/smtp-test.js',
          (e, stream) => {
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
    readyTimeout: 45000,
  });
