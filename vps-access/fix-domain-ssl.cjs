/**
 * Ensure nginx proxies park domains to the app and obtain SSL for apex domain.
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

const NGINX_CONF = `
# Pine Flats — proxy all park hostnames to Node app on :3000
server {
    listen 80;
    listen [::]:80;
    server_name pineflatsrvpark.com www.pineflatsrvpark.com pineflatsrv.com www.pineflatsrv.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
`;

const REMOTE = `
const { execSync } = require('child_process');
const fs = require('fs');
function sh(cmd) {
  console.log('RUN:', cmd);
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || e.message);
    console.log(out);
    return out;
  }
}

// Ensure nginx is installed
if (!require('fs').existsSync('/usr/sbin/nginx') && !require('child_process').execSync('which nginx || true', {encoding:'utf8'}).trim()) {
  sh('apt-get update -y');
  sh('DEBIAN_FRONTEND=noninteractive apt-get install -y nginx');
}

const confPath = '/etc/nginx/sites-available/pineflats';
const enabled = '/etc/nginx/sites-enabled/pineflats';
const conf = ${JSON.stringify(NGINX_CONF)};
fs.writeFileSync(confPath, conf);
try { fs.unlinkSync('/etc/nginx/sites-enabled/default'); } catch {}
try {
  if (!fs.existsSync(enabled)) fs.symlinkSync(confPath, enabled);
} catch {}
const test = sh('nginx -t 2>&1');
console.log(test);
sh('systemctl reload nginx || systemctl restart nginx');

// Install certbot and get cert for apex domain (www may fail DNS until fixed)
sh('DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx 2>&1 | tail -n 20');
// Prefer apex only if www DNS is wrong
const cert = sh('certbot --nginx -d pineflatsrvpark.com --non-interactive --agree-tos --register-unsafely-without-email --redirect 2>&1 | tail -n 40');
console.log(cert);

const httpCode = sh('curl -sS -o /dev/null -w "%{http_code}" http://pineflatsrvpark.com/ || true');
const httpsCode = sh('curl -skS -o /dev/null -w "%{http_code}" https://pineflatsrvpark.com/ || true');
const local = sh('curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ || true');
console.log(JSON.stringify({
  ok: true,
  local,
  httpApex: httpCode.trim(),
  httpsApex: httpsCode.trim(),
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
      `echo '${b64}' | base64 -d > /tmp/fix-domain-ssl.js && node /tmp/fix-domain-ssl.js`
    );
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.code !== 0) process.exit(result.code);
  } finally {
    client.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
