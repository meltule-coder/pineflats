/* global vps */

const EMPTY = {
  id: null,
  name: '',
  host: '',
  port: '22',
  username: '',
  password: '',
  identityFile: '',
  notes: '',
  clearPassword: false,
};

let form = { ...EMPTY };
let connections = [];
let editing = false;

const $ = (id) => document.getElementById(id);
const alerts = $('alerts');
const formRoot = $('form-root');
const listEl = $('list');

function buildCommand(c) {
  const parts = ['ssh'];
  if (c.port && Number(c.port) !== 22) parts.push('-p', String(c.port));
  if (c.identityFile) {
    const id = /\s/.test(c.identityFile) ? `"${c.identityFile}"` : c.identityFile;
    parts.push('-i', id);
  }
  parts.push(`${c.username}@${c.host}`);
  return parts.join(' ');
}

function buildConfig(c) {
  const alias = (c.name || 'host').replace(/\s+/g, '-').toLowerCase();
  const lines = [
    `Host ${alias}`,
    `  HostName ${c.host}`,
    `  User ${c.username}`,
    `  Port ${c.port || 22}`,
  ];
  if (c.identityFile) lines.push(`  IdentityFile ${c.identityFile}`);
  return lines.join('\n');
}

function showAlert(type, text) {
  alerts.innerHTML = text
    ? `<div class="alert alert-${type === 'error' ? 'error' : 'ok'}">${escapeHtml(text)}</div>`
    : '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function refresh() {
  connections = await vps.list();
  renderList();
}

async function openForm(conn) {
  editing = true;
  if (conn?.id) {
    const res = await vps.get(conn.id);
    const full = res.ok ? res.connection : conn;
    form = {
      id: full.id,
      name: full.name || '',
      host: full.host || '',
      port: String(full.port ?? 22),
      username: full.username || '',
      password: full.password || '',
      identityFile: full.identityFile || '',
      notes: full.notes || '',
      clearPassword: false,
    };
  } else {
    form = { ...EMPTY };
  }
  formRoot.hidden = false;
  renderForm();
}

function closeForm() {
  editing = false;
  form = { ...EMPTY };
  formRoot.hidden = true;
  formRoot.innerHTML = '';
}

function renderForm() {
  const preview =
    form.host && form.username
      ? buildCommand({
          host: form.host.trim(),
          port: Number(form.port) || 22,
          username: form.username.trim(),
          identityFile: form.identityFile.trim() || undefined,
        })
      : '';

  formRoot.innerHTML = `
    <div class="card">
      <h3>${form.id ? 'Edit connection' : 'New connection'}</h3>
      <div class="grid" style="margin-top:1rem">
        <div class="field span2">
          <label>Label *</label>
          <input id="f-name" value="${escapeHtml(form.name)}" placeholder="e.g. Production VPS" />
        </div>
        <div class="field">
          <label>Host *</label>
          <input id="f-host" class="mono" value="${escapeHtml(form.host)}" placeholder="vps.example.com" />
        </div>
        <div class="field">
          <label>Port</label>
          <input id="f-port" class="mono" type="number" min="1" max="65535" value="${escapeHtml(form.port)}" />
        </div>
        <div class="field">
          <label>Username *</label>
          <input id="f-user" class="mono" value="${escapeHtml(form.username)}" placeholder="root or ubuntu" />
        </div>
        <div class="field">
          <label>Password</label>
          <input
            id="f-password"
            type="password"
            autocomplete="current-password"
            value="${escapeHtml(form.password)}"
            placeholder="VPS password"
          />
        </div>
        <div class="field">
          <label>Identity file path (optional)</label>
          <input id="f-key" class="mono" value="${escapeHtml(form.identityFile)}" placeholder="C:\\Users\\You\\.ssh\\id_ed25519" />
        </div>
        <div class="field span2">
          <label>Notes</label>
          <textarea id="f-notes" rows="2" placeholder="Optional notes">${escapeHtml(form.notes)}</textarea>
        </div>
        <div class="field span2" style="display:flex;align-items:center;gap:0.5rem">
          <input type="checkbox" id="f-clear-pw" ${form.clearPassword ? 'checked' : ''} style="width:auto" />
          <label for="f-clear-pw" style="margin:0;text-transform:none;letter-spacing:0;font-size:0.8rem;cursor:pointer">
            Clear saved password
          </label>
        </div>
      </div>
      ${
        preview
          ? `<div class="term"><span class="prompt">$ </span>${escapeHtml(preview)}</div>`
          : ''
      }
      <div class="form-actions">
        <button type="button" class="btn btn-primary" id="f-save">Save</button>
        <button type="button" class="btn btn-ghost" id="f-cancel">Cancel</button>
      </div>
      <p style="margin:0.75rem 0 0;font-size:0.75rem;color:#5a6355;line-height:1.4">
        Password is saved on this computer (encrypted when Windows allows).
        On <strong>Connect</strong>, the password is copied so you can paste it at the SSH prompt.
      </p>
    </div>
  `;

  const bind = (id, key) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      form[key] = el.value;
      // lightweight re-preview without full rebind loss: only update term line
      const term = formRoot.querySelector('.term');
      const cmd =
        form.host.trim() && form.username.trim()
          ? buildCommand({
              host: form.host.trim(),
              port: Number(form.port) || 22,
              username: form.username.trim(),
              identityFile: form.identityFile.trim() || undefined,
            })
          : '';
      if (cmd) {
        if (term) term.innerHTML = `<span class="prompt">$ </span>${escapeHtml(cmd)}`;
        else renderForm();
      }
    });
  };
  bind('f-name', 'name');
  bind('f-host', 'host');
  bind('f-port', 'port');
  bind('f-user', 'username');
  bind('f-password', 'password');
  bind('f-key', 'identityFile');
  bind('f-notes', 'notes');
  document.getElementById('f-clear-pw').addEventListener('change', (e) => {
    form.clearPassword = e.target.checked;
    if (form.clearPassword) {
      form.password = '';
      document.getElementById('f-password').value = '';
    }
  });

  document.getElementById('f-cancel').onclick = () => {
    closeForm();
    showAlert('', '');
  };
  document.getElementById('f-save').onclick = async () => {
    const res = await vps.save({
      id: form.id,
      name: form.name,
      host: form.host,
      port: form.port,
      username: form.username,
      password: form.clearPassword ? '' : form.password,
      clearPassword: form.clearPassword,
      identityFile: form.identityFile,
      notes: form.notes,
    });
    if (!res.ok) {
      showAlert('error', res.error || 'Save failed');
      return;
    }
    showAlert('ok', form.id ? 'Connection saved.' : 'Connection saved.');
    closeForm();
    await refresh();
    setTimeout(() => showAlert('', ''), 2500);
  };
}

