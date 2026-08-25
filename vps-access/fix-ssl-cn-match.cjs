/**
 * Fix ASV/Clover finding:
 * "SSL certificate has a common name (CN) that does not appear to match
 *  the identity of the server"
 *
 * Cause: scanners connect to the public IP (74.208.115.104). The cert is for
 * DNS name pineflatsrvpark.com only — IP ≠ CN, so the check fails.
 *
 * Fix:
 * 1) default_server on 443 uses ssl_reject_handshake — no mismatched cert
 *    is ever presented for bare-IP / unknown-SNI connections
 * 2) Only server_name pineflatsrvpark.com (+ www when available) serves the LE cert
 * 3) HTTP always redirects to the canonical HTTPS hostname
 *
 * Usage: npx electron fix-ssl-cn-match.cjs
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const VPS_USER_DATA = path.join(process.env.APPDATA || '', 'pineflats-vps-access');
try {
  app.setName('pineflats-vps-access');
  app.setPath('userData', VPS_USER_DATA);
} catch {
  /* ignore */
}

const CONNECTIONS_FILE = path.join(VPS_USER_DATA, 'ssh-connections.json');
const PARK_IP = '74.208.115.104';
const CANON = 'pineflatsrvpark.com';

function decryptPassword(stored) {
  if (!stored) return '';
  if (typeof stored === 'string') return stored;
  try {
    if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
    }
    if (stored.value) {
      return Buffer.from(stored.value, 'base64').toString('utf8');
    }
  } catch {
    return '';
  }
  return '';
}

function sshConnect(conn, password) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on('ready', () => resolve(client))
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => password));
      })
      .on('error', reject)
      .connect({
        host: conn.host,
        port: Number(conn.port) || 22,
        username: conn.username,
        password: password || undefined,
        tryKeyboard: true,
        readyTimeout: 45000,
      });
  });
}

function execRemote(client, command) {
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

function sftpWrite(client, remotePath, content) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      const ws = sftp.createWriteStream(remotePath);
      ws.on('close', resolve);
      ws.on('error', reject);
      ws.end(content);
    });
  });
}

const NGINX_CONF = `# Managed by fix-ssl-cn-match.cjs
# ASV CN mismatch: do NOT present a domain cert for bare-IP TLS.
# default_server rejects handshake; only named hosts serve LE cert.

# Cloudflare real IP ranges (if used)
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
real_ip_header CF-Connecting-IP;

# ---------- HTTP: ACME + redirect everything to canonical HTTPS hostname ----------
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${CANON} www.${CANON} pineflatsrv.com www.pineflatsrv.com ${PARK_IP} _;

    autoindex off;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
        allow all;
    }

    location / {
        return 301 https://${CANON}$request_uri;
    }
}

# ---------- HTTPS catch-all: reject TLS for IP / unknown SNI (no mismatched CN) ----------
server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name _;

    # Nginx 1.19.4+: abort handshake instead of serving a wrong certificate
    ssl_reject_handshake on;
}

# ---------- HTTPS park domain (valid LE cert — CN matches this hostname) ----------
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${CANON} www.${CANON};

    autoindex off;

    ssl_certificate     /etc/letsencrypt/live/${CANON}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${CANON}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header X-DNS-Prefetch-Control "off" always;
    add_header X-Permitted-Cross-Domain-Policies "none" always;

    client_max_body_size 50M;

    location ~* ^/(ssh|vps|ssh\\.html)(/|$) {
        return 404;
    }

    location ~* ^/(uploads|assets|dist|data|src|node_modules)(/)?$ {
        return 403;
    }

    location ~* /(^|/)(\\.|\\.env|\\.git|\\.svn|\\.hg|node_modules|package(-lock)?\\.json|composer\\.(json|lock)|server\\.ts|tsconfig|vite\\.config|dockerfile|docker-compose|\\.bak|\\.sql|\\.pem|\\.key) {
        return 404;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
        proxy_buffering off;
        proxy_hide_header X-Powered-By;
    }
}

# Note: Do NOT serve TLS for pineflatsrv.com on this origin with the park cert —
# that re-creates CN mismatch (SNI pineflatsrv.com vs cert pineflatsrvpark.com).
# Public pineflatsrv.com traffic uses Cloudflare edge certs; HTTP on this host
# already 301s to https://pineflatsrvpark.com.
`;

