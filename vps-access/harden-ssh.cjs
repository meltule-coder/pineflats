/**
 * Inspect + harden OpenSSH (sshd) on the Pine Flats VPS.
 * Safe defaults that keep password login working (root password is how this app deploys).
 * Usage: npx electron harden-ssh.cjs
 *        npx electron harden-ssh.cjs --apply
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

const APPLY = process.argv.includes('--apply');

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

// Build cipher names without embedding @-strings that some tooling rewrites
const OSSH = '@' + 'openssh.com';
const LIBSSH = '@' + 'libssh.org';
const HARDEN_CONF_FIXED = [
  '# Pine Flats SSH hardening — managed by harden-ssh.cjs',
  '# Applied: ' + new Date().toISOString(),
  '',
  'Protocol 2',
  'Port 22',
  '',
  '# Password kept enabled: no root authorized_keys yet; VPS Access deploy uses password.',
  '# After adding an SSH key for root, set PasswordAuthentication no and PermitRootLogin prohibit-password.',
  'PermitRootLogin yes',
  'PasswordAuthentication yes',
  'KbdInteractiveAuthentication no',
  'ChallengeResponseAuthentication no',
  'PubkeyAuthentication yes',
  'PermitEmptyPasswords no',
  'MaxAuthTries 3',
  'LoginGraceTime 30',
  'MaxSessions 5',
  'MaxStartups 10:30:20',
  '',
  'X11Forwarding no',
  'AllowTcpForwarding no',
  'AllowAgentForwarding no',
  'GatewayPorts no',
  'PermitTunnel no',
  'PermitUserEnvironment no',
  'DebianBanner no',
  'PrintMotd no',
  '',
  'ClientAliveInterval 300',
  'ClientAliveCountMax 2',
  'TCPKeepAlive yes',
  '',
  'SyslogFacility AUTH',
  'LogLevel VERBOSE',
  '',
  'KexAlgorithms curve25519-sha256,curve25519-sha256' + LIBSSH + ',diffie-hellman-group16-sha512,diffie-hellman-group18-sha512,diffie-hellman-group-exchange-sha256',
  'Ciphers chacha20-poly1305' + OSSH + ',aes256-gcm' + OSSH + ',aes128-gcm' + OSSH + ',aes256-ctr,aes192-ctr,aes128-ctr',
  'MACs hmac-sha2-512-etm' + OSSH + ',hmac-sha2-256-etm' + OSSH + ',hmac-sha2-512,hmac-sha2-256',
  'HostKeyAlgorithms ssh-ed25519,ecdsa-sha2-nistp256,rsa-sha2-512,rsa-sha2-256',
  'PubkeyAcceptedAlgorithms ssh-ed25519,ecdsa-sha2-nistp256,rsa-sha2-512,rsa-sha2-256',
  '',
].join('\n');

const INSPECT = `
set +e
echo "=== sshd status ==="
systemctl is-active ssh 2>/dev/null; systemctl is-active sshd 2>/dev/null
systemctl is-enabled ssh 2>/dev/null; systemctl is-enabled sshd 2>/dev/null
echo "=== files ==="
ls -la /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>/dev/null
echo "=== effective (sshd -T) ==="
sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|challengeresponseauthentication|permitemptypasswords|x11forwarding|allowtcpforwarding|allowagentforwarding|maxauthtries|logingracetime|clientaliveinterval|clientalivecountmax|maxsessions|maxstartups|gatewayports|permittunnel|permituserenvironment|loglevel)='
echo "=== authorized_keys ==="
if [ -f /root/.ssh/authorized_keys ]; then
  echo "lines=$(wc -l < /root/.ssh/authorized_keys)"
  echo "keys=$(grep -cE '^(ssh-|ecdsa-)' /root/.ssh/authorized_keys 2>/dev/null || echo 0)"
else
  echo "lines=0 keys=0"
fi
echo "=== fail2ban ==="
dpkg -l fail2ban 2>/dev/null | grep -E '^ii' || echo "fail2ban_pkg=missing"
systemctl is-active fail2ban 2>/dev/null || echo "fail2ban_inactive"
fail2ban-client status sshd 2>/dev/null || fail2ban-client status 2>/dev/null | head -20
echo "=== listen ==="
ss -tlnp | grep -E ':22\\s' || true
echo "=== ufw ==="
ufw status 2>/dev/null | head -15 || echo "ufw n/a"
echo INSPECT_DONE
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

    console.log('\n========== BEFORE ==========');
    let r = await execRemote(client, INSPECT);
    console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);

    if (!APPLY) {
      console.log('\nDry-run only. Re-run with --apply to write hardening config + install fail2ban.');
      app.exit(0);
      return;
    }

    console.log('\n========== APPLYING HARDENING ==========');

    // Upload hardening conf via base64
    const confB64 = Buffer.from(HARDEN_CONF_FIXED, 'utf8').toString('base64');
    const applyScript = `
set -e
export DEBIAN_FRONTEND=noninteractive

# Backup existing config
TS=$(date +%Y%m%d-%H%M%S)
cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$TS
mkdir -p /etc/ssh/sshd_config.d
if [ -d /etc/ssh/sshd_config.d ]; then
  cp -a /etc/ssh/sshd_config.d /etc/ssh/sshd_config.d.bak.$TS 2>/dev/null || true
fi

# Write drop-in (99- so it wins over cloud defaults)
echo '${confB64}' | base64 -d > /etc/ssh/sshd_config.d/99-pineflats-hardening.conf
chmod 644 /etc/ssh/sshd_config.d/99-pineflats-hardening.conf

# Ensure main config includes drop-ins (Ubuntu default does)
if ! grep -qE '^Include /etc/ssh/sshd_config.d/\\*.conf' /etc/ssh/sshd_config; then
  if ! grep -qE '^Include .*/sshd_config.d' /etc/ssh/sshd_config; then
    sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
  fi
