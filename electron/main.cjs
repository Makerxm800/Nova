const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
let win;
function createWindow() {
  win = new BrowserWindow({width: 1440, height: 940, minWidth: 860, minHeight: 600, title: 'Nova Explorer', backgroundColor: '#101116', show: false, webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  win.loadFile(path.join(__dirname, '../public/index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({url}) => { if (url.startsWith('https:')) shell.openExternal(url); return {action:'deny'}; });
}
app.whenReady().then(() => {
  createWindow();
  const template = [
    {label:'File', submenu:[{label:'Open Folder…', accelerator:'CmdOrCtrl+O', click:()=>win.webContents.send('nova:open-folder')},{type:'separator'},{role:'quit'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'reload'},{role:'toggleDevTools'},{type:'separator'},{role:'togglefullscreen'}]},
    {label:'Window',submenu:[{role:'minimize'},{role:'close'}]},
    {label:'Help',submenu:[{label:'About Nova Explorer',click:()=>dialog.showMessageBox(win,{type:'info',title:'About Nova Explorer',message:'Nova Explorer',detail:`Version ${app.getVersion()}\nA private, local-first desktop file explorer.`})}]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  ipcMain.handle('nova:choose-folder', async () => {const r=await dialog.showOpenDialog(win,{properties:['openDirectory']});return r.canceled?null:r.filePaths[0];});
  ipcMain.handle('nova:read-folder', async (_e, folder) => {
    const base=path.resolve(folder); const entries=await fs.readdir(base,{withFileTypes:true});
    return Promise.all(entries.map(async d=>{const full=path.join(base,d.name);const stat=await fs.stat(full);return {name:d.name,path:full,isDirectory:d.isDirectory(),size:stat.size,modified:stat.mtime.toISOString()};}));
  });
  ipcMain.handle('nova:read-file', async (_e, file) => {const full=path.resolve(file);return (await fs.readFile(full)).toString('base64');});
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
