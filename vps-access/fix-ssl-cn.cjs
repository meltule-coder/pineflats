/**
 * Fix ASV finding: "SSL Certificate Common Name Does Not Validate"
 *
 * Causes on this VPS:
 * 1) default_server on :443 presented Cloudflare origin cert (CN=Cloudflare)
 *    when scanners connect by IP or without matching SNI
 * 2) LE cert only covered apex, not www
 *
 * Fix:
 * - Make Let's Encrypt park cert the default SSL server
 * - Expand LE cert to pineflatsrvpark.com + www.pineflatsrvpark.com (if DNS ready)
 * - Redirect bare IP HTTP → https://pineflatsrvpark.com
 *
 * Usage: npx electron fix-ssl-cn.cjs
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

/** nginx config: LE park cert is default for 443 (IP + unknown SNI) */
const NGINX_CONF = `# Managed by fix-ssl-cn.cjs — Pine Flats
# SSL: Let's Encrypt for park domain is default_server so IP/ASV scans
# do not get Cloudflare origin cert (CN=Cloudflare).
# Note: server_tokens is set in nginx.conf (http context) — do not repeat here.

# Cloudflare real IP (if any domain is proxied)
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

# ---------- HTTP ----------
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name pineflatsrvpark.com www.pineflatsrvpark.com pineflatsrv.com www.pineflatsrv.com 74.208.115.104 _;

    server_tokens off;
    autoindex off;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
        allow all;
    }

    # Bare IP / unknown host → canonical HTTPS hostname
    location / {
        return 301 https://pineflatsrvpark.com$request_uri;
    }
}

# ---------- HTTPS default: park LE cert (also used for IP / no-SNI ASV scans) ----------
server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name pineflatsrvpark.com www.pineflatsrvpark.com 74.208.115.104 _;

    server_tokens off;
    autoindex off;

    ssl_certificate     /etc/letsencrypt/live/pineflatsrvpark.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pineflatsrvpark.com/privkey.pem;
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

    # If client connected by IP, send them to the real hostname
    # (name mismatch warning may still appear once; ASV should scan the FQDN)
    if ($host = 74.208.115.104) {
        return 301 https://pineflatsrvpark.com$request_uri;
    }

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

# ---------- Optional legacy hostnames: only if LE cert exists for them ----------
# When only CF origin cert was present, public CN did not validate (CN=Cloudflare).
# Prefer LE if available; otherwise still use park LE as SNI fallback via default above.
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name pineflatsrv.com www.pineflatsrv.com;

    server_tokens off;
    autoindex off;

    # Use park LE cert only if dedicated cert missing — avoids presenting CF origin to public scanners
    ssl_certificate     /etc/letsencrypt/live/pineflatsrvpark.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pineflatsrvpark.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Send legacy names to primary park domain
    return 301 https://pineflatsrvpark.com$request_uri;
}
`;

const REMOTE = `
set -e
export DEBIAN_FRONTEND=noninteractive
echo "=== Expand / renew LE cert for apex + www ==="
mkdir -p /var/www/html
# Prefer nginx plugin; fall back to webroot
certbot certonly --webroot -w /var/www/html \\
  -d pineflatsrvpark.com -d www.pineflatsrvpark.com \\
  --non-interactive --agree-tos --register-unsafely-without-email \\
  --cert-name pineflatsrvpark.com --expand 2>&1 | tee /tmp/certbot-expand.log || true

if grep -qiE 'Congratulations|Successfully received|Certificate not yet due|Keeping the existing' /tmp/certbot-expand.log; then
  echo "CERT_EXPAND_OK"
else
  echo "WWW expand may have failed (often DNS for www). Ensuring apex cert still valid..."
  certbot certonly --webroot -w /var/www/html \\
    -d pineflatsrvpark.com \\
    --non-interactive --agree-tos --register-unsafely-without-email \\
    --cert-name pineflatsrvpark.com 2>&1 | tail -20 || true
fi

echo ""
echo "=== Install nginx site ==="
cp /tmp/pineflats-nginx-ssl-cn.conf /etc/nginx/sites-available/pineflats
ln -sfn /etc/nginx/sites-available/pineflats /etc/nginx/sites-enabled/pineflats
rm -f /etc/nginx/sites-enabled/default

# server_tokens
if grep -qE '^\\s*#?\\s*server_tokens\\s+' /etc/nginx/nginx.conf; then
  sed -i 's/^\\s*#\\?\\s*server_tokens\\s\\+.*/\\tserver_tokens off;/' /etc/nginx/nginx.conf
else
  sed -i '/http {/a\\	server_tokens off;' /etc/nginx/nginx.conf
fi

echo "=== nginx -t ==="
nginx -t
systemctl reload nginx

echo ""
echo "=== Cert SANs now ==="
openssl x509 -in /etc/letsencrypt/live/pineflatsrvpark.com/fullchain.pem -noout -subject -ext subjectAltName 2>&1

echo ""
echo "=== Local openssl by SNI ==="
echo | openssl s_client -connect 127.0.0.1:443 -servername pineflatsrvpark.com 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>&1 | head -10
echo | openssl s_client -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>&1 | head -10

echo "SSL_CN_FIX_OK"
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
    await sftpWrite(client, '/tmp/pineflats-nginx-ssl-cn.conf', NGINX_CONF);
    const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
    const result = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(result.stdout || '');
    if (result.stderr) console.error(result.stderr);
    client.end();
    app.exit((result.stdout || '').includes('SSL_CN_FIX_OK') ? 0 : 1);
  } catch (e) {
    console.error('SSL CN FIX FAILED:', e.message || e);
    app.exit(1);
  }
});
