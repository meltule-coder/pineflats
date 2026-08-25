/**
 * Install official Grok Build CLI on a remote VPS over SSH.
 * Usage from Electron: installGrokOnVps({ conn, password, onLog })
 * CLI: node install-grok.cjs
 */
const fs = require('fs');
const path = require('path');
const { sshConnect } = require('./ssh-connect.cjs');

function defaultReadPassword() {
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

function execRemote(client, command, onLog) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
        .on('data', (data) => {
          const text = data.toString();
          stdout += text;
          if (onLog) onLog(text);
        });
      stream.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        if (onLog) onLog(text);
      });
    });
  });
}

/**
 * Install Grok CLI for root (or the SSH user) on the remote host.
 */
async function installGrokOnVps(opts) {
  const {
    conn,
    password,
    onLog = () => {},
  } = opts;

  if (!conn?.host || !conn?.username) throw new Error('Invalid connection');
  if (!password && !(conn.identityFile && fs.existsSync(conn.identityFile))) {
    throw new Error('VPS password or identity file required');
  }

  onLog(`Connecting to ${conn.username}@${conn.host}:${conn.port || 22}…\n`);
  const client = await sshConnect(conn, password);

  try {
    // Official Grok Build install (Linux)
    const script = `
set -e
export DEBIAN_FRONTEND=noninteractive
echo "=== Installing prerequisites ==="
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y curl ca-certificates bash 2>&1 | tail -n 5 || true
fi

echo "=== Installing Grok Build CLI ==="
curl -fsSL https://x.ai/cli/install.sh | bash

# Ensure common install locations on PATH for non-login shells
export PATH="$HOME/.local/bin:$HOME/.grok/bin:/usr/local/bin:$PATH"
if [ -f "$HOME/.bashrc" ] && ! grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"' >> "$HOME/.bashrc"
fi
if [ -f /root/.bashrc ] && ! grep -q '.local/bin' /root/.bashrc 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"' >> /root/.bashrc
fi

# Symlink into /usr/local/bin if possible
for cand in "$HOME/.local/bin/grok" "$HOME/.grok/bin/grok" /usr/local/bin/grok; do
  if [ -x "$cand" ]; then
    ln -sfn "$cand" /usr/local/bin/grok 2>/dev/null || true
    break
  fi
done

# Also try locating freshly installed binary
if ! command -v grok >/dev/null 2>&1; then
  FOUND=$(find "$HOME" /usr/local -name grok -type f 2>/dev/null | head -n 1 || true)
  if [ -n "$FOUND" ]; then
    ln -sfn "$FOUND" /usr/local/bin/grok 2>/dev/null || true
    export PATH="$(dirname "$FOUND"):$PATH"
  fi
fi

echo "=== Verify ==="
export PATH="$HOME/.local/bin:$HOME/.grok/bin:/usr/local/bin:$PATH"
if command -v grok >/dev/null 2>&1; then
  grok --version || grok -v || true
  which grok || true
  echo "GROK_INSTALL_OK"
else
  echo "GROK_INSTALL_WARN: binary not found on PATH after install"
  ls -la "$HOME/.local/bin" 2>/dev/null || true
  ls -la "$HOME/.grok" 2>/dev/null | head -n 30 || true
  exit 1
fi
`;

    onLog('Installing Grok CLI on the VPS (may take a minute)…\n');
    const remotePath = '/tmp/install-grok-pineflats.sh';
    await new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.writeFile(remotePath, script, (wErr) => (wErr ? reject(wErr) : resolve()));
      });
    });

    const result = await execRemote(
      client,
      `chmod +x ${remotePath} && bash ${remotePath}`,
      onLog
    );

    if (result.code !== 0 && !result.stdout.includes('GROK_INSTALL_OK')) {
      throw new Error(
        `Grok install failed (exit ${result.code}).\n${result.stderr || result.stdout}`
      );
    }

    onLog('\nGrok CLI installed. On the VPS run: grok   (then sign in if prompted)\n');
    return {
      ok: true,
      host: conn.host,
      message: `Grok CLI installed on ${conn.username}@${conn.host}`,
      hint: 'SSH in and run `grok` to authenticate (browser or API key).',
    };
  } finally {
    try {
      client.end();
    } catch {
      /* ignore */
    }
  }
}

module.exports = { installGrokOnVps };

// CLI entry
if (require.main === module) {
  const password = defaultReadPassword();
  installGrokOnVps({
    conn: { host: '74.208.115.104', port: 22, username: 'root', name: 'pine-flats-rv' },
    password,
    onLog: (t) => process.stdout.write(t),
  })
    .then((r) => {
      console.log(JSON.stringify(r));
      process.exit(0);
    })
    .catch((e) => {
      console.error('INSTALL_FAILED:', e.message || e);
      process.exit(1);
    });
}
