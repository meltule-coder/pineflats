import { useEffect, useState } from 'react';
import {
  Terminal, Plus, Save, Trash2, Pencil, X, Copy, Check, Wifi, Server, KeyRound, User, Hash
} from 'lucide-react';

interface SshConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  identityFile?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

const EMPTY = {
  name: '',
  host: '',
  port: '22',
  username: '',
  identityFile: '',
  notes: '',
};

function buildCommand(c: Pick<SshConnection, 'host' | 'port' | 'username' | 'identityFile'>) {
  const parts = ['ssh'];
  if (c.port && c.port !== 22) parts.push('-p', String(c.port));
  if (c.identityFile) {
    const id = c.identityFile.includes(' ') ? `"${c.identityFile}"` : c.identityFile;
    parts.push('-i', id);
  }
  parts.push(`${c.username}@${c.host}`);
  return parts.join(' ');
}

function buildConfig(c: SshConnection) {
  const alias = c.name.replace(/\s+/g, '-').toLowerCase() || 'host';
  const lines = [
    `Host ${alias}`,
    `  HostName ${c.host}`,
    `  User ${c.username}`,
    `  Port ${c.port || 22}`,
  ];
  if (c.identityFile) lines.push(`  IdentityFile ${c.identityFile}`);
  return lines.join('\n');
}

