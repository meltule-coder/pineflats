/**
 * Package local Pine Flats app and upload to VPS over SSH/SFTP.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Client } = require('ssh2');
const archiverMod = require('archiver');
const { sshConnect } = require('./ssh-connect.cjs');
const createArchiver =
  typeof archiverMod === 'function'
    ? (opts) => archiverMod('zip', opts)
    : (opts) => new archiverMod.ZipArchive(opts);

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'uploads',
  'data',
  'release',
  '.turbo',
  '.next',
]);

const SKIP_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  'gh-auth-output.txt',
  'test-upload.png',
  '_recover.js',
]);

function defaultAppRoot() {
  return path.resolve(__dirname, '..');
}

function shouldSkip(relPath) {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  if (parts.some((p) => SKIP_DIR_NAMES.has(p))) return true;
  const base = parts[parts.length - 1] || '';
  if (SKIP_FILE_NAMES.has(base)) return true;
  if (base.startsWith('.env') && base !== '.env.example') return true;
  if (parts.includes('vps-access') && parts.includes('node_modules')) return true;
  if (parts.includes('vps-access') && parts.includes('release')) return true;
  return false;
}

function walkFiles(root, dir = root, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(root, abs);
    if (shouldSkip(rel)) continue;
    if (ent.isDirectory()) walkFiles(root, abs, out);
    else if (ent.isFile()) out.push({ abs, rel: rel.replace(/\\/g, '/') });
  }
  return out;
}

function createZip(appRoot) {
  return new Promise((resolve, reject) => {
    const zipPath = path.join(os.tmpdir(), `pineflats-deploy-${Date.now()}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = createArchiver({ zlib: { level: 6 } });
    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(output);
    for (const f of walkFiles(appRoot)) {
      archive.file(f.abs, { name: f.rel });
    }
    archive.finalize();
  });
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

function sftpUpload(client, localPath, remotePath, onLog) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      if (onLog) onLog(`Uploading to ${remotePath}…\n`);
      sftp.fastPut(localPath, remotePath, (putErr) => {
        if (putErr) reject(putErr);
        else resolve();
      });
    });
  });
}

async function deployToVps(opts) {
  const {
    conn,
    password,
    appRoot = defaultAppRoot(),
    remoteDir = '/opt/pineflats',
    onLog = () => {},
  } = opts;

  if (!conn?.host || !conn?.username) throw new Error('Invalid connection');
  if (!password && !(conn.identityFile && fs.existsSync(conn.identityFile))) {
    throw new Error(
      'Save a VPS password (Edit → Password → Save) or set an identity file path, then Deploy again.'
    );
  }
  if (!fs.existsSync(path.join(appRoot, 'package.json'))) {
    throw new Error(`App not found at ${appRoot}`);
  }

  onLog(`Packaging app from ${appRoot}…\n`);
  const zipPath = await createZip(appRoot);
  onLog(`Package ready (${Math.round(fs.statSync(zipPath).size / 1024)} KB)\n`);

  onLog(`Connecting to ${conn.username}@${conn.host}:${conn.port || 22}…\n`);
  let client;
  try {
    client = await sshConnect(conn, password);
  } catch (e) {
    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
    throw new Error(`SSH connect failed: ${e.message || e}`);
  }

  const remoteZip = '/tmp/pineflats-deploy.zip';
  const remoteScript = '/tmp/pineflats-setup.sh';

  try {
    onLog('Creating remote directory…\n');
    await execRemote(client, `mkdir -p ${remoteDir}`, onLog);
    await sftpUpload(client, zipPath, remoteZip, onLog);
    onLog('Upload complete.\n');

    const setup = `#!/bin/bash
set -e
REMOTE_DIR="${remoteDir}"
export DEBIAN_FRONTEND=noninteractive

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js 20..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs unzip
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nodejs npm unzip
  else
    echo "Please install Node.js manually"
    exit 1
  fi
fi

if ! command -v unzip >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then apt-get install -y unzip; fi
  if command -v dnf >/dev/null 2>&1; then dnf install -y unzip; fi
fi

mkdir -p "$REMOTE_DIR"
cd "$REMOTE_DIR"

# Always backup live park data before swapping code (never lose saved info)
BACKUP_ROOT="/opt/pineflats-backups"
BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
if [ -d "$REMOTE_DIR/data" ]; then
  echo "Backing up data/ to $BACKUP_DIR/data"
  cp -a "$REMOTE_DIR/data" "$BACKUP_DIR/data"
fi
if [ -d "$REMOTE_DIR/uploads" ]; then
  echo "Backing up uploads/ to $BACKUP_DIR/uploads"
  cp -a "$REMOTE_DIR/uploads" "$BACKUP_DIR/uploads" 2>/dev/null || true
fi
# Keep last 14 backups only
ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null | tail -n +15 | xargs -r rm -rf

TMP_UNPACK=$(mktemp -d)
unzip -qo ${remoteZip} -d "$TMP_UNPACK"
shopt -s dotglob
for item in "$TMP_UNPACK"/*; do
  base=$(basename "$item")
  # NEVER replace live data or uploads — only merge missing files if zip has any
  if [ "$base" = "data" ] || [ "$base" = "uploads" ]; then
    mkdir -p "$REMOTE_DIR/$base"
    # -n = do not overwrite existing saved files
    cp -an "$item"/* "$REMOTE_DIR/$base"/ 2>/dev/null || true
  else
    rm -rf "$REMOTE_DIR/$base"
    cp -a "$item" "$REMOTE_DIR/"
  fi
done
rm -rf "$TMP_UNPACK" ${remoteZip}
# Ensure data + uploads directories always exist after deploy
mkdir -p "$REMOTE_DIR/data" "$REMOTE_DIR/uploads"

cd "$REMOTE_DIR"
echo "npm install..."
npm install --omit=dev
echo "Building..."
npm run build

if [ ! -f .env.local ] && [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env.local
    echo "Created .env.local from example — edit secrets on the server."
  fi
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

export NODE_ENV=production
pm2 delete pineflats 2>/dev/null || true
pm2 start dist/server.cjs --name pineflats --update-env
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo "DEPLOY_OK"
echo "App directory: $REMOTE_DIR"
`;

    await new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.writeFile(remoteScript, setup, (wErr) => (wErr ? reject(wErr) : resolve()));
      });
    });

    onLog('Installing dependencies and starting app on VPS…\n');
    const result = await execRemote(
      client,
      `chmod +x ${remoteScript} && bash ${remoteScript}`,
      onLog
    );

    if (result.code !== 0 && !result.stdout.includes('DEPLOY_OK')) {
      throw new Error(
        `Remote setup failed (exit ${result.code}).\n${result.stderr || result.stdout}`
      );
    }

    onLog('\nDeploy finished successfully.\n');
    return {
      ok: true,
      remoteDir,
      host: conn.host,
      message: `App deployed to ${conn.username}@${conn.host}:${remoteDir}`,
    };
  } finally {
    try {
      client.end();
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
  }
}

module.exports = { deployToVps, defaultAppRoot };
