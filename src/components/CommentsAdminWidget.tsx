import { useEffect, useState } from 'react';
import { MessageSquare, Star, Send, Trash2, X, Save } from 'lucide-react';
import { CustomerComment } from '../../types';

function formatCommentDate(iso?: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function CommentsAdminWidget() {
  const [comments, setComments] = useState<CustomerComment[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [adminName, setAdminName] = useState('Pine Flats');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadComments = async () => {
    const res = await fetch('/api/comments');
    if (res.ok) {
      const data = await res.json();
      setComments(Array.isArray(data) ? data : []);
      const drafts: Record<string, string> = {};
      for (const c of data as CustomerComment[]) {
        drafts[c.id] = c.adminReply ?? '';
      }
      setReplyDrafts(drafts);
    }
  };

  useEffect(() => {
    loadComments();
  }, []);

  const saveReply = async (id: string) => {
    const reply = (replyDrafts[id] ?? '').trim();
    if (!reply) {
      setError('Enter a reply before saving.');
      return;
    }
    setSavingId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/comments/${id}/reply`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply, adminName: adminName.trim() || 'Pine Flats' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not save reply');
        return;
      }
      await loadComments();
      setMessage('Reply saved and will show on the website.');
      setTimeout(() => setMessage(null), 2500);
    } catch {
      setError('Network error — could not save reply.');
    } finally {
      setSavingId(null);
    }
  };

  const removeReply = async (id: string) => {
    if (!confirm('Remove the admin reply from this comment?')) return;
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/comments/${id}/reply`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not remove reply');
        return;
      }
      await loadComments();
    } finally {
      setSavingId(null);
    }
  };

  const removeComment = async (id: string) => {
    if (!confirm('Delete this guest comment permanently?')) return;
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not delete comment');
        return;
      }
      await loadComments();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#EDE7E1] rounded-xl flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-[#5A6355]" />
          </div>
          <div>
            <h2 className="text-xl font-serif text-[#3D3730]">Guest Comments</h2>
            <p className="text-sm text-[#5A6355] mt-1">
              Read website comments and post admin replies. Replies appear under each guest comment on the public site.
            </p>
          </div>
        </div>
        <div className="w-full sm:w-auto space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-[#5A6355]">Reply as</label>
          <input
            value={adminName}
            onChange={e => setAdminName(e.target.value)}
            placeholder="Pine Flats"
            className="w-full sm:w-48 px-3 py-2 bg-white border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{error}</p>
      )}
      {message && (
        <p className="text-sm text-[#3D5A3D] bg-[#E8F0E8] border border-[#A8B2A6] rounded-2xl px-4 py-3">{message}</p>
      )}

      <div className="space-y-4">
        {comments.length === 0 ? (
          <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-10 text-center text-sm text-[#5A6355]">
            No guest comments yet. Comments posted on the website will show up here.
          </div>
        ) : (
          comments.map(c => (
            <div
              key={c.id}
              className="bg-white rounded-[32px] border border-[#E2D9D0] p-5 sm:p-6 shadow-sm space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-serif text-[#3D3730] font-semibold">{c.name}</span>
                    {c.rating != null && (
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star
                            key={i}
                            className={`w-3.5 h-3.5 ${
                              i < (c.rating ?? 0) ? 'text-[#C29474] fill-[#C29474]' : 'text-[#E2D9D0]'
                            }`}
                          />
                        ))}
                      </span>
                    )}
                    <span className="text-xs text-[#A8B2A6]">{formatCommentDate(c.createdAt)}</span>
                  </div>
                  <p className="text-sm text-[#5A6355] leading-relaxed whitespace-pre-wrap">{c.comment}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeComment(c.id)}
                  disabled={savingId === c.id}
                  className="flex items-center gap-1.5 text-xs font-semibold text-red-700 border border-red-200 px-3 py-2 rounded-xl hover:bg-red-50 disabled:opacity-50 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>

              {c.adminReply && (
                <div className="rounded-2xl border border-[#A8B2A6]/50 bg-[#E8F0E8]/50 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#3D5A3D] font-semibold mb-1">
                    Current reply · {c.adminReplyName || 'Pine Flats'}
                    {c.adminReplyAt ? ` · ${formatCommentDate(c.adminReplyAt)}` : ''}
                  </p>
                  <p className="text-sm text-[#3D3730] whitespace-pre-wrap">{c.adminReply}</p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-[#5A6355]">
                  {c.adminReply ? 'Edit admin reply' : 'Admin reply'}
                </label>
                <textarea
                  value={replyDrafts[c.id] ?? ''}
                  onChange={e => setReplyDrafts(prev => ({ ...prev, [c.id]: e.target.value }))}
                  rows={3}
                  maxLength={1000}
                  placeholder="Write a public reply from the park…"
                  className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => saveReply(c.id)}
                    disabled={savingId === c.id || !(replyDrafts[c.id] || '').trim()}
                    className="flex items-center gap-2 bg-[#5A6355] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3D3730] disabled:opacity-50"
                  >
                    {c.adminReply ? <Save className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                    {savingId === c.id ? 'Saving…' : c.adminReply ? 'Update reply' : 'Post reply'}
                  </button>
                  {c.adminReply && (
                    <button
                      type="button"
                      onClick={() => removeReply(c.id)}
                      disabled={savingId === c.id}
                      className="flex items-center gap-2 border border-[#E2D9D0] text-[#5A6355] px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      Remove reply
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
