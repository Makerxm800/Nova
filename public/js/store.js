/* =========================================================================
   NOVA SEARCH — store.js
   Local-first persistence: settings, pins, history, saved searches, demo
   library and a tiny IndexedDB wrapper for native file previews.
   ========================================================================= */
(function () {
  'use strict';
  const NS = window.Nova;
  const { el } = NS.util;

  /* ---------------------------- tiny IDB ---------------------------------- */
  const DB_NAME = 'nova-search';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return dbPromise;
  }

  async function idbPut(store, key, value) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch { resolve(false); }
    });
  }

  async function idbGet(store, key) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  async function idbDel(store, key) {
    const db = await openDB();
    if (!db) return;
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
    } catch {}
  }

  async function idbClear(store) {
    const db = await openDB();
    if (!db) return;
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
    } catch {}
  }

  /* ---------------------------- demo library ------------------------------ */
  const D = 'assets/demo/';
  const demo = [
    {
      name: 'aurora-over-the-fjord.jpg', dir: 'Demo Studio\\Travel\\Iceland', root: 'Demo Studio',
      size: 8_412_880, modified: '2026-10-28T19:42:00Z', kind: 'image', starred: true, pinned: true,
      tags: ['aurora', 'night', 'fjord', 'wallpaper', 'iceland'], thumb: D + 'aurora.jpg',
      meta: { width: 3840, height: 2160, camera: 'Sony A7R V', iso: 'ISO 3200', lens: '24mm f/1.4' },
      badge: { text: '8K ready', tone: 'violet' },
    },
    {
      name: 'neon-district-at-night.jpg', dir: 'Demo Studio\\Travel\\Tokyo', root: 'Demo Studio',
      size: 6_201_440, modified: '2026-10-22T23:12:00Z', kind: 'image',
      tags: ['tokyo', 'neon', 'city', 'rain', 'night'], thumb: D + 'neon-city.jpg',
      meta: { width: 3200, height: 2133, camera: 'Fujifilm X-T5', iso: 'ISO 1600', lens: '35mm f/2' },
    },
    {
      name: 'iridescent-orb-render.jpg', dir: 'Demo Studio\\Design\\3D', root: 'Demo Studio',
      size: 3_144_960, modified: '2026-11-09T14:05:00Z', kind: 'image', starred: true,
      tags: ['render', 'glass', 'orb', 'abstract'], thumb: D + 'orb.jpg',
      meta: { width: 2560, height: 1600, engine: 'Cycles', samples: 2048 },
      badge: { text: 'New', tone: 'cyan' },
    },
    {
      name: 'Glacier Lagoon — B-Roll.mp4', dir: 'Demo Studio\\Travel\\Iceland', root: 'Demo Studio',
      size: 438_362_112, modified: '2026-10-27T10:18:00Z', kind: 'video',
      tags: ['drone', 'b-roll', 'glacier', '4k'], thumb: D + 'aurora.jpg',
      meta: { width: 3840, height: 2160, duration: 92, codec: 'HEVC', fps: 30, bitrate: '38 Mbps' },
      badge: { text: '4K 60', tone: 'violet' },
    },
    {
      name: 'midnight-stroll-teaser.mov', dir: 'Demo Studio\\Travel\\Tokyo', root: 'Demo Studio',
      size: 182_452_224, modified: '2026-10-23T21:30:00Z', kind: 'video',
      tags: ['teaser', 'cinematic', 'rain'], thumb: D + 'neon-city.jpg',
      meta: { width: 1920, height: 1080, duration: 34, codec: 'ProRes 422', fps: 24 },
    },
    {
      name: 'nova-theme-ambient.wav', dir: 'Demo Studio\\Audio\\Loops', root: 'Demo Studio',
      size: 512_044, modified: '2026-11-02T08:40:00Z', kind: 'audio', starred: true,
      tags: ['ambient', 'loop', 'pad', 'theme'], thumb: D + 'orb.jpg',
      meta: { duration: 16, artist: 'Nova Sound Lab', album: 'Interface Sketches', sampleRate: '16 kHz mono' },
      badge: { text: 'Loop', tone: 'green' },
    },
    {
      name: 'aurora — field recording.wav', dir: 'Demo Studio\\Audio\\Field', root: 'Demo Studio',
      size: 26_611_712, modified: '2026-09-14T03:05:00Z', kind: 'audio',
      tags: ['field', 'nature', 'wind'], meta: { duration: 421, artist: 'Nova Sound Lab', album: 'North', sampleRate: '48 kHz / 24-bit' },
    },
    {
      name: 'NOVA — Brand Guidelines.pdf', dir: 'Demo Studio\\Docs\\Brand', root: 'Demo Studio',
      size: 4_882_176, modified: '2026-11-06T16:21:00Z', kind: 'pdf', starred: true, pinned: true,
      tags: ['brand', 'guidelines', 'design system', 'logo'], thumb: D + 'orb.jpg',
      url: 'assets/examples/brand-guidelines.pdf',
      content: 'NOVA — BRAND GUIDELINES\n\n01 The mark\n   The Nova star is an eight-point spark drawn on a 24px grid.\n   Minimum size: 16px. Clear space: 25% of the mark.\n\n02 Colour\n   Violet 500  #8b5cf6   primary\n   Aqua 400    #22d3ee   glow\n   Ink 900     #08090d   canvas\n   Mist 100    #e6e8f0   text\n\n03 Type\n   Display: Space Grotesk, tight tracking, -2%\n   Text: Inter, 400/500, generous leading\n   Mono: JetBrains Mono for paths and shortcuts\n\n04 Voice\n   Quietly confident. Signal over noise.\n',
      meta: { pages: 24, author: 'Studio Nova', format: 'PDF 1.7' },
      badge: { text: 'Pinned', tone: 'violet' },
    },
    {
      name: 'indexing-pipeline.design.md', dir: 'Demo Studio\\Docs\\Design', root: 'Demo Studio',
      size: 6_882, modified: '2026-11-11T12:04:00Z', kind: 'doc', starred: true,
      tags: ['architecture', 'spec', 'search', 'design'],
      content: '# Indexing pipeline — design notes\n\nSearch is a loop, not a page.\n\n## Stages\n1. **Discover** — walk roots, expand archives lazily.\n2. **Extract** — filename, folder, extension, format family, tags.\n3. **Normalise** — lowercase, strip separators, fold accents.\n4. **Rank** — tiered match quality × field weights × freshness × favourites.\n5. **Render** — progressive results every 120ms so typing always feels instant.\n\n## Match tiers\n| tier | example | weight |\n| ---- | ------- | ------ |\n| exact | `aurora` | 120 |\n| prefix | `aur` | 92 |\n| word boundary | `over` | 74 |\n| substring | `ridg` | 52 |\n| subsequence | `nrdstr` | 26 |\n\n## Why tiers work\nTiers behave like a person remembering a name: the first syllable matters\nmore than scattered letters. Fuzzy matching only rescues a query when the\nstrict tiers find nothing, so results never feel noisy.\n\n## Performance targets\n- 50 000 entries, cold query: < 30ms\n- keystroke to first paint: < 16ms\n- zero network calls. ever.\n',
      meta: { words: 148, format: 'Markdown' },
    },
    {
      name: 'Q4-roadmap-2026.xlsx', dir: 'Demo Studio\\Docs\\Planning', root: 'Demo Studio',
      size: 298_188, modified: '2026-11-12T09:14:00Z', kind: 'sheet',
      tags: ['roadmap', 'planning', 'q4', 'okr'],
      content: 'Quarter,Workstream,Owner,Status,Progress\nQ4,Search quality,Ana,On track,72%\nQ4,Folder indexing,Maker,On track,64%\nQ4,Quick Look refresh,Jo,In review,88%\nQ1,Ask Nova (local),Ana,Planned,0%\nQ1,Cloud-less sync,Rai,Planned,0%\n',
      meta: { sheets: 3, rows: 42, author: 'Maker' },
      badge: { text: 'Edited today', tone: 'green' },
    },
    {
      name: 'solar-farm-output.csv', dir: 'Demo Studio\\Docs\\Data', root: 'Demo Studio',
      size: 1_486_112, modified: '2026-10-30T07:52:00Z', kind: 'sheet',
      tags: ['energy', 'solar', 'dataset', 'csv'],
      content: 'date,site,output_mwh,capacity_mw,efficiency\n2026-10-01,Atacama,412.8,180,0.94\n2026-10-02,Atacama,438.1,180,0.97\n2026-10-03,Atacama,301.4,180,0.71\n2026-10-01,Mojave,188.2,96,0.86\n2026-10-02,Mojave,201.9,96,0.91\n2026-10-03,Mojave,193.7,96,0.88\n',
      meta: { rows: 24118, columns: 5 },
    },
    {
      name: 'Launch-keynote-final.pptx', dir: 'Demo Studio\\Docs\\Brand', root: 'Demo Studio',
      size: 18_022_912, modified: '2026-11-10T18:44:00Z', kind: 'slide',
      tags: ['keynote', 'launch', 'deck'], thumb: D + 'neon-city.jpg',
      content: 'Slide 1 — Nova launch\n  "Search that feels like thinking."\n\nSlide 2 — The problem\n  Explorer hides your things behind a tree.\n\nSlide 3 — The idea\n  One field. Every format. Zero cloud.\n\nSlide 4 — Live demo\n  Type "aur" → results before the pixel lands.\n\nSlide 5 — Ship it\n  Windows. macOS. Linux. Today.\n',
      meta: { slides: 18, author: 'Studio Nova', format: '16:9' },
    },
    {
      name: 'nebula-gradient.svg', dir: 'Demo Studio\\Design\\Assets', root: 'Demo Studio',
      size: 24_576, modified: '2026-11-05T12:12:00Z', kind: 'image', starred: true,
      tags: ['svg', 'gradient', 'asset', 'logo'], color: '#8b5cf6',
      content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">\n  <defs>\n    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">\n      <stop offset="0" stop-color="#8b5cf6"/>\n      <stop offset="0.5" stop-color="#22d3ee"/>\n      <stop offset="1" stop-color="#f472b6"/>\n    </linearGradient>\n  </defs>\n  <rect width="640" height="400" fill="#0b0c12"/>\n  <circle cx="320" cy="200" r="150" fill="url(#g)" opacity="0.9"/>\n</svg>',
      meta: { width: 640, height: 400, format: 'SVG' },
    },
    {
      name: 'poster-aurora-print.ai', dir: 'Demo Studio\\Design\\Posters', root: 'Demo Studio',
      size: 88_412_160, modified: '2026-10-19T22:10:00Z', kind: 'design',
      tags: ['poster', 'print', 'CMYK'], thumb: D + 'aurora.jpg',
      meta: { artboards: 2, colorMode: 'CMYK', format: 'Adobe Illustrator' },
    },
    {
      name: 'orb-render.blend', dir: 'Demo Studio\\Design\\3D', root: 'Demo Studio',
      size: 214_882_304, modified: '2026-11-09T13:59:00Z', kind: 'design',
      tags: ['blender', 'scene', '3d'], thumb: D + 'orb.jpg',
      meta: { version: 'Blender 4.3', objects: 42, format: '.blend' },
    },
    {
      name: 'nova-space-grotesk.woff2', dir: 'Demo Studio\\Design\\Fonts', root: 'Demo Studio',
      size: 22_288, modified: '2026-10-02T11:00:00Z', kind: 'font',
      tags: ['typeface', 'variable', 'display'],
      meta: { family: 'Space Grotesk', weights: '300–700 variable', format: 'WOFF2' },
    },
    {
      name: 'search-engine.ts', dir: 'Demo Studio\\Code\\nova', root: 'Demo Studio',
      size: 21_402, modified: '2026-11-12T08:22:00Z', kind: 'code', starred: true,
      tags: ['typescript', 'ranking', 'source'],
      content: "// Tiered fuzzy matcher — the heart of Nova Search\n\nexport type Tier = 0 | 1 | 2 | 3 | 4;\nexport interface Hit {\n  score: number;\n  tier: Tier;\n  indices: number[];\n}\n\nconst TIER_WEIGHT = [120, 92, 74, 52, 26];\n\n/**\n * Score a candidate string against a query.\n * Returns null when the string contains none of the query characters.\n */\nexport function score(candidate: string, query: string): Hit | null {\n  const hay = candidate.toLowerCase();\n  const needle = query.toLowerCase();\n  if (!needle) return { score: 0, tier: 4, indices: [] };\n\n  const exact = hay.indexOf(needle);\n  if (exact === 0 && hay.length === needle.length) {\n    return { score: TIER_WEIGHT[0] + hay.length, tier: 0, indices: range(0, needle.length) };\n  }\n\n  let best: Hit | null = null;\n  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {\n    const boundary = i === 0 || /[\\s._\\-()\\[\\]]/.test(hay[i - 1]);\n    const tier: Tier = i === 0 ? 1 : boundary ? 2 : 3;\n    const hit = { score: TIER_WEIGHT[tier] - i * 0.35 - (hay.length - needle.length) * 0.06, tier, indices: range(i, needle.length) };\n    if (!best || hit.score > best.score) best = hit;\n  }\n  return best ?? subsequence(hay, needle);\n}\n\nfunction subsequence(hay: string, needle: string): Hit | null {\n  const indices: number[] = [];\n  let j = 0;\n  for (let i = 0; i < hay.length && j < needle.length; i++) {\n    if (hay[i] === needle[j]) { indices.push(i); j++; }\n  }\n  if (j < needle.length) return null;\n  return { score: TIER_WEIGHT[4] - indices.length * 0.4, tier: 4, indices };\n}\n\nconst range = (start: number, len: number) =>\n  Array.from({ length: len }, (_, k) => start + k);\n",
      meta: { language: 'TypeScript', lines: 48, encoding: 'UTF-8' },
    },
    {
      name: 'App.tsx', dir: 'Demo Studio\\Code\\nova', root: 'Demo Studio',
      size: 14_882, modified: '2026-11-12T08:31:00Z', kind: 'code',
      tags: ['react', 'ui', 'source'],
      content: "import { useMemo, useState } from 'react';\nimport { score } from './search-engine';\n\nexport function SearchField({ index }: { index: Entry[] }) {\n  const [query, setQuery] = useState('');\n  const hits = useMemo(\n    () => index\n      .map((entry) => ({ entry, hit: score(entry.name, query) }))\n      .filter((r) => r.hit)\n      .sort((a, b) => b.hit!.score - a.hit!.score)\n      .slice(0, 60),\n    [query, index],\n  );\n\n  return (\n    <div className=\"field\">\n      <input\n        autoFocus\n        value={query}\n        onChange={(e) => setQuery(e.target.value)}\n        placeholder=\"Search every file, every folder…\"\n      />\n      <ul>{hits.map(({ entry }) => <li key={entry.id}>{entry.name}</li>)}</ul>\n    </div>\n  );\n}\n",
      meta: { language: 'TSX', lines: 28, encoding: 'UTF-8' },
    },
    {
      name: 'README.md', dir: 'Demo Studio\\Code\\nova', root: 'Demo Studio',
      size: 3_240, modified: '2026-11-11T10:18:00Z', kind: 'doc',
      tags: ['readme', 'docs', 'install'],
      content: '# Nova Search\n\nA private, local-first universal search for your computer.\n\n```sh\nnpm install\nnpm start        # desktop app\ndev/index.html   # browser edition, no install\n```\n\nNova indexes file **names, folders, formats and tags**. Text files are\npreviewed in place; media gets artwork; binaries get an honest card.\n\nNothing leaves your machine. There is no server, no account and no telemetry.\n\n## Shortcuts\n\n| keys | action |\n| ---- | ------ |\n| `⌘K` / `Ctrl K` | command palette |\n| `/` | focus search |\n| `↑` `↓` | move through results |\n| `↵` | open preview |\n| `space` | peek |\n| `esc` | close |\n',
      meta: { words: 84, format: 'Markdown' },
    },
    {
      name: 'search-engine.test.ts', dir: 'Demo Studio\\Code\\nova\\tests', root: 'Demo Studio',
      size: 8_112, modified: '2026-11-12T08:40:00Z', kind: 'code',
      tags: ['tests', 'vitest'],
      content: "import { describe, expect, it } from 'vitest';\nimport { score } from '../search-engine';\n\ndescribe('tiered matching', () => {\n  it('ranks exact names above fuzzy hits', () => {\n    const exact = score('aurora.jpg', 'aurora')!;\n    const fuzzy = score('calendar-notes.txt', 'aurora')!;\n    expect(exact.score).toBeGreaterThan(fuzzy.score);\n  });\n\n  it('finds subsequences as a last resort', () => {\n    expect(score('nova-render.design.md', 'nrdstr')).not.toBeNull();\n  });\n\n  it('never returns a hit for missing characters', () => {\n    expect(score('aurora.jpg', 'zzz')).toBeNull();\n  });\n});\n",
      meta: { language: 'TypeScript', lines: 20, encoding: 'UTF-8' },
    },
    {
      name: 'main.cjs', dir: 'Demo Studio\\Code\\nova\\electron', root: 'Demo Studio',
      size: 6_144, modified: '2026-11-10T19:02:00Z', kind: 'code',
      tags: ['electron', 'desktop', 'shell'],
      content: "const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');\nconst path = require('node:path');\n\nfunction createWindow() {\n  const win = new BrowserWindow({\n    width: 1360, height: 900, minWidth: 940, minHeight: 620,\n    titleBarStyle: 'hiddenInset',\n    backgroundColor: '#08090d',\n    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },\n  });\n  win.loadFile(path.join(__dirname, '..', 'public', 'index.html'));\n  win.webContents.setWindowOpenHandler(({ url }) => {\n    if (url.startsWith('https:')) shell.openExternal(url);\n    return { action: 'deny' };\n  });\n}\n\napp.whenReady().then(() => {\n  nativeTheme.themeSource = 'dark';\n  createWindow();\n  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());\n});\n\nipcMain.handle('nova:platform', () => ({ platform: process.platform, version: app.getVersion() }));\n",
      meta: { language: 'JavaScript', lines: 27, encoding: 'UTF-8' },
    },
    {
      name: 'manifest.json', dir: 'Demo Studio\\Code\\nova', root: 'Demo Studio',
      size: 1_012, modified: '2026-11-01T09:24:00Z', kind: 'data',
      tags: ['json', 'config', 'manifest'],
      content: '{\n  "name": "nova-search",\n  "version": "2.0.0",\n  "private": true,\n  "description": "Local-first universal file search",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "test": "vitest run"\n  },\n  "dependencies": {\n    "react": "^19.0.0"\n  }\n}\n',
      meta: { format: 'JSON', entries: 12 },
    },
    {
      name: 'indexer-notes.txt', dir: 'Demo Studio\\Docs\\Design', root: 'Demo Studio',
      size: 2_204, modified: '2026-11-12T07:42:00Z', kind: 'text',
      tags: ['notes', 'todo', 'indexing'],
      content: 'INDEXER NOTES — working file\n\n[x] Normaliser strips case, separators and accents\n[x] Format families cover 180+ extensions\n[x] Tier weights tuned against a 20k filename corpus\n[ ] Try trigram prefilter for >200k entries\n[ ] Ask Nova: natural-language queries ("aurora photos from iceland")\n\nReminder: the search field should never block the keystroke.\nEvery frame budget matters more than clever code.\n',
      meta: { words: 57, format: 'Plain text' },
    },
    {
      name: 'logo-explorations.fig', dir: 'Demo Studio\\Design\\Brand', root: 'Demo Studio',
      size: 12_582_912, modified: '2026-10-15T14:38:00Z', kind: 'design', starred: true,
      tags: ['figma', 'logo', 'brand'], thumb: D + 'orb.jpg',
      meta: { pages: 4, frames: 18, format: 'Figma' },
    },
    {
      name: 'archive-2025.zip', dir: 'Demo Studio\\Archive', root: 'Demo Studio',
      size: 2_147_483_648, modified: '2026-01-06T00:10:00Z', kind: 'archive',
      tags: ['backup', '2025', 'zip'],
      meta: { entries: 18422, method: 'Deflate', format: 'ZIP' },
    },
    {
      name: 'setup-nova-2.0.exe', dir: 'Nova Library\\Downloads', root: 'Nova Library',
      size: 132_120_576, modified: '2026-11-08T11:02:00Z', kind: 'exec',
      tags: ['installer', 'windows', 'release'],
      meta: { version: '2.0.0', signed: 'EV certificate', platform: 'Windows x64' },
    },
    {
      name: 'Screen Capture — 2026-11-11 20.14.png', dir: 'Nova Library\\Screenshots', root: 'Nova Library',
      size: 4_882_176, modified: '2026-11-11T20:14:00Z', kind: 'image',
      tags: ['screenshot', 'ui', 'bug'], thumb: D + 'neon-city.jpg',
      meta: { width: 2560, height: 1440, display: 'Retina 5K' },
    },
    {
      name: 'meeting-notes-2026-11-12.md', dir: 'Nova Library\\Work', root: 'Nova Library',
      size: 4_012, modified: '2026-11-12T15:32:00Z', kind: 'doc', starred: true,
      tags: ['meeting', 'notes', 'product'],
      content: '# Product sync — Nov 12\n\n**Present:** Ana, Maker, Jo, Rai\n\n## Decisions\n- Ship the tiered matcher; postpone query language to 2.1.\n- Quick Look keeps the filmstrip.\n- No cloud. Ever. Publish the privacy note with the release.\n\n## Actions\n- [ ] Ana — benchmark 50k entries on the 2019 laptop\n- [ ] Maker — index folders through the desktop bridge\n- [ ] Jo — motion pass on the results rail\n- [ ] Rai — archive format registry table for the docs\n\nNext sync: Nov 19, 10:00.\n',
      meta: { words: 71, format: 'Markdown' },
    },
    {
      name: 'weather-batch-0724.json', dir: 'Nova Library\\Work', root: 'Nova Library',
      size: 18_402, modified: '2026-10-04T13:18:00Z', kind: 'data',
      tags: ['json', 'weather', 'api', 'sample'],
      content: '{\n  "station": "CYUL",\n  "city": "Montréal",\n  "readings": [\n    { "time": "2026-07-24T09:00", "tempC": 21.4, "humidity": 63, "windKph": 12 },\n    { "time": "2026-07-24T12:00", "tempC": 26.8, "humidity": 51, "windKph": 18 },\n    { "time": "2026-07-24T15:00", "tempC": 28.1, "humidity": 48, "windKph": 22 },\n    { "time": "2026-07-24T18:00", "tempC": 24.6, "humidity": 57, "windKph": 14 }\n  ]\n}\n',
      meta: { entries: 4, format: 'JSON' },
    },
    {
      name: 'press-kit-logos.zip', dir: 'Nova Library\\Downloads', root: 'Nova Library',
      size: 48_882_176, modified: '2026-10-24T17:26:00Z', kind: 'archive',
      tags: ['press', 'logos', 'svg', 'png'],
      meta: { entries: 32, method: 'Deflate', format: 'ZIP' },
    },
    {
      name: 'Nova Sans Display.ttf', dir: 'Nova Library\\Fonts', root: 'Nova Library',
      size: 384_012, modified: '2026-09-02T09:44:00Z', kind: 'font',
      tags: ['typeface', 'display', 'ttf'],
      meta: { family: 'Nova Sans', weights: 'Black + Italic', format: 'TrueType' },
    },
    {
      name: 'system-report-2026.pdf', dir: 'Nova Library\\Work\\Reports', root: 'Nova Library',
      size: 12_582_912, modified: '2026-10-31T08:12:00Z', kind: 'pdf',
      tags: ['report', 'pdf', 'quarterly'],
      content: 'SYSTEM REPORT — Q3 2026\n\nIndex health              99.4% uptime\nEntries scanned           1,284,220\nFormats recognised        184\nAverage query time        11.2 ms\nLargest preview served    412 MB video\n\nNotes\n- Archive scanning moved off the main thread.\n- Font previews now render real glyphs.\n- Text previews cap at 1 MB and stream from disk.\n',
      meta: { pages: 12, author: 'Nova Diagnostics', format: 'PDF 1.7' },
    },
    {
      name: 'backup-loop.sh', dir: 'Nova Library\\Scripts', root: 'Nova Library',
      size: 1_024, modified: '2026-08-18T23:02:00Z', kind: 'code',
      tags: ['shell', 'backup', 'rsync'],
      content: '#!/usr/bin/env bash\nset -euo pipefail\n\nSRC="${HOME}/Projects"\nDEST="/Volumes/Archive/nova-$(date +%F)"\n\nmkdir -p "$DEST"\nrsync -a --delete --info=progress2 "$SRC/" "$DEST/"\necho "— backup complete: $DEST"\n',
      meta: { language: 'Shell', lines: 10, encoding: 'UTF-8' },
    },
    {
      name: 'wallpaper-pack-preview.png', dir: 'Nova Library\\Screenshots\\Wallpapers', root: 'Nova Library',
      size: 12_882_176, modified: '2026-10-20T18:30:00Z', kind: 'image', starred: true,
      tags: ['wallpaper', 'pack', 'preview'], thumb: D + 'aurora.jpg',
      meta: { width: 5120, height: 2880, bitDepth: '10-bit' },
    },
  ];

  function seedEntries() {
    const now = Date.now();
    return demo.map((d, i) => {
      const ext = d.name.includes('.') ? d.name.split('.').pop().toLowerCase() : '';
      const desc = NS.describe(d.name);
      return {
        id: `demo-${i + 1}`,
        name: d.name,
        path: `${d.dir}\\${d.name}`,
        dir: d.dir,
        root: d.root,
        ext,
        kind: d.kind || desc.kind,
        size: d.size,
        modified: new Date(d.modified).getTime() || now,
        tags: d.tags || [],
        starred: !!d.starred,
        pinned: !!d.pinned,
        thumb: d.thumb || '',
        url: d.url || '',
        color: desc.color,
        grad: desc.grad,
        content: d.content ?? null,
        meta: d.meta || {},
        badge: d.badge || null,
        demo: true,
        source: 'demo',
      };
    });
  }

  const SCHEMA = 2;
  const KEY = 'nova-search:v2';

  const defaults = () => ({
    schema: SCHEMA,
    settings: {
      theme: 'dark',
      accent: 'violet',
      density: 'cozy',
      showHidden: false,
      smart: true,
      fuzzy: true,
      layout: 'list',
      peek: true,
      reducedMotion: false,
      rememberHistory: true,
      sound: false,
    },
    pins: [],
    saved: [
      { id: 'saved-markdown', name: 'Docs & notes', query: 'md', scope: 'all', created: Date.now() - 86400e3 * 3 },
      { id: 'saved-images', name: 'Wallpapers', query: 'wallpaper', scope: 'images', created: Date.now() - 86400e3 * 9 },
    ],
    history: [],
    recentViews: [],
    roots: {},
    manual: [],
    meta: { createdAt: Date.now() },
  });

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        const fresh = defaults();
        fresh.entries = seedEntries();
        return fresh;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schema !== SCHEMA) {
        const fresh = defaults();
        fresh.entries = seedEntries();
        return fresh;
      }
      parsed.settings = { ...defaults().settings, ...parsed.settings };
      parsed.entries = Array.isArray(parsed.entries) ? parsed.entries : seedEntries();
      return parsed;
    } catch {
      const fresh = defaults();
      fresh.entries = seedEntries();
      return fresh;
    }
  }

  const state = load();

  let saveTimer = null;
  function persist(immediate = false) {
    const write = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        saveTimer = null;
      } catch (err) {
        // Quota is the common failure — drop native thumbnails and retry once.
        console.warn('Nova: storage quota reached, trimming thumbnails', err);
        let trimmed = 0;
        for (const entry of state.entries) {
          if (!entry.demo && entry.thumb) { delete entry.thumb; trimmed++; }
        }
        try {
          localStorage.setItem(KEY, JSON.stringify(state));
          if (trimmed) NS.toast?.(`Storage nearly full — removed ${trimmed} cached thumbnails`, 'warn', 'info');
        } catch (err2) {
          console.warn('Nova: could not persist library', err2);
        }
        saveTimer = null;
      }
    };
    if (immediate) {
      clearTimeout(saveTimer);
      write();
    } else if (!saveTimer) {
      saveTimer = setTimeout(write, 400);
    }
  }

  function resetDemo() {
    localStorage.removeItem(KEY);
    return seedEntries();
  }

  /* ---------------------------- native folders ---------------------------- */

  function snapshotId(pathstr) {
    return 'root-' + NS.util.hashString(String(pathstr || '').toLowerCase());
  }

  function getRoot(pathstr) {
    return state.roots[snapshotId(pathstr)] || null;
  }

  function addRoot(pathstr, opts = {}) {
    const id = snapshotId(pathstr);
    const root = {
      id,
      path: pathstr,
      name: NS.util.pathName(pathstr) || pathstr,
      count: 0,
      indexed: 0,
      lastIndexed: 0,
      source: opts.source || 'native',
      ...state.roots[id],
      ...opts,
    };
    state.roots[id] = root;
    persist();
    return root;
  }

  function removeRoot(pathstr) {
    const id = snapshotId(pathstr);
    const root = state.roots[id];
    state.roots[id] = undefined;
    delete state.roots[id];
    const remove = new Set();
    for (const e of state.entries) {
      if (!e.demo && (e.rootPath === pathstr || e.path === pathstr || e.path.startsWith(pathstr + '\\') || e.path.startsWith(pathstr + '/'))) {
        remove.add(e.id);
      }
    }
    state.entries = state.entries.filter((e) => !remove.has(e.id));
    persist();
    return { root, removed: remove.size };
  }

  function nativeEntries() {
    return state.entries.filter((e) => !e.demo && e.source !== 'manual');
  }

  function removeEntries(ids) {
    const set = new Set(ids);
    state.entries = state.entries.filter((e) => !set.has(e.id));
  }

  function upsertEntries(entries) {
    const byPath = new Map(state.entries.filter((e) => !e.demo).map((e) => [e.path, e]));
    for (const e of entries) {
      const existing = byPath.get(e.path) || state.entries.find((x) => x.path === e.path);
      if (existing) {
        Object.assign(existing, e, { id: existing.id });
      } else {
        state.entries.push(e);
      }
    }
  }

  /* ---------------------------- manual entries ---------------------------- */

  function toggleStar(id) {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.starred = !entry.starred;
    persist();
    return entry.starred;
  }

  function addTag(id, tag) {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.tags = Array.from(new Set([...(entry.tags || []), tag]));
    persist();
  }

  function removeTag(id, tag) {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.tags = (entry.tags || []).filter((t) => t !== tag);
    persist();
  }

  function togglePin(id) {
    const has = state.pins.includes(id);
    state.pins = has ? state.pins.filter((p) => p !== id) : [id, ...state.pins];
    state.entries.forEach((e) => {
      if (e.id === id) e.pinned = !has;
    });
    persist();
    return !has;
  }

  function touchRecent(id) {
    state.recentViews = [id, ...state.recentViews.filter((x) => x !== id)].slice(0, 40);
    persist();
  }

  function logSearch(record) {
    if (!record.query || !record.query.trim()) return;
    state.history = [{ ...record, id: NS.util.uid(), ts: Date.now() }, ...state.history].slice(0, 60);
    persist();
  }

  function clearHistory() {
    state.history = [];
    state.recentViews = [];
    persist();
  }

  function deleteHistory(id) {
    state.history = state.history.filter((h) => h.id !== id);
    persist();
  }

  function addSaved(entry) {
    const saved = { id: NS.util.uid(), created: Date.now(), ...entry };
    state.saved = [saved, ...state.saved];
    persist();
    return saved;
  }

  function removeSaved(id) {
    state.saved = state.saved.filter((s) => s.id !== id);
    persist();
  }

  function setSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    persist();
    return state.settings;
  }

  function folderSummary() {
    const folders = new Map();
    for (const e of state.entries) {
      if (!e.dir) continue;
      const key = e.dir;
      const rec = folders.get(key) || { path: key, name: NS.util.pathName(key) || key, count: 0, size: 0, kinds: new Map() };
      rec.count++;
      rec.size += e.size || 0;
      rec.entries = (rec.entries || 0);
      rec.kinds.set(e.kind, (rec.kinds.get(e.kind) || 0) + 1);
      folders.set(key, rec);
    }
    return folders;
  }

  NS.store = {
    state, persist, load, resetDemo, seedEntries,
    snapshotId, getRoot, addRoot, removeRoot, nativeEntries, removeEntries, upsertEntries,
    toggleStar, addTag, removeTag, togglePin, touchRecent,
    logSearch, clearHistory, deleteHistory, addSaved, removeSaved, setSettings,
    folderSummary,
    idb: { put: idbPut, get: idbGet, del: idbDel, clear: idbClear },
    demoList: demo,
  };
})();
