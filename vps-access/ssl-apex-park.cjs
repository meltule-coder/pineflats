/**
 * Install Let's Encrypt SSL for pineflatsrvpark.com (direct to VPS).
 * Leaves Cloudflare origin cert setup for pineflatsrv.com intact when possible.
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
function sh(cmd, timeout = 180000) {
  console.log('RUN:', cmd);
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout, maxBuffer: 5 * 1024 * 1024 });
    process.stdout.write(out);
    return out;
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || e.message);
    process.stdout.write(out);
    return out;
  }
}

const confPath = '/etc/nginx/sites-available/pineflats';
const existing = fs.existsSync(confPath) ? fs.readFileSync(confPath, 'utf8') : '';
console.log('--- existing conf length', existing.length);

// Install certbot if needed
sh('DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx 2>&1 | tail -n 15');

// Obtain/renew cert for apex only (www DNS currently wrong)
const certOut = sh('certbot certonly --nginx -d pineflatsrvpark.com --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring 2>&1');
const hasCert = fs.existsSync('/etc/letsencrypt/live/pineflatsrvpark.com/fullchain.pem');
console.log('hasCert', hasCert);

if (hasCert) {
  // Write a dual-stack config: HTTP for all, HTTPS with LE for park domain, CF origin for others if present
  const cfCert = '/etc/ssl/cloudflare/pineflats.pem';
  const cfKey = '/etc/ssl/cloudflare/pineflats.key';
  const hasCf = fs.existsSync(cfCert) && fs.existsSync(cfKey);

  let conf = \`# Managed for Pine Flats multi-domain
# HTTP → app (and ACME)
server {
    listen 80;
    listen [::]:80;
    server_name pineflatsrvpark.com www.pineflatsrvpark.com pineflatsrv.com www.pineflatsrv.com 74.208.115.104 _;
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

# HTTPS — Let's Encrypt for GoDaddy apex domain
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name pineflatsrvpark.com;
    ssl_certificate /etc/letsencrypt/live/pineflatsrvpark.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pineflatsrvpark.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    client_max_body_size 50M;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
\`;

  if (hasCf) {
    conf += \`
# HTTPS — Cloudflare origin cert (pineflatsrv.com via CF proxy)
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name pineflatsrv.com www.pineflatsrv.com _;
    ssl_certificate \${cfCert};
    ssl_certificate_key \${cfKey};
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
\`;
  }

  fs.writeFileSync(confPath, conf);
  const test = sh('nginx -t 2>&1');
  console.log(test);
  if (test.includes('successful')) {
    sh('systemctl reload nginx');
  }
}

const results = {
  hasCert,
  local: sh('curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/').trim(),
  httpPark: sh('curl -sS -o /dev/null -w "%{http_code}" -H "Host: pineflatsrvpark.com" http://127.0.0.1/').trim(),
  httpsPark: hasCert ? sh('curl -skS -o /dev/null -w "%{http_code}" https://127.0.0.1/ -H "Host: pineflatsrvpark.com"').trim() : 'no-cert',
  httpsPublic: hasCert ? sh('curl -sS -o /dev/null -w "%{http_code}" https://pineflatsrvpark.com/').trim() : 'no-cert',
};
console.log('RESULT', JSON.stringify(results, null, 2));
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
      `echo '${b64}' | base64 -d > /tmp/ssl-apex-park.js && node /tmp/ssl-apex-park.js`
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
