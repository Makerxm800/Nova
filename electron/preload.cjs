'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nova', {
  isDesktop: true,
  platform: () => ipcRenderer.invoke('nova:platform'),
  pickFolders: () => ipcRenderer.invoke('nova:pick-folders'),
  scanFolder: (folder, opts) => ipcRenderer.invoke('nova:scan-folder', folder, opts),
  listDrives: () => ipcRenderer.invoke('nova:list-drives'),
  scanComputer: (opts) => ipcRenderer.invoke('nova:scan-computer', opts),
  onScanProgress: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on('nova:scan-progress', handler);
    return () => ipcRenderer.removeListener('nova:scan-progress', handler);
  },
  readPreview: (file, opts) => ipcRenderer.invoke('nova:read-preview', file, opts),
  openPath: (target) => ipcRenderer.invoke('nova:open-path', target),
  reveal: (target) => ipcRenderer.invoke('nova:reveal', target),
  copyPath: (target) => ipcRenderer.invoke('nova:copy-path', target),
  window: (action) => ipcRenderer.send('nova:win', action),
  onMenu: (callback) => {
    const handler = (_e, action) => callback(action);
    ipcRenderer.on('nova:menu', handler);
    return () => ipcRenderer.removeListener('nova:menu', handler);
  },
  onWindowState: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on('nova:window-state', handler);
    return () => ipcRenderer.removeListener('nova:window-state', handler);
  },
});
