import { useEffect, useRef, useState } from 'react';
import {
  Upload, Link as LinkIcon, Globe, GlobeLock, Trash2, ChevronUp, ChevronDown,
  ImagePlus, Pencil, Check, X, Video
} from 'lucide-react';
import { Photo } from '../../types';

function isVideo(photo: Photo) {
  return photo.mediaType === 'video';
}

export function PhotosWidget({ onUpdate }: { onUpdate: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addMode, setAddMode] = useState<'upload' | 'url'>('upload');
  const [urlInput, setUrlInput] = useState('');
  const [captionInput, setCaptionInput] = useState('');
  const [urlIsVideo, setUrlIsVideo] = useState(false);
  const [publishOnAdd, setPublishOnAdd] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPhotos = async () => {
    const res = await fetch('/api/photos');
    if (res.ok) setPhotos(await res.json());
  };

  useEffect(() => {
    loadPhotos();
  }, []);

  const handleUpload = async (file: File) => {
    setIsLoading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('photo', file);
      const isVid = file.type.startsWith('video/');
      form.append('caption', captionInput.trim() || (isVid ? 'Park Video' : 'Park Photo'));
      form.append('published', publishOnAdd ? 'true' : 'false');
      const res = await fetch('/api/photos/upload', { method: 'POST', body: form });
      if (res.ok) {
        await loadPhotos();
        onUpdate();
        setCaptionInput('');
        setShowAddForm(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || `Upload failed (${res.status}). Restart the dev server if this persists.`);
      }
    } catch {
      setUploadError('Upload failed — could not reach the server.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUrl = async () => {
    if (!urlInput.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput.trim(),
          caption: captionInput.trim() || (urlIsVideo ? 'Park Video' : 'Park Photo'),
          published: publishOnAdd,
          mediaType: urlIsVideo ? 'video' : 'image',
        }),
      });
      if (res.ok) {
        await loadPhotos();
        onUpdate();
        setUrlInput('');
        setCaptionInput('');
        setUrlIsVideo(false);
        setShowAddForm(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const togglePublished = async (photo: Photo) => {
    const res = await fetch(`/api/photos/${photo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: !photo.published }),
    });
    if (res.ok) {
      await loadPhotos();
      onUpdate();
    }
  };

  const saveCaption = async (id: string) => {
    const res = await fetch(`/api/photos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: editCaption.trim() || 'Park media' }),
    });
    if (res.ok) {
      await loadPhotos();
      onUpdate();
      setEditingId(null);
    }
  };

  const removePhoto = async (id: string) => {
    if (!confirm('Remove this item from the library?')) return;
    const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadPhotos();
      onUpdate();
    }
  };

  const movePhoto = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    const orderedIds = photos.map(p => p.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    const res = await fetch('/api/photos/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
    if (res.ok) {
      await loadPhotos();
      onUpdate();
    }
  };

  const publishedCount = photos.filter(p => p.published !== false).length;
  const videoCount = photos.filter(p => isVideo(p)).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-serif text-[#3D3730]">Website Photos &amp; Videos</h2>
          <p className="text-sm text-[#5A6355] mt-1">
            {publishedCount} of {photos.length} item{photos.length === 1 ? '' : 's'} live
            {videoCount > 0 ? ` · ${videoCount} video${videoCount === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(v => !v)}
          className="flex items-center gap-2 bg-[#C29474] text-white rounded-xl px-4 py-2 text-sm font-semibold shadow-lg shadow-black/10 transition-transform active:scale-95"
        >
          <ImagePlus className="w-4 h-4" />
          Add Media
        </button>
      </div>

      {uploadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {uploadError}
        </div>
      )}

      {showAddForm && (
        <div className="bg-white rounded-[32px] border border-[#E2D9D0] p-6 shadow-sm space-y-5">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setAddMode('upload')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition ${
                addMode === 'upload' ? 'bg-[#5A6355] text-white' : 'bg-[#FBF9F7] text-[#5A6355] border border-[#E2D9D0]'
              }`}
            >
              <Upload className="w-4 h-4" />
              Upload File
            </button>
            <button
              onClick={() => setAddMode('url')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition ${
                addMode === 'url' ? 'bg-[#5A6355] text-white' : 'bg-[#FBF9F7] text-[#5A6355] border border-[#E2D9D0]'
              }`}
            >
              <LinkIcon className="w-4 h-4" />
              Media URL
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-[#5A6355]">Caption</label>
            <input
              value={captionInput}
              onChange={e => setCaptionInput(e.target.value)}
              placeholder="e.g. Park tour, Main entrance"
              className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-[#5A6355] cursor-pointer">
            <input
              type="checkbox"
              checked={publishOnAdd}
              onChange={e => setPublishOnAdd(e.target.checked)}
              className="rounded border-[#E2D9D0] text-[#C29474] focus:ring-[#5A6355]"
            />
            Publish to website immediately
          </label>

          {addMode === 'upload' ? (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime,video/ogg"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
                className="block w-full text-sm text-[#5A6355] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-[#EDE7E1] file:text-[#3D3730] file:font-medium hover:file:bg-[#E2D9D0]"
              />
              <p className="text-xs text-[#5A6355]">
                Photos: JPG, PNG, WebP up to 10 MB. Videos: MP4, WebM, MOV up to 100 MB.
                First published <strong>photo</strong> is the hero banner (videos appear in the gallery).
              </p>
              {isLoading && <p className="text-xs text-[#C29474]">Uploading… large videos may take a moment.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="https://example.com/video.mp4 or image URL"
                className="w-full px-4 py-3 bg-[#FBF9F7] border border-[#E2D9D0] rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
              />
              <label className="flex items-center gap-2 text-sm text-[#5A6355] cursor-pointer">
                <input
                  type="checkbox"
                  checked={urlIsVideo}
                  onChange={e => setUrlIsVideo(e.target.checked)}
                  className="rounded border-[#E2D9D0]"
                />
                This URL is a video file (mp4/webm)
              </label>
              <button
                onClick={handleAddUrl}
                disabled={isLoading || !urlInput.trim()}
                className="bg-[#C29474] text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
              >
                Add from URL
              </button>
            </div>
          )}
        </div>
      )}

      <div className="bg-[#5A6355] text-[#F7F3F0] rounded-[32px] p-6 shadow-sm">
        <p className="text-xs text-[#F7F3F0]/70 mb-4">
          Use arrows to reorder. The first published photo is the hero banner. Videos show in the “Our Park” gallery.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {photos.map((p, index) => {
            const isPublished = p.published !== false;
            const isEditing = editingId === p.id;
            const publishedImages = photos.filter(x => x.published !== false && !isVideo(x));
            const isHero = isPublished && !isVideo(p) && publishedImages[0]?.id === p.id;
            const video = isVideo(p);

            return (
              <div
                key={p.id}
                className={`group relative bg-[#F7F3F0] rounded-[24px] overflow-hidden border ${
                  isPublished ? 'border-[#C29474]/50' : 'border-white/20 opacity-80'
                }`}
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-black/20 relative">
                  {video ? (
                    <video
                      src={p.url}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                      controls
                    />
                  ) : (
                    <img
                      src={p.url}
                      alt={p.caption}
                      className="w-full h-full object-cover"
                    />
                  )}
                  <div className="absolute top-2 left-2 flex flex-col gap-1">
                    {isHero && (
                      <span className="text-[10px] uppercase tracking-wider bg-[#C29474] text-white px-2 py-1 rounded-full font-semibold">
                        Hero
                      </span>
                    )}
                    {video && (
                      <span className="text-[10px] uppercase tracking-wider bg-[#3D3730] text-white px-2 py-1 rounded-full font-semibold flex items-center gap-1 w-fit">
                        <Video className="w-3 h-3" /> Video
                      </span>
                    )}
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full font-semibold ${
                      isPublished ? 'bg-[#3D5A3D] text-white' : 'bg-black/50 text-white'
                    }`}>
                      {isPublished ? 'Live' : 'Hidden'}
                    </span>
                  </div>
                </div>

                <div className="p-4 text-[#3D3730] space-y-3">
                  {isEditing ? (
                    <div className="flex gap-2">
                      <input
                        value={editCaption}
                        onChange={e => setEditCaption(e.target.value)}
                        className="flex-1 px-3 py-2 bg-white border border-[#E2D9D0] rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#5A6355]"
                        autoFocus
                      />
                      <button onClick={() => saveCaption(p.id)} className="p-2 rounded-xl bg-[#5A6355] text-white">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-2 rounded-xl border border-[#E2D9D0]">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{p.caption}</p>
                      <button
                        onClick={() => { setEditingId(p.id); setEditCaption(p.caption); }}
                        className="p-1.5 rounded-lg hover:bg-white/60 text-[#5A6355] shrink-0"
                        aria-label="Edit caption"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => togglePublished(p)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                        isPublished
                          ? 'bg-[#EDE7E1] text-[#5A6355] hover:bg-[#E2D9D0]'
                          : 'bg-[#C29474] text-white hover:bg-[#A87A5C]'
                      }`}
                    >
                      {isPublished ? <GlobeLock className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
                      {isPublished ? 'Unpublish' : 'Publish'}
                    </button>
                    <button
                      onClick={() => movePhoto(index, -1)}
                      disabled={index === 0}
                      className="p-1.5 rounded-xl border border-[#E2D9D0] hover:bg-white disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => movePhoto(index, 1)}
                      disabled={index === photos.length - 1}
                      className="p-1.5 rounded-xl border border-[#E2D9D0] hover:bg-white disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removePhoto(p.id)}
                      className="p-1.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 ml-auto"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {photos.length === 0 && (
            <div className="col-span-full py-12 text-center text-sm text-[#F7F3F0]/60">
              No media yet. Add your first park photo or video above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
