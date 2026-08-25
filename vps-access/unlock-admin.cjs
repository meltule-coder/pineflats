/**
 * Emergency: reset admin password + set recovery email on VPS.
 * Usage: node unlock-admin.cjs
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

function readPw() {
  const p = path.join('C:/Users/IT101/Desktop', 'Grok.txt');
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) {
      return lines[i + 1].trim();
    }
  }
  return null;
}

// Temporary unlock password — change after login via Change password
const NEW_ADMIN_PASSWORD = 'PineFlatsTemp2026!';
const RECOVERY_EMAIL = 'pineflatsrvpark@hotmail.com';

const REMOTE = `
const fs = require('fs');
const p = '/opt/pineflats/data/config.json';
const cfg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
cfg.adminPassword = ${JSON.stringify(NEW_ADMIN_PASSWORD)};
cfg.adminRecoveryEmail = ${JSON.stringify(RECOVERY_EMAIL)};
delete cfg.adminRecoveryCodeHash;
delete cfg.adminRecoveryCodeExpires;
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
// Clear env override if present so config password is used after restart
const envPath = '/opt/pineflats/.env.local';
if (fs.existsSync(envPath)) {
  let env = fs.readFileSync(envPath, 'utf8');
  if (/^ADMIN_PASSWORD=/m.test(env)) {
    env = env.replace(/^ADMIN_PASSWORD=.*$/m, '# ADMIN_PASSWORD= (cleared — use config adminPassword)');
    fs.writeFileSync(envPath, env);
  }
}
console.log(JSON.stringify({
  ok: true,
  recoveryEmail: cfg.adminRecoveryEmail,
  passwordSet: true,
  passwordLength: String(cfg.adminPassword).length,
}));
`;

function sshExec(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
        .on('data', (d) => {
          stdout += d.toString();
        });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
      });
    });
  });
}

async function main() {
  const password = readPw();
  if (!password) {
    console.error('No VPS password');
    process.exit(1);
  }
  const client = new Client();
  await new Promise((resolve, reject) => {
    client
      .on('ready', resolve)
      .on('error', reject)
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => password));
      })
      .connect({
        host: '74.208.115.104',
        port: 22,
        username: 'root',
        password,
        readyTimeout: 30000,
        tryKeyboard: true,
      });
  });

  try {
    const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
    const result = await sshExec(
      client,
      `echo '${b64}' | base64 -d > /tmp/unlock-admin.js && node /tmp/unlock-admin.js && pm2 restart pineflats`
    );
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    console.log('\nUNLOCK_OK');
    console.log('Temp password set. Sign in at /admin then change it.');
  } finally {
    client.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
