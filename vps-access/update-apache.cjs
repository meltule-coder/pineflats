/**
 * Check/update Apache HTTP Server on the Pine Flats VPS.
 * Usage: npx electron update-apache.cjs
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
    client
      .on('ready', () => resolve(client))
      .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => pass));
      })
      .on('error', reject)
      .connect({
        host: conn.host,
        port: Number(conn.port) || 22,
        username: conn.username,
        password: pass || undefined,
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

const REMOTE = `
set +e
export DEBIAN_FRONTEND=noninteractive
echo "=== HOST ==="
hostname
date -u

echo ""
echo "=== WEB SERVER PACKAGES (before) ==="
dpkg -l | grep -iE 'apache2|httpd|nginx' || echo "none matching"
command -v apache2 && apache2 -v 2>&1
command -v httpd && httpd -v 2>&1
command -v nginx && nginx -v 2>&1
systemctl is-active apache2 2>/dev/null; systemctl is-enabled apache2 2>/dev/null
systemctl is-active nginx 2>/dev/null; systemctl is-enabled nginx 2>/dev/null

# Fix broken nodesource repo if it blocks apt
if [ -f /etc/apt/sources.list.d/nodesource.list ]; then
  echo "Disabling broken nodesource.list for apt update"
  mv /etc/apt/sources.list.d/nodesource.list /etc/apt/sources.list.d/nodesource.list.disabled 2>/dev/null || true
fi
# also any disabled leftover
ls /etc/apt/sources.list.d/ 2>/dev/null

echo ""
echo "=== APT UPDATE ==="
apt-get update -qq 2>&1 | tail -20
UPD_RC=$?
echo "apt_update_exit=$UPD_RC"

echo ""
echo "=== APACHE INSTALLED? ==="
if dpkg -l apache2 2>/dev/null | grep -q '^ii'; then
  echo "apache2_installed=yes"
  echo "BEFORE:"
  dpkg -l apache2 apache2-bin apache2-data apache2-utils 2>/dev/null | grep '^ii'
  apache2 -v 2>&1
  echo ""
  echo "=== UPGRADING APACHE ==="
  apt-get install -y --only-upgrade apache2 apache2-bin apache2-data apache2-utils libapache2-mod-php* 2>&1 | tail -40
  echo "AFTER:"
  dpkg -l apache2 apache2-bin apache2-data apache2-utils 2>/dev/null | grep '^ii'
  apache2 -v 2>&1
  systemctl reload apache2 2>/dev/null || systemctl restart apache2 2>/dev/null || true
  systemctl is-active apache2 2>/dev/null
  echo "APACHE_UPDATE_DONE"
elif dpkg -l httpd 2>/dev/null | grep -q '^ii'; then
  echo "httpd_installed=yes"
  apt-get install -y --only-upgrade httpd httpd-tools 2>&1 | tail -30
  httpd -v 2>&1
  echo "HTTPD_UPDATE_DONE"
else
  echo "apache2_installed=no"
  echo "NOTE: This VPS serves Pine Flats with nginx, not Apache."
  echo "=== UPGRADING NGINX (active web server) ==="
  if dpkg -l nginx 2>/dev/null | grep -q '^ii'; then
    echo "BEFORE:"
    dpkg -l 'nginx*' 2>/dev/null | grep '^ii'
    nginx -v 2>&1
    apt-get install -y --only-upgrade nginx nginx-common nginx-core 2>&1 | tail -40
    echo "AFTER:"
    dpkg -l 'nginx*' 2>/dev/null | grep '^ii'
    nginx -v 2>&1
    nginx -t 2>&1
    systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
    systemctl is-active nginx 2>/dev/null
    echo "NGINX_UPDATE_DONE"
  else
    echo "nginx_installed=no"
  fi
fi

echo ""
echo "=== SECURITY UPDATES (optional related) ==="
apt-get install -y --only-upgrade openssl libssl3t64 libssl3 2>&1 | tail -15

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

    console.log(`Connecting to ${conn.username}@${conn.host}…`);
    client = await sshConnect(conn, password);

    const b64 = Buffer.from(REMOTE, 'utf8').toString('base64');
    const result = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(result.stdout || '');
    if (result.stderr) console.error(result.stderr);
    app.exit((result.stdout || '').includes('DONE') ? 0 : 1);
  } catch (e) {
    console.error('UPDATE FAILED:', e.message || e);
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