fi

# Soften conflicting weaker settings in other drop-ins by commenting PasswordAuthentication no if we need password
# (we keep password yes for deploy tools)

# Host keys: keep modern ones, disable weak DSA if any
if [ -f /etc/ssh/ssh_host_dsa_key ]; then
  grep -q 'HostKey /etc/ssh/ssh_host_dsa_key' /etc/ssh/sshd_config && \\
    sed -i 's|^HostKey /etc/ssh/ssh_host_dsa_key|# HostKey /etc/ssh/ssh_host_dsa_key|' /etc/ssh/sshd_config || true
fi

# Validate sshd config before applying service reload
if ! sshd -t 2>/tmp/sshd-t.err; then
  echo "sshd -t failed:"
  cat /tmp/sshd-t.err
  # Roll back drop-in
  rm -f /etc/ssh/sshd_config.d/99-pineflats-hardening.conf
  exit 1
fi

# Reload ssh (prefer reload to keep session)
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || systemctl restart sshd
echo "sshd reloaded"

# Install fail2ban without letting broken third-party apt repos block us
if ! command -v fail2ban-client >/dev/null 2>&1; then
  # Disable broken nodesource list if present (403 Forbidden)
  if [ -f /etc/apt/sources.list.d/nodesource.list ]; then
    mv /etc/apt/sources.list.d/nodesource.list /etc/apt/sources.list.d/nodesource.list.disabled 2>/dev/null || true
  fi
  apt-get update -qq || true
  apt-get install -y fail2ban || echo "WARN: fail2ban install failed"
fi
if command -v fail2ban-client >/dev/null 2>&1; then
  mkdir -p /etc/fail2ban/jail.d
  cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
findtime = 10m
bantime = 1h
backend = systemd
EOF
  systemctl enable fail2ban
  systemctl restart fail2ban
  echo "fail2ban enabled for sshd"
else
  echo "WARN: fail2ban not available"
fi

# Optional: ensure ufw allows SSH if ufw active
if command -v ufw >/dev/null 2>&1; then
  if ufw status 2>/dev/null | grep -qi 'Status: active'; then
    ufw allow OpenSSH 2>/dev/null || ufw allow 22/tcp 2>/dev/null || true
  fi
fi

echo APPLY_OK
`;

    r = await execRemote(client, applyScript);
    console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);
    if (!r.stdout.includes('APPLY_OK') && r.code !== 0) {
      throw new Error(`Apply failed (exit ${r.code})`);
    }

    // Verify we can still open a new SSH session (critical!)
    console.log('\n========== VERIFY NEW SESSION ==========');
    client.end();
    client = await sshConnect(conn, password);
    console.log('Reconnected successfully after hardening.');

    console.log('\n========== AFTER ==========');
    r = await execRemote(client, INSPECT);
    console.log(r.stdout);

    console.log('\nHardening applied successfully.');
    console.log('NOTE: PasswordAuthentication remains YES so VPS Access deploy keeps working.');
    console.log('When you add an SSH public key for root, re-run with key-only mode or set PasswordAuthentication no.');
    app.exit(0);
  } catch (e) {
    console.error('HARDEN FAILED:', e.message || e);
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
