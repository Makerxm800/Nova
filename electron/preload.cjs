const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('novaDesktop',{
  chooseFolder:()=>ipcRenderer.invoke('nova:choose-folder'),
  readFolder:(folder)=>ipcRenderer.invoke('nova:read-folder',folder),
  readFile:(file)=>ipcRenderer.invoke('nova:read-file',file),
  onOpenFolder:(callback)=>ipcRenderer.on('nova:open-folder',callback)
});
