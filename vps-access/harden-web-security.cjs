/**
 * Harden website security on the VPS for scanner findings:
 * - Force HTTP → HTTPS
 * - Security headers (HSTS, nosniff, frame options, referrer, permissions)
 * - Hide nginx version (server_tokens off)
 * - Hide X-Powered-By from upstream
 * - Ensure app only needed via nginx (firewall tip for 3000)
 *
 * Usage: npx electron harden-web-security.cjs
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

const NGINX_CONF = `# Managed by harden-web-security.cjs — Pine Flats
# Security: HTTPS redirect, HSTS, nosniff, hide version leakage, loopback proxy only

# Cloudflare real IP ranges (keep if CF is used on any domain)
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

# ---------- HTTP: ACME + force HTTPS ----------
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name pineflatsrvpark.com www.pineflatsrvpark.com pineflatsrv.com www.pineflatsrv.com 74.208.115.104 _;

    # Hide nginx version on this vhost responses too
    server_tokens off;
    autoindex off;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
        allow all;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# Shared proxy to app (loopback only)
# Directory listing is disabled; remote-access web UI paths are blocked.

# ---------- HTTPS: GoDaddy park domain (Let's Encrypt) ----------
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name pineflatsrvpark.com www.pineflatsrvpark.com;

    server_tokens off;
    autoindex off;

    ssl_certificate     /etc/letsencrypt/live/pineflatsrvpark.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pineflatsrvpark.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers (always = also on error responses)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header X-DNS-Prefetch-Control "off" always;
    add_header X-Permitted-Cross-Domain-Policies "none" always;

    client_max_body_size 50M;

    # No public remote-access web UIs (ASV finding)
    location ~* ^/(ssh|vps|ssh\\.html)(/|$) {
        return 404;
    }

    # Directory browsing disabled — reject bare directory URLs for uploads/static trees
    location ~* ^/(uploads|assets|dist|data|src|node_modules)(/)?$ {
        return 403;
    }
    location ~* ^/(uploads|assets|dist|data|src|node_modules)/$ {
        return 403;
    }

    # Block secret / VCS probes at the edge
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

# ---------- HTTPS: legacy Cloudflare domain (origin cert if present) ----------
server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name pineflatsrv.com www.pineflatsrv.com _;

    server_tokens off;
    autoindex off;

    ssl_certificate     /etc/ssl/cloudflare/origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare/origin.key;
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
    location ~* ^/(uploads|assets|dist|data|src|node_modules)/$ {
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
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
        proxy_read_timeout 120s;
        proxy_buffering off;
        proxy_hide_header X-Powered-By;
    }
}
`;

const REMOTE_APPLY = `
set -e
export DEBIAN_FRONTEND=noninteractive

echo "=== Backup current nginx site ==="
cp -a /etc/nginx/sites-available/pineflats /etc/nginx/sites-available/pineflats.bak.$(date +%Y%m%d%H%M%S) 2>/dev/null || true

echo "=== Install new site config ==="
cp /tmp/pineflats-nginx-secure.conf /etc/nginx/sites-available/pineflats
ln -sfn /etc/nginx/sites-available/pineflats /etc/nginx/sites-enabled/pineflats
rm -f /etc/nginx/sites-enabled/default

echo "=== server_tokens off in nginx.conf ==="
if grep -qE '^\\s*#?\\s*server_tokens\\s+' /etc/nginx/nginx.conf; then
  sed -i 's/^\\s*#\\?\\s*server_tokens\\s\\+.*/\\tserver_tokens off;/' /etc/nginx/nginx.conf
else
  sed -i '/http {/a\\	server_tokens off;' /etc/nginx/nginx.conf
fi
grep -n server_tokens /etc/nginx/nginx.conf || true

# Origin cert may not exist — make legacy HTTPS block optional by swapping cert if missing
if [ ! -f /etc/ssl/cloudflare/origin.pem ] || [ ! -f /etc/ssl/cloudflare/origin.key ]; then
  echo "Cloudflare origin cert missing — using LE cert for default HTTPS block"
  if [ -f /etc/letsencrypt/live/pineflatsrvpark.com/fullchain.pem ]; then
    sed -i 's|/etc/ssl/cloudflare/origin.pem|/etc/letsencrypt/live/pineflatsrvpark.com/fullchain.pem|' /etc/nginx/sites-available/pineflats
    sed -i 's|/etc/ssl/cloudflare/origin.key|/etc/letsencrypt/live/pineflatsrvpark.com/privkey.pem|' /etc/nginx/sites-available/pineflats
  fi
fi

# If www is not on the LE cert, still try — nginx will start; certbot expand optional
echo "=== nginx -t ==="
nginx -t

echo "=== reload nginx ==="
systemctl reload nginx

# Close public access to Node if ufw is active (nginx is the only public entry)
if command -v ufw >/dev/null 2>&1; then
  if ufw status 2>/dev/null | grep -qi 'Status: active'; then
    echo "=== ufw: deny public 3000 ==="
    ufw deny 3000/tcp || true
    ufw status numbered | head -40
  else
    echo "ufw not active — skipping firewall rule for 3000"
  fi
fi

# iptables fallback hint (do not force if custom rules exist)
echo "=== listeners after harden ==="
ss -lntp | grep -E ':80|:443|:3000|:22' || true

echo "HARDEN_OK"
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

    await sftpWrite(client, '/tmp/pineflats-nginx-secure.conf', NGINX_CONF);
    const b64 = Buffer.from(REMOTE_APPLY, 'utf8').toString('base64');
    const result = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(result.stdout || '');
    if (result.stderr) console.error(result.stderr);
    client.end();
    app.exit((result.stdout || '').includes('HARDEN_OK') ? 0 : 1);
  } catch (e) {
    console.error('HARDEN FAILED:', e.message || e);
    app.exit(1);
  }
});
