import { resolveDroppedFilePath, isAbsolutePath } from '@/lib/droppedPath';
import { cn } from '@/lib/utils';
import { FolderOpen, Film, FileCode2, ClipboardPaste } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';

const BACKEND = 'http://localhost:3001';

function formatDuration(sec) {
  if (!sec) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function FileDropZone({ value, onChange, meta, allowPaste, inputType }) {
  const [dragging, setDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pathError, setPathError] = useState('');
  const [svgPreview, setSvgPreview] = useState(null);
  const [previewBg, setPreviewBg] = useState('transparent');
  const [framePreview, setFramePreview] = useState(null);
  const [frameAlpha, setFrameAlpha] = useState(null);
  const [frameError, setFrameError] = useState('');
  const [frameLoading, setFrameLoading] = useState(false);

  const BACKGROUNDS = [
    { key: 'transparent', label: 'Transparent', style: { backgroundImage: 'repeating-conic-gradient(#444 0% 25%, #2a2a2a 0% 50%)', backgroundSize: '10px 10px' } },
    { key: 'white',       label: 'White',       style: { background: '#ffffff' } },
    { key: 'black',       label: 'Black',       style: { background: '#000000' } },
    { key: 'gray',        label: 'Gray',        style: { background: '#888888' } },
  ];

  // Clear preview when value is cleared externally
  useEffect(() => {
    if (!value) setSvgPreview(null);
  }, [value]);

  // Pull the first frame of a video input so transparency can be checked by eye
  useEffect(() => {
    setFrameAlpha(null);
    setFrameError('');
    const isFile = value && value.match(/\.[^/\\]+$/) && !value.toLowerCase().endsWith('.svg');
    if (!isFile || !isAbsolutePath(value)) {
      setFramePreview(null);
      return;
    }

    let cancelled = false;
    let objectUrl = null;
    setFrameLoading(true);
    fetch(`${BACKEND}/frame?path=${encodeURIComponent(value)}&w=480`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Could not read a frame from this file');
        }
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setFramePreview(objectUrl);
      })
      .catch((e) => {
        if (cancelled) return;
        setFramePreview(null);
        setFrameError(e.message);
      })
      .finally(() => { if (!cancelled) setFrameLoading(false); });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [value]);

  // Count transparent pixels in the decoded frame — the honest answer to
  // "does my source really have an alpha channel?"
  function measureAlpha(e) {
    const img = e.currentTarget;
    try {
      const w = Math.min(img.naturalWidth, 200);
      const h = Math.max(1, Math.round(img.naturalHeight * (w / img.naturalWidth)));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let clear = 0;
      let partial = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] === 0) clear++;
        else if (data[i] < 250) partial++;
      }
      const total = data.length / 4;
      setFrameAlpha({ clear: clear / total, partial: partial / total });
    } catch {
      setFrameAlpha(null);
    }
  }

  const applyPath = useCallback(async (path, file) => {
    if (!isAbsolutePath(path)) {
      setPathError('Could not resolve the file path. Use Browse, or drop the file from Finder.');
      return;
    }
    setPathError('');
    onChange(path);

    if (file?.name?.toLowerCase().endsWith('.svg')) {
      const text = await file.text();
      setSvgPreview(text);
    } else if (path.toLowerCase().endsWith('.svg') && window.electronAPI?.readFile) {
      try {
        const buf = await window.electronAPI.readFile(path);
        setSvgPreview(new TextDecoder().decode(buf));
      } catch {
        setSvgPreview(null);
      }
    } else {
      setSvgPreview(null);
    }
  }, [onChange]);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    const path = resolveDroppedFilePath(e, file);
    if (!file && !path) return;
    await applyPath(path, file);
  }, [applyPath]);

  async function handleBrowse() {
    const path = await window.electronAPI?.openInputDialog?.({
      directory: inputType === 'folder',
    });
    if (path) await applyPath(path);
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed.includes('<svg')) return;
      setPasting(true);
      const res = await fetch(`${BACKEND}/save-temp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed, ext: 'svg' }),
      });
      const data = await res.json();
      if (data.path) {
        setPathError('');
        onChange(data.path);
        setSvgPreview(trimmed);
      }
    } catch {}
    finally { setPasting(false); }
  }

  const isFolder = value && !value.match(/\.[^/\\]+$/);
  const isSvg = value && value.toLowerCase().endsWith('.svg');
  const hasRealPath = isAbsolutePath(value);
  const FileIcon = isSvg ? FileCode2 : Film;
  const placeholderText = inputType === 'folder'
    ? 'Drop an image sequence folder here'
    : allowPaste
    ? 'Drop a file or folder here'
    : 'Drop a video file or folder here';

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'flex-1 flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-4 transition-all cursor-default',
            dragging
              ? 'border-primary bg-primary/5'
              : value && hasRealPath
              ? 'border-primary/40 bg-primary/5'
              : 'border-border hover:border-primary/40 hover:bg-accent/30'
          )}
        >
          {value ? (
            isFolder
              ? <FolderOpen className="h-4 w-4 text-primary shrink-0" />
              : <FileIcon className="h-4 w-4 text-primary shrink-0" />
          ) : inputType === 'folder' ? (
            <FolderOpen className="h-4 w-4 text-muted-foreground/40" />
          ) : (
            <div className="flex gap-2 text-muted-foreground/40">
              <FileIcon className="h-4 w-4" />
              <FolderOpen className="h-4 w-4" />
            </div>
          )}

          <span className={cn(
            'flex-1 text-xs truncate',
            value ? 'text-muted-foreground font-mono' : 'text-muted-foreground/50'
          )}>
            {value || placeholderText}
          </span>

          {value && (
            <button
              onClick={() => { onChange(''); setSvgPreview(null); setFramePreview(null); setFrameAlpha(null); setPathError(''); }}
              className="shrink-0 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            >
              <span className="text-[11px] leading-none">✕</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleBrowse}
          title="Browse…"
          className="shrink-0 flex items-center gap-1.5 px-3 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-accent/30 transition-colors"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Browse
        </button>

        {allowPaste && (
          <button
            type="button"
            onClick={handlePaste}
            disabled={pasting}
            title="Paste SVG from clipboard"
            className="shrink-0 flex items-center gap-1.5 px-3 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            Paste SVG
          </button>
        )}
      </div>

      {pathError && (
        <p className="text-[11px] text-destructive px-1">{pathError}</p>
      )}

      {/* SVG preview */}
      {svgPreview && (
        <div className="rounded-lg border border-border overflow-hidden relative" style={{ minHeight: 80, maxHeight: 200 }}>
          {/* Background swatches */}
          <div className="absolute top-2 right-2 z-10 flex gap-1">
            {BACKGROUNDS.map((bg) => (
              <button
                key={bg.key}
                type="button"
                title={bg.label}
                onClick={() => setPreviewBg(bg.key)}
                className={cn(
                  'w-4 h-4 rounded-sm border transition-all',
                  previewBg === bg.key ? 'border-primary scale-110' : 'border-white/20 hover:border-white/50'
                )}
                style={bg.style}
              />
            ))}
          </div>
          {/* SVG render */}
          <div
            className="w-full flex items-center justify-center p-3 [&>svg]:max-w-full [&>svg]:max-h-[176px] [&>svg]:h-auto"
            style={BACKGROUNDS.find(b => b.key === previewBg)?.style}
            dangerouslySetInnerHTML={{ __html: svgPreview }}
          />
        </div>
      )}

      {/* First-frame preview — check the source really is transparent */}
      {(framePreview || frameLoading || frameError) && (
        <div className="rounded-lg border border-border overflow-hidden">
          {frameLoading && (
            <p className="text-[11px] text-muted-foreground px-3 py-2">Reading first frame…</p>
          )}
          {frameError && !frameLoading && (
            <p className="text-[11px] text-muted-foreground px-3 py-2">{frameError}</p>
          )}
          {framePreview && !frameLoading && (
            <>
              <div className="relative">
                <div className="absolute top-2 right-2 z-10 flex gap-1">
                  {BACKGROUNDS.map((bg) => (
                    <button
                      key={bg.key}
                      type="button"
                      title={bg.label}
                      onClick={() => setPreviewBg(bg.key)}
                      className={cn(
                        'w-4 h-4 rounded-sm border transition-all',
                        previewBg === bg.key ? 'border-primary scale-110' : 'border-white/20 hover:border-white/50'
                      )}
                      style={bg.style}
                    />
                  ))}
                </div>
                <div
                  className="w-full flex items-center justify-center p-3"
                  style={BACKGROUNDS.find((b) => b.key === previewBg)?.style}
                >
                  <img
                    src={framePreview}
                    alt="First frame"
                    onLoad={measureAlpha}
                    className="max-h-[200px] w-auto object-contain"
                  />
                </div>
              </div>
              {frameAlpha && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-accent/10">
                  <span className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    frameAlpha.clear > 0.005 ? 'bg-primary' : 'bg-muted-foreground/40'
                  )} />
                  <span className="text-[11px] text-muted-foreground">
                    {frameAlpha.clear > 0.005
                      ? `Transparent background · ${Math.round(frameAlpha.clear * 100)}% of the frame is fully clear`
                      : 'No transparency in this frame — the output will be opaque'}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {meta && (
        <div className="flex items-center gap-2 px-1 flex-wrap">
          {meta.width && meta.height && (
            <span className="text-[11px] font-mono text-muted-foreground">{meta.width}×{meta.height}</span>
          )}
          {meta.fps > 0 && (
            <span className="text-[11px] font-mono text-muted-foreground">{meta.fps} fps</span>
          )}
          {meta.codec && (
            <span className="text-[11px] font-mono text-muted-foreground uppercase">{meta.codec}</span>
          )}
          {meta.pixFmt && (
            <span className="text-[11px] font-mono text-muted-foreground">{meta.pixFmt}</span>
          )}
          {meta.duration > 0 && (
            <span className="text-[11px] font-mono text-muted-foreground">{formatDuration(meta.duration)}</span>
          )}
        </div>
      )}
    </div>
  );
}
