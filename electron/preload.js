const { contextBridge, webUtils, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPathForFile:   (file) => webUtils.getPathForFile(file),
  openFolderDialog: ()     => ipcRenderer.invoke('open-folder-dialog'),
  readFile:         (path) => ipcRenderer.invoke('read-file', path),
  getFileStat:      (path) => ipcRenderer.invoke('get-file-stat', path),
});
