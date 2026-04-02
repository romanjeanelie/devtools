const { contextBridge, webUtils, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPathForFile:   (file) => webUtils.getPathForFile(file),
  openFolderDialog: ()     => ipcRenderer.invoke('open-folder-dialog'),
});
