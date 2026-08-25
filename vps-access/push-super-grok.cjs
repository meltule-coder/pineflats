/**
 * Install/update Grok Build CLI on VPS and copy Super Grok auth from this PC.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const { installGrokOnVps } = require('./install-grok.cjs');

function readPw() {
  const p = 'C:/Users/IT101/Desktop/Grok.txt';
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) {
      return lines[i + 1].trim();
    }
  }
  throw new Error('no VPS password in Grok.txt');
}

function sftpPut(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

function sftpWrite(sftp, remote, content, mode = 0o600) {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remote, content, { mode }, (err) => (err ? reject(err) : resolve()));
  });
}

function exec(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', (d) => {
        stdout += d.toString();
        process.stdout.write(d);
      });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
        process.stderr.write(d);
      });
      stream.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    });
  });
}

async function main() {
  const password = readPw();
  const conn = { host: '74.208.115.104', port: 22, username: 'root', name: 'pine-flats-rv' };

  console.log('=== 1) Install / update Grok CLI on VPS ===\n');
  const install = await installGrokOnVps({
    conn,
    password,
    onLog: (t) => process.stdout.write(t),
  });
  console.log('\nInstall result:', install.message || install);

  const localGrok = path.join(process.env.USERPROFILE || 'C:/Users/IT101', '.grok');
  const authLocal = path.join(localGrok, 'auth.json');
  const configLocal = path.join(localGrok, 'config.toml');
  if (!fs.existsSync(authLocal)) {
    throw new Error(`Local Super Grok auth not found: ${authLocal}`);
  }

  console.log('\n=== 2) Copy Super Grok auth + config to VPS ===\n');
  const client = new Client();
  await new Promise((resolve, reject) => {
    client
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password,
        tryKeyboard: true,
        readyTimeout: 30000,
      });
  });

  try {
    await exec(client, 'mkdir -p /root/.grok && chmod 700 /root/.grok');

    const sftp = await new Promise((resolve, reject) => {
      client.sftp((err, s) => (err ? reject(err) : resolve(s)));
    });

    // Prefer writeFile so we control mode (auth secrets)
    await sftpWrite(sftp, '/root/.grok/auth.json', fs.readFileSync(authLocal), 0o600);
    console.log('Copied auth.json → /root/.grok/auth.json (mode 600)');

    if (fs.existsSync(configLocal)) {
      await sftpWrite(sftp, '/root/.grok/config.toml', fs.readFileSync(configLocal), 0o600);
      console.log('Copied config.toml → /root/.grok/config.toml');
    }

    // Ensure PATH for non-interactive shells
    await exec(
      client,
      `grep -q '.grok/bin' /root/.bashrc 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"' >> /root/.bashrc; ln -sfn /root/.grok/bin/grok /usr/local/bin/grok 2>/dev/null || true; ln -sfn /root/.local/bin/grok /usr/local/bin/grok 2>/dev/null || true; true`
    );

    console.log('\n=== 3) Verify on VPS ===\n');
    await exec(
      client,
      `export PATH=/root/.grok/bin:/root/.local/bin:/usr/local/bin:$PATH; which grok; grok --version 2>&1; echo "---"; ls -la /root/.grok/auth.json /root/.grok/config.toml 2>&1; echo "---"; grok auth status 2>&1 || true`
    );

    console.log('\nSUPER_GROK_PUSH_OK');
  } finally {
    client.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