function renderList() {
  if (!connections.length && !editing) {
    listEl.innerHTML =
      '<div class="empty">No connections yet. Click <strong>Add connection</strong> to save your VPS.</div>';
    return;
  }

  listEl.innerHTML = connections
    .map((c) => {
      const cmd = buildCommand(c);
      const cfg = buildConfig(c);
      return `
      <div class="card" data-id="${escapeHtml(c.id)}">
        <div class="card-head">
          <div>
            <h3>
              ${escapeHtml(c.name)}
              <span class="badge">:${escapeHtml(String(c.port || 22))}</span>
              ${c.hasPassword ? '<span class="badge">password saved</span>' : ''}
            </h3>
            <div class="meta">${escapeHtml(c.username)}@${escapeHtml(c.host)}</div>
            ${c.notes ? `<p class="notes">${escapeHtml(c.notes)}</p>` : ''}
          </div>
          <div class="actions">
            <button type="button" class="btn btn-accent btn-sm" data-act="deploy">Deploy app</button>
            <button type="button" class="btn btn-primary btn-sm" data-act="install-grok">Install Grok</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="connect">Connect</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="test">Test port</button>
            ${c.hasPassword ? '<button type="button" class="btn btn-ghost btn-sm" data-act="copy-pw">Copy password</button>' : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-act="edit">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" data-act="delete">Delete</button>
          </div>
        </div>
        <div class="section-label">
          <span>Command</span>
          <button type="button" class="linkish" data-act="copy-cmd">Copy</button>
        </div>
        <div class="term"><span class="prompt">$ </span>${escapeHtml(cmd)}</div>
        <div class="section-label">
          <span>~/.ssh/config</span>
          <button type="button" class="linkish" data-act="copy-cfg">Copy</button>
        </div>
        <pre class="pre">${escapeHtml(cfg)}</pre>
        <div class="test-result" style="margin-top:0.65rem;font-size:0.8rem;color:#5a6355"></div>
        <pre class="pre deploy-log" hidden style="margin-top:0.75rem;max-height:220px;overflow:auto;white-space:pre-wrap"></pre>
      </div>
    `;
    })
    .join('');

  listEl.querySelectorAll('.card').forEach((card) => {
    const id = card.getAttribute('data-id');
    const conn = connections.find((c) => c.id === id);
    if (!conn) return;
    const resultEl = card.querySelector('.test-result');

    card.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.getAttribute('data-act');
        if (act === 'edit') {
          await openForm(conn);
          return;
        }
        if (act === 'copy-pw') {
          const res = await vps.copyPassword(id);
          if (res.ok) {
            showAlert('ok', 'Password copied to clipboard.');
          } else {
            showAlert('error', res.error || 'Could not copy password');
          }
          setTimeout(() => showAlert('', ''), 2500);
          return;
        }
        if (act === 'delete') {
          if (!confirm(`Delete “${conn.name}”?`)) return;
          await vps.delete(id);
          await refresh();
          showAlert('ok', 'Deleted.');
          setTimeout(() => showAlert('', ''), 2000);
          return;
        }
        if (act === 'copy-cmd') {
          await vps.copy(buildCommand(conn));
          showAlert('ok', 'Command copied.');
          setTimeout(() => showAlert('', ''), 2000);
          return;
        }
        if (act === 'copy-cfg') {
          await vps.copy(buildConfig(conn));
          showAlert('ok', 'Config snippet copied.');
          setTimeout(() => showAlert('', ''), 2000);
          return;
        }
        if (act === 'test') {
          resultEl.textContent = 'Testing…';
          const res = await vps.test(id);
          if (res.ok) {
            resultEl.textContent = `Port open · ${res.latencyMs ?? '?'}ms`;
            resultEl.style.color = '#3d5a3d';
          } else {
            resultEl.textContent = res.error || 'Unreachable';
            resultEl.style.color = '#b91c1c';
          }
          return;
        }
        if (act === 'connect') {
          const res = await vps.connect(id);
          if (res.ok) {
            showAlert(
              'ok',
              res.passwordCopied
                ? `Opened terminal (${res.mode}). Password is on the clipboard — paste when SSH asks.`
                : `Opened terminal (${res.mode}).`
            );
          } else {
            showAlert(
              'error',
              res.copied
                ? `${res.error} ${res.passwordCopied ? 'Password' : 'Command'} is on the clipboard.`
                : res.error || 'Could not connect'
            );
          }
          setTimeout(() => showAlert('', ''), 5000);
        }
        if (act === 'deploy') {
          if (!conn.hasPassword && !conn.identityFile) {
            showAlert(
              'error',
              'Save a password first: Edit → Password → Save, then click Deploy app.'
            );
            return;
          }
          if (
            !confirm(
              `Deploy Pine Flats to ${conn.username}@${conn.host}?\n\nUploads to /opt/pineflats, builds, and starts with pm2.`
            )
          ) {
            return;
          }
          const logEl = card.querySelector('.deploy-log');
          logEl.hidden = false;
          logEl.textContent = 'Starting deploy…\n';
          btn.disabled = true;
          const unsub = vps.onDeployLog((payload) => {
            if (payload.id !== id) return;
            logEl.textContent += payload.text || '';
            logEl.scrollTop = logEl.scrollHeight;
          });
          try {
            const res = await vps.deploy(id);
            if (res.ok) {
              showAlert('ok', res.message || 'Deploy complete.');
              logEl.textContent += '\n✓ Done.\n';
            } else {
              showAlert('error', res.error || 'Deploy failed');
              logEl.textContent += `\n✗ ${res.error || 'Failed'}\n`;
            }
          } finally {
            unsub();
            btn.disabled = false;
          }
        }
        if (act === 'install-grok') {
          if (!conn.hasPassword && !conn.identityFile) {
            showAlert(
              'error',
              'SSH password missing. Edit this connection → type the VPS root password → Save → Install Grok again. (This error is SSH login, not Grok itself.)'
            );
            return;
          }
          if (
            !confirm(
              `Install Grok Build CLI on ${conn.username}@${conn.host}?\n\nUses saved SSH password to log into the VPS, then runs the official installer.\n\nIf you see “authentication methods failed”, re-save the VPS password under Edit.`
            )
          ) {
            return;
          }
          const logEl = card.querySelector('.deploy-log');
          logEl.hidden = false;
          logEl.textContent = 'Installing Grok CLI on VPS…\n';
          btn.disabled = true;
          const unsub = vps.onDeployLog((payload) => {
            if (payload.id !== id) return;
            logEl.textContent += payload.text || '';
            logEl.scrollTop = logEl.scrollHeight;
          });
          try {
            const res = await vps.installGrok(id);
            if (res.ok) {
              showAlert(
                'ok',
                (res.message || 'Grok installed.') +
                  (res.hint ? ` ${res.hint}` : ' SSH in and run: grok')
              );
              logEl.textContent += '\n✓ Grok install complete. Run: grok\n';
            } else {
              showAlert('error', res.error || 'Grok install failed');
              logEl.textContent += `\n✗ ${res.error || 'Failed'}\n`;
            }
          } finally {
            unsub();
            btn.disabled = false;
          }
        }
      });
    });
  });
}

$('btn-add').onclick = async () => {
  await openForm(null);
  showAlert('', '');
};

$('btn-data').onclick = () => vps.openDataFolder();

refresh().catch((err) => {
  showAlert('error', err?.message || 'Failed to load connections');
});
