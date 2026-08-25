/**
 * ASV / Clover Data Security Manager:
 * Configure host firewall to deny by default; allow only required services.
 *
 * - Public website: TCP 80, 443 from anywhere (required for park booking)
 * - SSH management: TCP 22 from ALLOWED_IPS only
 * - App (3000): not public (bound to loopback); not opened in firewall
 *
 * Usage:
 *   npx electron setup-firewall.cjs
 *   npx electron setup-firewall.cjs --ips=1.2.3.4,5.6.7.8
 *   npx electron setup-firewall.cjs --dry-run
 *
 * Env: FIREWALL_SSH_ALLOW_IPS=1.2.3.4,5.6.7.8
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const https = require('https');

const VPS_USER_DATA = path.join(process.env.APPDATA || '', 'pineflats-vps-access');
try {
  app.setName('pineflats-vps-access');
  app.setPath('userData', VPS_USER_DATA);
} catch {
  /* ignore */
}

const CONNECTIONS_FILE = path.join(VPS_USER_DATA, 'ssh-connections.json');
const ALLOW_FILE = path.join(VPS_USER_DATA, 'firewall-ssh-allowlist.json');

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

function parseArgs(argv) {
  const out = { ips: [], dryRun: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    if (a.startsWith('--ips=')) {
      out.ips = a
        .slice(6)
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return out;
}

function isValidIp(ip) {
  // IPv4 only for allowlist simplicity (ASV commonly expects this)
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split('.').every((o) => {
      const n = Number(o);
      return n >= 0 && n <= 255;
    });
}

function fetchPublicIp() {
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org?format=json', { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (c) => {
        data += c;
      });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(String(j.ip || '').trim() || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function loadSavedAllowlist() {
  try {
    if (!fs.existsSync(ALLOW_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.ips || [];
    return list.map(String).filter(isValidIp);
  } catch {
    return [];
  }
}

function saveAllowlist(ips) {
  try {
    fs.writeFileSync(
      ALLOW_FILE,
      JSON.stringify({ ips, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch (e) {
    console.warn('Could not save local allowlist file:', e.message);
  }
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

function buildRemoteScript(allowIps, dryRun) {
  const ipsJson = JSON.stringify(allowIps);
  // Escape for embedding inside a single-quoted shell string
  const ipsJsonShell = ipsJson.replace(/'/g, `'\\''`);
  return `
set -e
export DEBIAN_FRONTEND=noninteractive
DRY_RUN=${dryRun ? '1' : '0'}
export ALLOW_IPS_JSON='${ipsJsonShell}'

echo "=== HOST ==="
hostname
date -u
echo "SSH allowlist: $ALLOW_IPS_JSON"

echo ""
echo "=== BEFORE (ss / ufw) ==="
ss -lntp | grep -E ':(22|80|443|3000)\\b' || true
command -v ufw >/dev/null && ufw status verbose || echo "ufw not installed yet"

# Ensure ufw present
if ! command -v ufw >/dev/null 2>&1; then
  echo "Installing ufw..."
  apt-get update -qq
  apt-get install -y ufw
fi

python3 - <<'PY'
import json, os
ips = json.loads(os.environ.get("ALLOW_IPS_JSON", "[]") or "[]")
print("ALLOW_COUNT", len(ips))
for ip in ips:
    print("ALLOW_IP", ip)
if not ips:
    raise SystemExit("No SSH allowlist IPs")
PY

if [ "$DRY_RUN" = "1" ]; then
  echo "=== DRY RUN plan ==="
  echo "ufw default deny incoming"
  echo "ufw default allow outgoing"
  echo "ufw allow 80/tcp"
  echo "ufw allow 443/tcp"
  python3 - <<'PY'
import json, os
for ip in json.loads(os.environ["ALLOW_IPS_JSON"]):
    print(f"ufw allow from {ip} to any port 22 proto tcp")
PY
  echo "ufw deny 3000/tcp"
  echo "ufw --force enable"
  echo "DRY_RUN_OK"
  exit 0
fi

echo "Resetting ufw to a known-good policy..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# Public website — required for park booking / Clover checkout
ufw allow 80/tcp comment 'HTTP ACME + redirect'
ufw allow 443/tcp comment 'HTTPS public website'

# SSH only from allowlisted IPs (management plane)
python3 - <<'PY'
import json, os, subprocess
ips = json.loads(os.environ["ALLOW_IPS_JSON"])
if not ips:
    raise SystemExit("No SSH allowlist IPs — refusing to lock firewall")
for ip in ips:
    subprocess.check_call([
        "ufw", "allow", "from", ip, "to", "any", "port", "22", "proto", "tcp",
        "comment", f"SSH admin {ip}",
    ])
    print(f"SSH allow {ip}/32")
PY

# App listens on loopback only; block public 3000 if ever rebound
ufw deny 3000/tcp comment 'Block public app port' || true

echo "Enabling ufw..."
ufw --force enable
ufw status verbose numbered

echo ""
echo "=== AFTER listeners ==="
ss -lntp | grep -E ':(22|80|443|3000)\\b' || true
echo "FIREWALL_OK"
`;
}

app.whenReady().then(async () => {
  let client;
  try {
    const args = parseArgs(process.argv.slice(2));
    const envIps = String(process.env.FIREWALL_SSH_ALLOW_IPS || '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const detected = await fetchPublicIp();
    const saved = loadSavedAllowlist();
    const merged = [...new Set([...args.ips, ...envIps, ...saved, ...(detected ? [detected] : [])])]
      .filter(isValidIp);

    if (merged.length === 0) {
      throw new Error(
        'No SSH allowlist IPs. Re-run with --ips=YOUR.PUBLIC.IP or set FIREWALL_SSH_ALLOW_IPS.'
      );
    }

    console.log('SSH allowlist IPs:', merged.join(', '));
    if (detected) console.log('Detected your current public IP:', detected);
    if (!merged.includes(detected) && detected) {
      console.warn('WARNING: detected IP is not in allowlist — you may lock yourself out.');
    }

    if (!args.dryRun) {
      saveAllowlist(merged);
    }

    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    if (!conn?.host) throw new Error('No saved VPS connection');
    const password = decryptPassword(conn.password);
    if (!password) throw new Error('Could not decrypt VPS password');

    console.log(`Connecting to ${conn.username}@${conn.host}…`);
    client = await sshConnect(conn, password);

    // Safety: confirm we can still open a session from this IP after rules by applying while connected
    const remote = buildRemoteScript(merged, args.dryRun);
    const b64 = Buffer.from(remote, 'utf8').toString('base64');
    const result = await execRemote(client, `echo '${b64}' | base64 -d | bash`);
    console.log(result.stdout || '');
    if (result.stderr) console.error(result.stderr);

    const ok =
      (result.stdout || '').includes('FIREWALL_OK') ||
      (result.stdout || '').includes('DRY_RUN_OK');
    client.end();
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('FIREWALL SETUP FAILED:', e.message || e);
    app.exit(1);
  }
});
