import { Badge } from '@/components/ui/badge';
import { FileIcon, InfoIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

export function FsvInfo() {
  const [file, setFile] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const readFsv = useCallback(async (filePath) => {
    try {
      setError('');
      setInfo(null);

      const arrayBuffer = await window.electronAPI.readFile(filePath);
      const buf = new Uint8Array(arrayBuffer);

      if (buf.length < 12) {
        setError('File too small to be a valid .fsv');
        return;
      }

      const view = new DataView(buf.buffer);
      let manifest;
      let dataSize;
      let manifestSize;

      // Try format 1: manifest at beginning (header: 8 bytes with sizes + manifest)
      const firstU32 = view.getUint32(0, true);
      const secondU32 = view.getUint32(8, true);
      
      if (buf[12] === 0x7b && secondU32 > 0 && secondU32 < buf.length) {
        // Format 1: [dataSize:u32][padding:4][manifestSize:u32][manifest JSON][video data]
        manifestSize = secondU32;
        const manifestBuf = buf.subarray(12, 12 + manifestSize);
        const manifestText = new TextDecoder().decode(manifestBuf);
        try {
          manifest = JSON.parse(manifestText);
          dataSize = buf.length - 12 - manifestSize;
        } catch (parseErr) {
          setError(`Failed to parse manifest JSON (format 1). First 100 chars: ${manifestText.slice(0, 100)}`);
          return;
        }
      } else {
        // Format 2: manifest at end (footer: last 4 bytes = offset)
        const manifestOffset = view.getUint32(buf.length - 4, true);

        if (manifestOffset >= buf.length - 4 || manifestOffset < 0) {
          setError(`Invalid manifest offset: ${manifestOffset} (file size: ${buf.length} bytes). This file may not be a valid .fsv or may be corrupted.`);
          return;
        }

        const manifestBuf = buf.subarray(manifestOffset, buf.length - 4);
        const manifestText = new TextDecoder().decode(manifestBuf);
        
        try {
          manifest = JSON.parse(manifestText);
          dataSize = manifestOffset;
          manifestSize = manifestBuf.length;
        } catch (parseErr) {
          setError(`Failed to parse manifest JSON (format 2). First 100 chars: ${manifestText.slice(0, 100)}`);
          return;
        }
      }

      const stats = await window.electronAPI.getFileStat(filePath);

      setInfo({
        path: filePath,
        size: stats.size,
        sizeKb: stats.sizeKb,
        codec: manifest.config?.codec || manifest.codec || '?',
        width: manifest.config?.codedWidth || manifest.width,
        height: manifest.config?.codedHeight || manifest.height,
        fps: manifest.fps,
        frames: manifest.length || manifest.frames?.length || 0,
        duration: manifest.duration || 0,
        hasAlpha: !!manifest.alphaConfig,
        alphaCodec: manifest.alphaConfig?.codec,
        dataSize,
        manifestSize,
      });
    } catch (e) {
      setError(e.message || 'Failed to parse .fsv file');
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragging(false);
    
    // Try to get file from dataTransfer.files (Electron drag & drop)
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const path = window.electronAPI.getPathForFile(file);
      if (!path.toLowerCase().endsWith('.fsv')) {
        setError('Only .fsv files are supported');
        return;
      }
      setFile(path);
      readFsv(path);
      return;
    }
    
    // Fallback: try text/plain (for compatibility)
    const path = e.dataTransfer.getData('text/plain');
    if (!path) return;
    if (!path.toLowerCase().endsWith('.fsv')) {
      setError('Only .fsv files are supported');
      return;
    }
    setFile(path);
    readFsv(path);
  }, [readFsv]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto">
      <div>
        <h2 className="text-sm font-semibold mb-1">FSV Info</h2>
        <p className="text-xs text-muted-foreground">
          Drag & drop a .fsv file to view its metadata
        </p>
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative border-2 border-dashed rounded-lg p-8 transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50'
        }`}
      >
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <FileIcon className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium">
              {file ? file.split('/').pop() : 'Drop .fsv file here'}
            </p>
            {file && (
              <p className="text-xs text-muted-foreground mt-1 font-mono truncate max-w-md">
                {file}
              </p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
          <InfoIcon className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {info && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <InfoRow label="File size" value={`${info.sizeKb} KB (${(info.size / 1024 / 1024).toFixed(2)} MB)`} />
            <InfoRow label="Codec" value={info.codec} />
            <InfoRow label="Dimensions" value={`${info.width} × ${info.height}`} />
            <InfoRow label="FPS" value={info.fps?.toFixed(2) || '?'} />
            <InfoRow label="Frames" value={info.frames} />
            <InfoRow label="Duration" value={`${info.duration.toFixed(2)} s`} />
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Alpha track:</span>
              <Badge variant={info.hasAlpha ? 'default' : 'outline'} className="text-[10px] py-0 h-4">
                {info.hasAlpha ? 'Yes' : 'No'}
              </Badge>
              {info.hasAlpha && info.alphaCodec && (
                <span className="text-xs text-muted-foreground">({info.alphaCodec})</span>
              )}
            </div>
          </div>

          <div className="border-t border-border pt-3 grid grid-cols-2 gap-3">
            <InfoRow label="Video data" value={`${(info.dataSize / 1024 / 1024).toFixed(2)} MB`} />
            <InfoRow label="Manifest" value={`${(info.manifestSize / 1024).toFixed(2)} KB`} />
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-sm font-mono">{value}</span>
    </div>
  );
}
