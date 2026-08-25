/**
 * Shared SSH connect for Deploy / Install Grok with clear auth errors.
 */
const fs = require('fs');
const { Client } = require('ssh2');

/**
 * @param {object} conn - { host, port, username, identityFile? }
 * @param {string} [password]
 * @returns {Promise<import('ssh2').Client>}
 */
function sshConnect(conn, password) {
  return new Promise((resolve, reject) => {
    const host = String(conn.host || '').trim();
    const username = String(conn.username || '').trim();
    const port = Number(conn.port) || 22;
    const pass = password != null ? String(password) : '';
    const keyPath = conn.identityFile ? String(conn.identityFile).trim() : '';

    if (!host || !username) {
      return reject(new Error('Connection needs host and username. Edit the connection and Save.'));
    }

    let privateKey;
    if (keyPath) {
      if (!fs.existsSync(keyPath)) {
        return reject(
          new Error(
            `SSH key file not found: ${keyPath}\nClear Identity file in Edit, or fix the path. Prefer saving the VPS password instead.`
          )
        );
      }
      try {
        privateKey = fs.readFileSync(keyPath);
      } catch (e) {
        return reject(new Error(`Could not read SSH key: ${e.message}`));
      }
    }

    if (!pass && !privateKey) {
      return reject(
        new Error(
          'No password and no SSH key for this connection.\n\n' +
            'Fix: Edit connection → type the VPS root password → Save → try Install Grok again.\n' +
            '(Reinstalling the VPS Access app can clear encrypted passwords.)'
        )
      );
    }

    const client = new Client();
    const config = {
      host,
      port,
      username,
      readyTimeout: 45000,
      // Many VPS images use keyboard-interactive for password prompts
      tryKeyboard: true,
    };

    // Prefer password when provided (widget password is the usual case).
    // Only attach key when no password — avoids "publickey failed" blocking password auth.
    if (pass) {
      config.password = pass;
    } else if (privateKey) {
      config.privateKey = privateKey;
    }

    client
      .on('ready', () => resolve(client))
      .on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        finish(prompts.map(() => pass || ''));
      })
      .on('error', (err) => {
        const msg = String(err.message || err);
        if (/all configured authentication methods failed/i.test(msg)) {
          reject(
            new Error(
              'SSH login failed: wrong username/password or no password saved.\n\n' +
                `Tried: ${username}@${host}:${port}\n` +
                '1. Edit this connection\n' +
                '2. Re-type the VPS root password (do not leave blank)\n' +
                '3. Clear Identity file unless you use a key\n' +
                '4. Save, then Install Grok / Deploy again'
            )
          );
          return;
        }
        if (/Timed out|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
          reject(
            new Error(
              `Cannot reach ${host}:${port} — ${msg}\nCheck the server is on and port 22 is open.`
            )
          );
          return;
        }
        reject(err);
      })
      .connect(config);
  });
}

module.exports = { sshConnect };
