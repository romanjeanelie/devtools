const { contextBridge, webUtils, ipcRenderer } = require('electron');

// File objects passed through contextBridge are structured-cloned and lose their
// disk path. Capture paths from the original drop event in this isolated world.
let lastDropPaths = [];

function resolveFilePath(file) {
  if (!file) return '';
  try {
    const p = webUtils.getPathForFile(file);
    return p || '';
  } catch {
    return '';
  }
}

window.addEventListener(
  'drop',
  (e) => {
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    lastDropPaths = Array.from(files).map((f) => ({
      name: f.name,
      size: f.size,
      lastModified: f.lastModified,
      path: resolveFilePath(f),
    }));
  },
  true
);

contextBridge.exposeInMainWorld('electronAPI', {
  getPathForFile: (file) => {
    const direct = resolveFilePath(file);
    if (direct) return direct;
    if (!file) return '';
    const match = lastDropPaths.find(
      (p) => p.name === file.name && p.size === file.size && p.lastModified === file.lastModified
    );
    return match?.path || '';
  },
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  openInputDialog: (opts) => ipcRenderer.invoke('open-input-dialog', opts),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  getFileStat: (path) => ipcRenderer.invoke('get-file-stat', path),
});
