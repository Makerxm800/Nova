'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeImage, protocol, net } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const fss = require('node:fs');

const MAX_ENTRIES = 60000;      // per indexed folder
const MAX_SCAN_ENTRIES = 240000; // whole machine
const MAX_DEPTH = 14;
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '$RECYCLE.BIN', 'System Volume Information',
  'Windows', 'WinSxS', 'AppData', '__pycache__', '.cache', '.venv', 'venv', '.next',
]);

let win = null;

// Serve previews from disk under a private scheme instead of file://, so
// large media streams safely without loosening the renderer's file access.
protocol.registerSchemesAsPrivileged([
  { scheme: 'nova-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#06070c',
    title: 'Nova Search',
    trafficLightPosition: { x: 16, y: 14 },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('nova:window-state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('nova:window-state', { maximized: false }));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
}

function buildMenu() {
  if (process.platform !== 'darwin') return Menu.setApplicationMenu(null);
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Index Folder…', accelerator: 'CmdOrCtrl+O', click: () => win && win.webContents.send('nova:menu', 'index-folder') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { label: 'Focus Search', accelerator: 'CmdOrCtrl+L', click: () => win && win.webContents.send('nova:menu', 'focus-search') },
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: () => win && win.webContents.send('nova:menu', 'palette') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* --------------------------------------------------------------------------
   Drives — the machine, not a folder
   -------------------------------------------------------------------------- */
async function listDrives() {
  try {
    // Electron exposes the OS drive list on Windows.
    if (process.platform === 'win32') {
      const letters = [];
      for (let c = 65; c <= 90; c++) {
        const root = `${String.fromCharCode(c)}:\\`;
        try {
          await fs.access(root);
          letters.push(root);
        } catch {}
      }
      if (letters.length) return letters;
    }
  } catch {}
  try {
    // macOS: /Volumes holds every mounted drive (skip the boot volume link).
    if (process.platform === 'darwin') {
      const vols = await fs.readdir('/Volumes');
      const out = ['/'];
      for (const v of vols) {
        if (!v.startsWith('.')) out.push(path.join('/Volumes', v));
      }
      return out;
    }
  } catch {}
  try {
    if (process.platform === 'linux') {
      const mounts = await fs.readFile('/proc/mounts', 'utf8');
      const seen = new Set();
      for (const line of mounts.split('\n')) {
        const [dev, mount, type] = line.split(' ');
        if (!mount || !dev) continue;
        // Keep the real filesystems, drop the kernel's bookkeeping mounts.
        if (!/^(ext[234]|xfs|btrfs|zfs|f2fs|ntfs|ntfs3|exfat|vfat|hfsplus|apfs|fuseblk|fuse\..*)$/.test(type || '')) continue;
        if (dev === 'tmpfs' || dev === 'none') continue;
        if (seen.has(mount)) continue;
        // System dirs, snap packages and container overlays are not the user's data.
        if (/^\/(dev|sys|proc|run|snap|boot)(\/|$)/.test(mount)) continue;
        if (/^\/(var\/lib\/docker|var\/lib\/containers|tmp)(\/|$)/.test(mount)) continue;
        seen.add(mount);
      }
      if (seen.size) return [...seen];
    }
  } catch {}
  return [os.homedir()];
}

/* --------------------------------------------------------------------------
   Folder scanning
   -------------------------------------------------------------------------- */
async function scanFolder(root) {
  const started = Date.now();
  const entries = [];
  let truncated = false;
  let skipped = 0;

  async function walk(dir, depth) {
    if (truncated || depth > MAX_DEPTH) return;
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      skipped++;
      return;
    }
    const dirs = [];
    for (const dirent of dirents) {
      if (truncated) return;
      if (entries.length >= MAX_ENTRIES) { truncated = true; return; }
      const name = dirent.name;
      if (name === '.' || name === '..') continue;
      const full = path.join(dir, name);
      if (dirent.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        entries.push({ name, path: full, isDir: true, size: 0, modified: 0, ext: '' });
        dirs.push(full);
      } else if (dirent.isFile()) {
        let stat;
        try { stat = await fs.stat(full); } catch { continue; }
        const ext = path.extname(name).slice(1).toLowerCase();
        entries.push({ name, path: full, isDir: false, size: stat.size, modified: stat.mtime.getTime(), ext });
      }
    }
    for (const d of dirs) {
      if (truncated) return;
      await walk(d, depth + 1);
    }
  }

  await walk(root, 0);
  return {
    path: root,
    name: path.basename(root) || root,
    entries,
    truncated,
    skipped,
    took: Date.now() - started,
  };
}

function isImageExt(ext) {
  return /^(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/.test(ext);
}

function makeThumb(file, ext) {
  try {
    const stat = fss.statSync(file);
    if (stat.size > 12 * 1024 * 1024) return '';
    let image;
    if (ext === 'svg') image = nativeImage.createFromPath(file);
    else image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return '';
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    const cropped = image.crop({
      x: Math.max(0, Math.floor((width - side) / 2)),
      y: Math.max(0, Math.floor((height - side) / 2)),
      width: side,
      height: side,
    });
    return cropped.resize({ width: 64, height: 64, quality: 'good' }).toDataURL();
  } catch {
    return '';
  }
}

/* --------------------------------------------------------------------------
   App lifecycle
   -------------------------------------------------------------------------- */
app.whenReady().then(() => {
  protocol.handle('nova-preview', (request) => {
    const target = new URL(request.url).searchParams.get('path') || '';
    return net.fetch('file://' + encodeURI(target.replace(/\\/g, '/')));
  });
  buildMenu();
  createWindow();

  ipcMain.handle('nova:platform', () => ({
    platform: process.platform,
    version: app.getVersion(),
    appVersion: app.getVersion(),
    home: app.getPath('home'),
    desktop: true,
  }));

  ipcMain.handle('nova:pick-folders', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose folders to index',
      buttonLabel: 'Index folders',
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('nova:scan-folder', async (_evt, folder, opts = {}) => {
    try {
      const resolved = path.resolve(String(folder));
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) return { ok: false, error: 'Not a folder' };
      const scan = await scanFolder(resolved);
      if (opts.thumbnails !== false) {
        let made = 0;
        for (const entry of scan.entries) {
          if (made >= 240) break;
          if (entry.isDir || !isImageExt(entry.ext) || entry.size > 12 * 1024 * 1024) continue;
          const thumb = makeThumb(entry.path, entry.ext);
          if (thumb) { entry.thumb = thumb; made++; }
        }
      }
      return { ok: true, ...scan };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle('nova:list-drives', async () => listDrives());

  ipcMain.handle('nova:scan-computer', async (evt, opts = {}) => {
    const started = Date.now();
    const drives = await listDrives();
    const entries = [];
    const roots = [];
    const MAX_TOTAL = Math.min(opts.limit || MAX_SCAN_ENTRIES, MAX_SCAN_ENTRIES);
    for (const drive of drives) {
      if (entries.length >= MAX_TOTAL) break;
      try {
        const st = await fs.stat(drive);
        if (!st.isDirectory()) continue;
      } catch { continue; }
      roots.push(drive);
      try {
        const scan = await scanFolder(drive);
        // Cap each drive so one huge disk cannot starve a second one.
        const room = MAX_TOTAL - entries.length;
        entries.push(...scan.entries.slice(0, room));
        if (evt && evt.sender) {
          evt.sender.send('nova:scan-progress', {
            drive, done: entries.length, total: MAX_TOTAL,
          });
        }
      } catch {}
    }
    return {
      ok: true,
      roots,
      entries: entries.map((e) => ({ ...e, source: 'native' })),
      took: Date.now() - started,
      truncated: entries.length >= MAX_TOTAL,
    };
  });

  ipcMain.handle('nova:read-preview', async (_evt, file, opts = {}) => {
    try {
      const ext = path.extname(file).slice(1).toLowerCase();
      const kind = opts.kind || '';
      const stat = await fs.stat(file);
      const mimeByExt = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
        avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
        mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
        pdf: 'application/pdf',
      };
      const mime = mimeByExt[ext] || 'application/octet-stream';
      const isMedia = /^image\//.test(mime) || /^video\//.test(mime) || /^audio\//.test(mime);
      const isText = /^(txt|md|markdown|mdx|log|nfo|json|jsonc|js|mjs|cjs|ts|tsx|jsx|css|scss|sass|less|html|htm|xml|yml|yaml|toml|ini|cfg|conf|env|sh|bash|zsh|fish|ps1|bat|cmd|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|lua|swift|dart|vue|svelte|astro|sql|csv|tsv|rst|tex|gitignore|editorconfig|makefile|properties)$/.test(ext);

      if (isText && stat.size <= 1024 * 1024) {
        const buf = await fs.readFile(file);
        return { ok: true, kind: 'text', text: buf.toString('utf8'), mime: 'text/plain', size: stat.size, truncated: false };
      }
      // Media up to 32 MB streams straight from disk through the file URL —
      // cheaper than base64 and seekable, so video and long audio play fully.
      // Bigger files still get a file URL; the renderer decides how to present them.
      if (isMedia) {
        return { ok: true, kind: 'media-url', mime, url: file, size: stat.size };
      }
      return { ok: false, reason: 'unsupported', mime, size: stat.size };
    } catch (err) {
      return { ok: false, reason: 'error', error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle('nova:open-path', async (_evt, target) => {
    const error = await shell.openPath(String(target));
    return { ok: !error, error };
  });

  ipcMain.handle('nova:reveal', async (_evt, target) => {
    try {
      shell.showItemInFolder(String(target));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('nova:copy-path', async (_evt, target) => {
    const { clipboard } = require('electron');
    clipboard.writeText(String(target));
    return { ok: true };
  });

  ipcMain.on('nova:win', (evt, action) => {
    const bw = BrowserWindow.fromWebContents(evt.sender);
    if (!bw) return;
    if (action === 'min') bw.minimize();
    else if (action === 'max') bw.isMaximized() ? bw.unmaximize() : bw.maximize();
    else if (action === 'close') bw.close();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
