/**
 * Verify SSL auto-renewal setup on the VPS (no secrets printed).
 * Usage: npx electron check-ssl-renewal.cjs
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
  } catch (e) {
    console.error('Password decrypt failed:', e.message);
    return '';
  }
  return '';
}

function sshConnect(conn, password) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const pass = password || '';
    const config = {
      host: conn.host,
      port: Number(conn.port) || 22,
      username: conn.username,
      readyTimeout: 45000,
      tryKeyboard: true,
    };
    if (pass) config.password = pass;
    client
      .on('ready', () => resolve(client))
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => pass));
      })
      .on('error', reject)
      .connect(config);
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

const REMOTE = `
set +e
echo "=== HOST ==="
hostname
date -u

echo ""
echo "=== CERTBOT / ACME TOOLS ==="
command -v certbot && certbot --version 2>&1 || echo "certbot: not installed"
command -v certbot-auto >/dev/null 2>&1 && echo "certbot-auto: present" || true
ls /usr/bin/certbot /usr/local/bin/certbot 2>/dev/null
dpkg -l | grep -E 'certbot|python3-certbot|nginx' 2>/dev/null | head -20

echo ""
echo "=== SYSTEMD TIMERS (renewal) ==="
systemctl list-timers --all 2>/dev/null | grep -iE 'certbot|letsencrypt|acme|renew' || echo "No matching timers in list-timers"
systemctl status certbot.timer --no-pager 2>&1 | head -25
systemctl is-enabled certbot.timer 2>&1
systemctl is-active certbot.timer 2>&1
systemctl status certbot.service --no-pager 2>&1 | head -15
ls -la /etc/systemd/system/*certbot* /lib/systemd/system/*certbot* 2>/dev/null

echo ""
echo "=== CRON ==="
ls -la /etc/cron.* 2>/dev/null | head -5
grep -RIn --include='*' -E 'certbot|letsencrypt|acme.sh' /etc/cron.d /etc/cron.daily /etc/cron.hourly /var/spool/cron 2>/dev/null | head -30
crontab -l 2>/dev/null | grep -iE 'certbot|letsencrypt|acme' || echo "root crontab: no certbot lines"

echo ""
echo "=== CERTBOT RENEW DRY-RUN ==="
if command -v certbot >/dev/null 2>&1; then
  certbot renew --dry-run 2>&1 | tail -40
else
  echo "skip dry-run (no certbot)"
fi

echo ""
echo "=== LIVE CERTIFICATES ON DISK ==="
ls -la /etc/letsencrypt/live 2>/dev/null || echo "No /etc/letsencrypt/live"
for d in /etc/letsencrypt/live/*/; do
  [ -d "$d" ] || continue
  name=$(basename "$d")
  echo "--- cert: $name ---"
  if [ -f "$d/fullchain.pem" ]; then
    openssl x509 -in "$d/fullchain.pem" -noout -subject -issuer -dates 2>/dev/null
  fi
done

echo ""
echo "=== NGINX SSL SITE CONFIG (summary) ==="
ls /etc/nginx/sites-enabled 2>/dev/null
grep -RIn --include='*.conf' -E 'ssl_certificate|server_name|listen 443' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -40

echo ""
echo "=== CLOUDFLARE HINT ==="
# If origin has cert only for park domain, pineflatsrv.com may be CF edge only
echo "Checking local openssl connect to 127.0.0.1 if nginx listens..."
ss -tlnp | grep -E ':443|:80' || netstat -tlnp 2>/dev/null | grep -E ':443|:80'

echo ""
echo "=== RENEWAL CONFIG ==="
ls /etc/letsencrypt/renewal 2>/dev/null
for f in /etc/letsencrypt/renewal/*.conf; do
  [ -f "$f" ] || continue
  echo "--- $(basename "$f") ---"
  grep -E '^(cert|archive_dir|renew_before_expiry|authenticator|installer|account)=' "$f" 2>/dev/null
done

echo ""
echo "DONE"
`;

app.whenReady().then(async () => {
  let client;
  try {
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    if (!conn?.host) throw new Error('No saved VPS connection');
    const password = decryptPassword(conn.password);
    if (!password) throw new Error('Could not decrypt VPS password');

    client = await sshConnect(
      { host: conn.host, username: conn.username, port: conn.port },
      password
    );

    const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
    const result = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(result.stdout || '');
    if (result.stderr) console.error(result.stderr);
    app.exit(result.code === 0 || (result.stdout || '').includes('DONE') ? 0 : 1);
  } catch (e) {
    console.error('CHECK FAILED:', e.message || e);
    app.exit(1);
  } finally {
    try {
      client?.end();
    } catch {
      /* ignore */
    }
  }
});

app.on('window-all-closed', (e) => e.preventDefault());
