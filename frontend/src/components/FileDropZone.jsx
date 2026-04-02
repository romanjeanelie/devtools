import { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { FolderOpen, Film, FileCode2, ClipboardPaste } from 'lucide-react';

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
  const [svgPreview, setSvgPreview] = useState(null);
  const [svgBg, setSvgBg] = useState('transparent');

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

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const path =
      window.electronAPI?.getPathForFile?.(file) ||
      file.path ||
      '';
    onChange(path || file.name);

    if (file.name.toLowerCase().endsWith('.svg')) {
      const text = await file.text();
      setSvgPreview(text);
    } else {
      setSvgPreview(null);
    }
  }, [onChange]);

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
        onChange(data.path);
        setSvgPreview(trimmed);
      }
    } catch {}
    finally { setPasting(false); }
  }

  const isFolder = value && !value.match(/\.[^/\\]+$/);
  const isSvg = value && value.toLowerCase().endsWith('.svg');
  const hasRealPath = value && (value.startsWith('/') || value.match(/^[A-Z]:\\/));
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
              onClick={() => { onChange(''); setSvgPreview(null); }}
              className="shrink-0 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            >
              <span className="text-[11px] leading-none">✕</span>
            </button>
          )}
        </div>

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
                onClick={() => setSvgBg(bg.key)}
                className={cn(
                  'w-4 h-4 rounded-sm border transition-all',
                  svgBg === bg.key ? 'border-primary scale-110' : 'border-white/20 hover:border-white/50'
                )}
                style={bg.style}
              />
            ))}
          </div>
          {/* SVG render */}
          <div
            className="w-full flex items-center justify-center p-3 [&>svg]:max-w-full [&>svg]:max-h-[176px] [&>svg]:h-auto"
            style={BACKGROUNDS.find(b => b.key === svgBg)?.style}
            dangerouslySetInnerHTML={{ __html: svgPreview }}
          />
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
          {meta.duration > 0 && (
            <span className="text-[11px] font-mono text-muted-foreground">{formatDuration(meta.duration)}</span>
          )}
        </div>
      )}
    </div>
  );
}