export function SshWidget() {
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const load = async () => {
    const res = await fetch('/api/ssh');
    if (res.ok) setConnections(await res.json());
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm(EMPTY);
    setEditingId(null);
    setShowForm(false);
    setError(null);
  };

  const startAdd = () => {
    setForm(EMPTY);
    setEditingId(null);
    setShowForm(true);
    setError(null);
  };

  const startEdit = (c: SshConnection) => {
    setForm({
      name: c.name,
      host: c.host,
      port: String(c.port ?? 22),
      username: c.username,
      identityFile: c.identityFile ?? '',
      notes: c.notes ?? '',
    });
    setEditingId(c.id);
    setShowForm(true);
    setError(null);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      setError('Name, host, and username are required.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setMessage(null);
    try {
      const body = {
        name: form.name.trim(),
        host: form.host.trim(),
        port: form.port || '22',
        username: form.username.trim(),
        identityFile: form.identityFile.trim(),
        notes: form.notes.trim(),
      };
      const res = await fetch(
        editingId ? `/api/ssh/${editingId}` : '/api/ssh',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not save connection');
        return;
      }
      await load();
      resetForm();
      setMessage(editingId ? 'Connection updated.' : 'Connection saved.');
      setTimeout(() => setMessage(null), 2500);
    } catch {
      setError('Network error — is the server running?');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this SSH connection?')) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/ssh/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not delete');
        return;
      }
      await load();
      if (editingId === id) resetForm();
    } finally {
      setIsLoading(false);
    }
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  };

  const testConnection = async (c: SshConnection) => {
    setTestingId(c.id);
    setTestResults(prev => ({ ...prev, [c.id]: { ok: false, text: 'Testing…' } }));
    try {
      const res = await fetch(`/api/ssh/${c.id}/test`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setTestResults(prev => ({
          ...prev,
          [c.id]: {
            ok: true,
            text: `Port open · ${data.latencyMs ?? '?'}ms`,
          },
        }));
      } else {
        setTestResults(prev => ({
          ...prev,
          [c.id]: {
            ok: false,
            text: data.error || 'Unreachable',
          },
        }));
      }
    } catch {
      setTestResults(prev => ({
        ...prev,
        [c.id]: { ok: false, text: 'Test request failed' },
      }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#1a1f1c] rounded-xl flex items-center justify-center shrink-0 border border-[#3D3730]">
            <Terminal className="w-5 h-5 text-[#A8B2A6]" />
          </div>
          <div>
            <h2 className="text-xl font-serif text-[#3D3730]">SSH connections</h2>
            <p className="text-sm text-[#5A6355] mt-1">
              Save VPS hosts, copy the SSH command, and check that the port is open.
              Run the command in a terminal on your computer (this page does not open a live shell).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={startAdd}
          className="flex items-center gap-2 bg-[#5A6355] text-white rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg shadow-black/10 hover:bg-[#3D3730] transition"
        >
          <Plus className="w-4 h-4" />
          Add connection
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{error}</p>
      )}
      {message && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-2xl px-4 py-3">{message}</p>
      )}

      {showForm && (
        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-serif text-[#3D3730]">
              {editingId ? 'Edit connection' : 'New connection'}
            </h3>
            <button type="button" onClick={resetForm} className="p-2 rounded-xl hover:bg-[#FBF9F7] text-[#5A6355]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Label *</label>
              <input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Production VPS"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355] flex items-center gap-1">
                <Server className="w-3 h-3" /> Host *
              </label>
              <input
                value={form.host}
                onChange={e => setForm(p => ({ ...p, host: e.target.value }))}
                placeholder="example.com or 192.168.1.10"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355] flex items-center gap-1">
                <Hash className="w-3 h-3" /> Port
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={e => setForm(p => ({ ...p, port: e.target.value }))}
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355] flex items-center gap-1">
                <User className="w-3 h-3" /> Username *
              </label>
              <input
                value={form.username}
                onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                placeholder="root or ubuntu"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355] flex items-center gap-1">
                <KeyRound className="w-3 h-3" /> Identity file (path)
              </label>
              <input
                value={form.identityFile}
                onChange={e => setForm(p => ({ ...p, identityFile: e.target.value }))}
                placeholder="~/.ssh/id_ed25519"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                rows={2}
                placeholder="Optional notes (no passwords stored here)"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
            </div>
          </div>

          {(form.host && form.username) && (
            <div className="rounded-2xl bg-[#1a1f1c] text-[#A8B2A6] px-4 py-3 font-mono text-xs overflow-x-auto">
              <span className="text-[#C29474]">$ </span>
              {buildCommand({
                host: form.host.trim(),
                port: Number(form.port) || 22,
                username: form.username.trim(),
                identityFile: form.identityFile.trim() || undefined,
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading}
              className="flex items-center gap-2 bg-[#5A6355] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isLoading ? 'Saving…' : editingId ? 'Update' : 'Save connection'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-2 border border-[#E2D9D0] text-[#5A6355] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {connections.map(c => {
          const cmd = buildCommand(c);
          const config = buildConfig(c);
          const test = testResults[c.id];
          return (
            <div
              key={c.id}
              className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-lg font-serif text-[#3D3730]">{c.name}</h3>
                    <span className="text-[10px] uppercase tracking-wider font-semibold bg-[#FBF9F7] border border-[#E2D9D0] text-[#5A6355] px-2 py-0.5 rounded-full">
                      :{c.port}
                    </span>
                  </div>
                  <p className="text-sm font-mono text-[#5A6355] truncate">
                    {c.username}@{c.host}
                  </p>
                  {c.notes && (
                    <p className="text-xs text-[#5A6355] mt-2 leading-relaxed">{c.notes}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => testConnection(c)}
                    disabled={testingId === c.id}
                    className="flex items-center gap-1.5 text-xs font-semibold border border-[#E2D9D0] text-[#5A6355] px-3 py-2 rounded-xl hover:bg-[#FBF9F7] disabled:opacity-50"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    {testingId === c.id ? 'Testing…' : 'Test port'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(c)}
                    className="flex items-center gap-1.5 text-xs font-semibold border border-[#E2D9D0] text-[#5A6355] px-3 py-2 rounded-xl hover:bg-[#FBF9F7]"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 text-xs font-semibold border border-red-200 text-red-700 px-3 py-2 rounded-xl hover:bg-red-50 disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>

              {test && (
                <p
                  className={`text-xs rounded-xl px-3 py-2 border ${
                    test.ok
                      ? 'bg-[#E8F0E8] border-[#A8B2A6] text-[#3D5A3D]'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  {test.text}
                </p>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-[#5A6355]">Command</span>
                  <button
                    type="button"
                    onClick={() => copyText(`cmd-${c.id}`, cmd)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[#5A6355] hover:text-[#3D3730]"
                  >
                    {copiedId === `cmd-${c.id}` ? (
                      <><Check className="w-3.5 h-3.5 text-[#3D5A3D]" /> Copied</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5" /> Copy</>
                    )}
                  </button>
                </div>
                <div className="rounded-2xl bg-[#1a1f1c] text-[#A8B2A6] px-4 py-3 font-mono text-xs overflow-x-auto">
                  <span className="text-[#C29474]">$ </span>
                  {cmd}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-[#5A6355]">~/.ssh/config</span>
                  <button
                    type="button"
                    onClick={() => copyText(`cfg-${c.id}`, config)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[#5A6355] hover:text-[#3D3730]"
                  >
                    {copiedId === `cfg-${c.id}` ? (
                      <><Check className="w-3.5 h-3.5 text-[#3D5A3D]" /> Copied</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5" /> Copy</>
                    )}
                  </button>
                </div>
                <pre className="rounded-2xl bg-[#FBF9F7] border border-[#E2D9D0] px-4 py-3 font-mono text-xs text-[#3D3730] overflow-x-auto whitespace-pre">
                  {config}
                </pre>
              </div>
            </div>
          );
        })}
      </div>

      {connections.length === 0 && !showForm && (
        <div className="bg-white rounded-[32px] border border-dashed border-[#E2D9D0] p-12 text-center text-sm text-[#5A6355]">
          No SSH connections yet. Click <strong>Add connection</strong> to save a host.
        </div>
      )}
    </div>
  );
}
