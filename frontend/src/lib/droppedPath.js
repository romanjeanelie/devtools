/** Resolve a real filesystem path from a drop event. Never return a bare filename. */
export function resolveDroppedFilePath(event, file) {
  try {
    const fromApi = window.electronAPI?.getPathForFile?.(file);
    if (isAbsolutePath(fromApi)) return fromApi;
  } catch {
    // File objects cloned across the context bridge can throw or return "".
  }

  if (isAbsolutePath(file?.path)) return file.path;

  const dt = event?.dataTransfer;
  if (!dt) return '';

  for (const type of ['text/uri-list', 'text/plain']) {
    const raw = dt.getData(type);
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      const path = pathFromDropLine(line);
      if (path) return path;
    }
  }

  return '';
}

function pathFromDropLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return '';

  if (trimmed.startsWith('file:')) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'file:') return '';
      let pathname = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
      return isAbsolutePath(pathname) ? pathname : '';
    } catch {
      return '';
    }
  }

  return isAbsolutePath(trimmed) ? trimmed : '';
}

export function isAbsolutePath(value) {
  return typeof value === 'string' && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value));
}
