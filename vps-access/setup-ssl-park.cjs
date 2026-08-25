/**
 * Request Let's Encrypt cert for pineflatsrvpark.com and wire nginx.
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const password = process.env.VPS_PW;
if (!password) {
  console.error('Set VPS_PW');
  process.exit(1);
}

const remoteScript = `#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive

if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq certbot
fi

mkdir -p /var/www/html

# HTTP-01 webroot (nginx already serves /.well-known/acme-challenge/)
certbot certonly --webroot -w /var/www/html \\
  -d pineflatsrvpark.com \\
  --non-interactive --agree-tos --register-unsafely-without-email \\
  --preferred-challenges http

echo "CERT_OK"
ls -la /etc/letsencrypt/live/pineflatsrvpark.com/
`;

const nginxConf = `# Pine Flats — old + new domains
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
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;

# HTTP
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name pineflatsrvpark.com www.pineflatsrvpark.com pineflatsrv.com www.pineflatsrv.com 74.208.115.104 _;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
        allow all;
    }

    # Redirect park domain HTTP -> HTTPS when LE cert exists
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_buffering off;
    }
}

# HTTPS — new GoDaddy domain (Let's Encrypt)
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name pineflatsrvpark.com www.pineflatsrvpark.com;

    ssl_certificate     /etc/letsencrypt/live/pineflatsrvpark.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pineflatsrvpark.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

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
    }
}

# HTTPS — old domain via Cloudflare origin cert
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name pineflatsrv.com www.pineflatsrv.com _;

    ssl_certificate     /etc/ssl/cloudflare/origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare/origin.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

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
    }
}
`;

function execRemote(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
      stream.on('data', (d) => {
        const t = d.toString();
        stdout += t;
        process.stdout.write(t);
      });
      stream.stderr.on('data', (d) => {
        const t = d.toString();
        stderr += t;
        process.stderr.write(t);
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

async function main() {
  const client = new Client();
  await new Promise((resolve, reject) => {
    client
      .on('ready', resolve)
      .on('error', reject)
      .connect({ host: '74.208.115.104', port: 22, username: 'root', password });
  });

  console.log('Running certbot…\n');
  await sftpWrite(client, '/tmp/setup-ssl-park.sh', remoteScript);
  let result = await execRemote(client, 'chmod +x /tmp/setup-ssl-park.sh && bash /tmp/setup-ssl-park.sh');
  if (result.code !== 0 || !result.stdout.includes('CERT_OK')) {
    // Try standalone: briefly stop nginx on 80
    console.log('\nWebroot failed; trying standalone certbot…\n');
    const standalone = `#!/bin/bash
set -e
systemctl stop nginx
certbot certonly --standalone -d pineflatsrvpark.com \\
  --non-interactive --agree-tos --register-unsafely-without-email \\
  --preferred-challenges http || { systemctl start nginx; exit 1; }
systemctl start nginx
echo CERT_OK
ls -la /etc/letsencrypt/live/pineflatsrvpark.com/
`;
    await sftpWrite(client, '/tmp/setup-ssl-standalone.sh', standalone);
    result = await execRemote(client, 'bash /tmp/setup-ssl-standalone.sh');
  }

  if (result.code !== 0 && !fs.existsSync) {
    // check remote cert
  }

  const check = await execRemote(
    client,
    'test -f /etc/letsencrypt/live/pineflatsrvpark.com/fullchain.pem && echo HAS_CERT || echo NO_CERT'
  );
  if (!check.stdout.includes('HAS_CERT')) {
    console.error('\nSSL cert not obtained. Fix DNS (only A -> 74.208.115.104) and retry.');
    client.end();
    process.exit(1);
  }

  console.log('\nWriting nginx config…\n');
  await sftpWrite(client, '/etc/nginx/sites-available/pineflats', nginxConf);
  const nginx = await execRemote(client, 'nginx -t && systemctl reload nginx && echo NGINX_OK');
  if (!nginx.stdout.includes('NGINX_OK')) {
    console.error('nginx reload failed');
    client.end();
    process.exit(1);
  }

  // renew timer
  await execRemote(
    client,
    'systemctl enable certbot.timer 2>/dev/null || true; systemctl start certbot.timer 2>/dev/null || true; echo DONE'
  );

  client.end();
  console.log('\nSSL setup complete for pineflatsrvpark.com');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
