import fs from 'fs';
import path from 'path';
import { Photo } from '../types';

const DATA_DIR = path.join(process.cwd(), 'data');
const PHOTOS_FILE = path.join(DATA_DIR, 'photos.json');

const DEFAULT_PHOTOS: Photo[] = [
  { id: '1', url: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&q=80&w=1200', caption: 'Campground Entrance', published: true },
  { id: '2', url: 'https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&q=80&w=1200', caption: 'Lake View Sites', published: true },
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getPhotos(): Photo[] {
  ensureDataDir();
  if (!fs.existsSync(PHOTOS_FILE)) {
    fs.writeFileSync(PHOTOS_FILE, JSON.stringify(DEFAULT_PHOTOS, null, 2));
    return DEFAULT_PHOTOS;
  }
  const photos = JSON.parse(fs.readFileSync(PHOTOS_FILE, 'utf-8')) as Photo[];
  return photos.map(p => ({ ...p, published: p.published !== false }));
}

export function getPublishedPhotos(): Photo[] {
  return getPhotos().filter(p => p.published !== false);
}

export function savePhotos(photos: Photo[]) {
  ensureDataDir();
  fs.writeFileSync(PHOTOS_FILE, JSON.stringify(photos, null, 2));
}

export function nextPhotoId(): string {
  const photos = getPhotos();
  const numericIds = photos
    .map(p => Number(p.id))
    .filter(n => !Number.isNaN(n));
  const max = numericIds.length > 0 ? Math.max(...numericIds) : 0;
  return String(max + 1);
}

export function addPhoto(photo: Omit<Photo, 'id'> & { id?: string }): Photo {
  const photos = getPhotos();
  const newPhoto: Photo = {
    id: photo.id ?? nextPhotoId(),
    url: photo.url,
    caption: photo.caption || 'Park Photo',
    published: photo.published !== false,
  };
  photos.push(newPhoto);
  savePhotos(photos);
  return newPhoto;
}

export function updatePhoto(id: string, updates: Partial<Photo>): Photo | null {
  const photos = getPhotos();
  const index = photos.findIndex(p => p.id === id);
  if (index === -1) return null;
  photos[index] = { ...photos[index], ...updates };
  savePhotos(photos);
  return photos[index];
}

export function deletePhoto(id: string): boolean {
  const photos = getPhotos();
  const next = photos.filter(p => p.id !== id);
  if (next.length === photos.length) return false;
  savePhotos(next);
  return true;
}

export function reorderPhotos(orderedIds: string[]): Photo[] {
  const photos = getPhotos();
  const byId = new Map(photos.map(p => [p.id, p]));
  const reordered: Photo[] = [];
  for (const id of orderedIds) {
    const photo = byId.get(id);
    if (photo) {
      reordered.push(photo);
      byId.delete(id);
    }
  }
  for (const photo of byId.values()) {
    reordered.push(photo);
  }
  savePhotos(reordered);
  return reordered;
}