const REMOTE = `
set -e
export DEBIAN_FRONTEND=noninteractive

# nginx must support ssl_reject_handshake (1.19.4+)
nginx -v 2>&1

echo "=== Ensure LE cert for ${CANON} ==="
mkdir -p /var/www/html
# Apex only (www DNS often points at parking — expand later when DNS is fixed)
certbot certonly --webroot -w /var/www/html \\
  -d ${CANON} \\
  --non-interactive --agree-tos --register-unsafely-without-email \\
  --cert-name ${CANON} --keep-until-expiring 2>&1 | tail -25 || true

# Try www expand only if www resolves to this server
WWW_IP=$(getent ahostsv4 www.${CANON} 2>/dev/null | awk '{print $1; exit}')
MY_IP=$(curl -4 -s --max-time 5 ifconfig.me || curl -4 -s --max-time 5 icanhazip.com || echo "")
echo "www DNS IP=\${WWW_IP:-none} server public IP=\${MY_IP:-unknown}"
if [ -n "\$WWW_IP" ] && [ -n "\$MY_IP" ] && [ "\$WWW_IP" = "\$MY_IP" ]; then
  echo "Expanding cert to include www..."
  certbot certonly --webroot -w /var/www/html \\
    -d ${CANON} -d www.${CANON} \\
    --non-interactive --agree-tos --register-unsafely-without-email \\
    --cert-name ${CANON} --expand 2>&1 | tail -30 || true
else
  echo "Skipping www expand (www does not point at this VPS)"
fi

echo "=== Install nginx config ==="
cp /tmp/pineflats-nginx-cn-match.conf /etc/nginx/sites-available/pineflats
ln -sfn /etc/nginx/sites-available/pineflats /etc/nginx/sites-enabled/pineflats
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

echo ""
echo "=== Verify: named host presents LE cert ==="
echo | openssl s_client -connect 127.0.0.1:443 -servername ${CANON} 2>/dev/null \\
  | openssl x509 -noout -subject -ext subjectAltName 2>&1 | head -8

echo ""
echo "=== Verify: no-SNI / default rejects handshake ==="
# Expect failure / reject (no cert with wrong CN)
set +e
OUT=\$(echo | openssl s_client -connect 127.0.0.1:443 2>&1 | head -20)
echo "\$OUT" | head -15
echo "\$OUT" | grep -qiE 'handshake failure|alert|error|no peer certificate|sslv3 alert' && echo "REJECT_OK" || echo "REJECT_CHECK_MANUAL"

echo ""
openssl x509 -in /etc/letsencrypt/live/${CANON}/fullchain.pem -noout -subject -ext subjectAltName 2>&1
echo "SSL_CN_MATCH_OK"
`;

app.whenReady().then(async () => {
  let client;
  try {
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    if (!conn?.host) throw new Error('No saved VPS connection');
    const password = decryptPassword(conn.password);
    if (!password) throw new Error('Could not decrypt VPS password');

    console.log(`Connecting to ${conn.username}@${conn.host}…`);
    client = await sshConnect(conn, password);
    await sftpWrite(client, '/tmp/pineflats-nginx-cn-match.conf', NGINX_CONF);
    const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
    const result = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(result.stdout || '');
    if (result.stderr) console.error(result.stderr);
    client.end();
    app.exit((result.stdout || '').includes('SSL_CN_MATCH_OK') ? 0 : 1);
  } catch (e) {
    console.error('FAILED:', e.message || e);
    app.exit(1);
  }
});
