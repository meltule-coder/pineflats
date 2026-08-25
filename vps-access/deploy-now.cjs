/**
 * One-shot CLI deploy using saved VPS Access connection + Electron safeStorage password.
 * Usage: npx electron deploy-now.cjs
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

// Must match Pine Flats VPS Access userData so safeStorage can decrypt the password
const VPS_USER_DATA = path.join(process.env.APPDATA || '', 'pineflats-vps-access');
try {
  app.setName('pineflats-vps-access');
  app.setPath('userData', VPS_USER_DATA);
} catch {
  /* ignore if already locked */
}

const { deployToVps } = require('./deploy.cjs');

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

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(CONNECTIONS_FILE)) {
      throw new Error(`No connections file at ${CONNECTIONS_FILE}`);
    }
    const list = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8'));
    const conn = Array.isArray(list) ? list[0] : null;
    if (!conn?.host) throw new Error('No saved VPS connection found');

    const password = decryptPassword(conn.password);
    if (!password && !(conn.identityFile && fs.existsSync(conn.identityFile))) {
      throw new Error(
        'Could not decrypt saved password. Open Pine Flats VPS Access, re-save the password, then retry.'
      );
    }

    const publicConn = {
      host: conn.host,
      username: conn.username,
      port: conn.port || 22,
      identityFile: conn.identityFile,
    };

    console.log(`Deploying to ${publicConn.username}@${publicConn.host}:${publicConn.port}…`);
    const result = await deployToVps({
      conn: publicConn,
      password,
      appRoot: path.resolve(__dirname, '..'),
      remoteDir: '/opt/pineflats',
      onLog: (text) => process.stdout.write(text),
    });
    console.log(result.message || 'Deploy OK');
    app.exit(0);
  } catch (e) {
    console.error('DEPLOY FAILED:', e.message || e);
    app.exit(1);
  }
});

app.on('window-all-closed', (e) => e.preventDefault());
