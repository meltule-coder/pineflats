/**
 * Check nginx + app are wired for park domains on the VPS.
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

const REMOTE = `
const { execSync } = require('child_process');
const fs = require('fs');
function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 15000 }); }
  catch (e) { return (e.stdout || '') + (e.stderr || e.message); }
}
const nginxSites = sh('ls -la /etc/nginx/sites-enabled 2>/dev/null; ls -la /etc/nginx/conf.d 2>/dev/null');
const nginxGrep = sh('grep -RIn "server_name\\\\|proxy_pass\\\\|pineflats" /etc/nginx 2>/dev/null | head -n 80');
const pm2 = sh('pm2 jlist');
let appOnline = false;
try {
  const list = JSON.parse(pm2);
  appOnline = list.some(p => p.name === 'pineflats' && p.pm2_env && p.pm2_env.status === 'online');
} catch {}
const local = sh('curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null || echo fail');
const localAdmin = sh('curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/admin 2>/dev/null || echo fail');
console.log(JSON.stringify({
  appOnline,
  localHome: local.trim(),
  localAdmin: localAdmin.trim(),
  nginxSites: nginxSites.trim().slice(0, 1500),
  nginxGrep: nginxGrep.trim().slice(0, 4000),
}, null, 2));
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
  if (!password) throw new Error('No VPS password');
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
      `echo '${b64}' | base64 -d > /tmp/check-domain-nginx.js && node /tmp/check-domain-nginx.js`
    );
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } finally {
    client.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
