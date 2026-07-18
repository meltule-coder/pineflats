import fs from 'fs';
import path from 'path';
import { CustomerComment } from '../types';

const DATA_DIR = path.join(process.cwd(), 'data');
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getComments(): CustomerComment[] {
  ensureDataDir();
  if (!fs.existsSync(COMMENTS_FILE)) {
    fs.writeFileSync(COMMENTS_FILE, '[]');
    return [];
  }
  const list = JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf-8')) as CustomerComment[];
  return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function saveComments(comments: CustomerComment[]) {
  ensureDataDir();
  fs.writeFileSync(COMMENTS_FILE, JSON.stringify(comments, null, 2));
}

function nextCommentId(): string {
  const comments = getComments();
  const numericIds = comments.map(c => Number(c.id)).filter(n => !Number.isNaN(n));
  const max = numericIds.length > 0 ? Math.max(...numericIds) : 0;
  return String(max + 1);
}

export function addComment(data: {
  name: string;
  comment: string;
  rating?: number;
}): CustomerComment {
  const comments = getComments();
  const rating =
    typeof data.rating === 'number' && data.rating >= 1 && data.rating <= 5
      ? Math.round(data.rating)
      : undefined;

  const entry: CustomerComment = {
    id: nextCommentId(),
    name: data.name.trim().slice(0, 80),
    comment: data.comment.trim().slice(0, 1000),
    rating,
    createdAt: new Date().toISOString(),
  };

  comments.unshift(entry);
  saveComments(comments);
  return entry;
}

export function setAdminReply(
  id: string,
  data: { reply: string; adminName?: string }
): CustomerComment | null {
  const comments = getComments();
  const index = comments.findIndex(c => c.id === id);
  if (index === -1) return null;

  const reply = data.reply.trim().slice(0, 1000);
  if (!reply) return null;

  comments[index] = {
    ...comments[index],
    adminReply: reply,
    adminReplyName: (data.adminName || 'Pine Flats').trim().slice(0, 80) || 'Pine Flats',
    adminReplyAt: new Date().toISOString(),
  };
  saveComments(comments);
  return comments[index];
}

export function clearAdminReply(id: string): CustomerComment | null {
  const comments = getComments();
  const index = comments.findIndex(c => c.id === id);
  if (index === -1) return null;

  const { adminReply: _a, adminReplyName: _b, adminReplyAt: _c, ...rest } = comments[index];
  comments[index] = rest as CustomerComment;
  saveComments(comments);
  return comments[index];
}

export function deleteComment(id: string): boolean {
  const comments = getComments();
  const next = comments.filter(c => c.id !== id);
  if (next.length === comments.length) return false;
  saveComments(next);
  return true;
}
