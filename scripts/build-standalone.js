#!/usr/bin/env node
/* =========================================================================
   NOVA SEARCH — build-standalone.js
   Produces `Nova Search.html`: one file, zero dependencies, zero network.
   CSS, every JS module, fonts, artwork and the demo audio/video are inlined
   as data URLs, so the app runs by double-clicking it — no npm, no server,
   no install step of any kind.
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const out = path.join(root, 'Nova Search.html');

const read = (p) => fs.readFileSync(p, 'utf8');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.ico': 'image/x-icon',
};

function dataUri(rel) {
  const file = path.join(pub, rel);
  const buf = fs.readFileSync(file);
  return `data:${MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}

/* ------------------------------ assets ---------------------------------- */
// Only the sample media ships inline; everything else is generated at runtime.
const ASSET_REFS = [
  'assets/fonts/space-grotesk-latin-wght-normal.woff2',
  'assets/fonts/inter-latin-wght-normal.woff2',
  'assets/fonts/jetbrains-mono-latin-wght-normal.woff2',
  'assets/icon.svg',
];

const assetMap = {};
let assetBytes = 0;
for (const rel of ASSET_REFS) {
  const file = path.join(pub, rel);
  if (!fs.existsSync(file)) {
    console.warn('  missing asset, skipping:', rel);
    continue;
  }
  assetMap[rel] = dataUri(rel);
  assetBytes += fs.statSync(file).size;
}

/* ------------------------------- css ------------------------------------ */
let css = read(path.join(pub, 'css/style.css'));
// Rewrite url(...) references to the inlined data URIs.
css = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (full, quote, ref) => {
  if (/^(data:|https?:|#|%23)/.test(ref)) return full;
  const rel = path.posix.normalize(path.posix.join('assets', ref.replace(/^\.\.\//, '').replace(/^assets\//, '')));
  if (assetMap[rel]) return `url("${assetMap[rel]}")`;
  const withAssets = path.posix.join('assets', ref.replace(/^\.\.\/assets\//, ''));
  if (assetMap[withAssets]) return `url("${assetMap[withAssets]}")`;
  console.warn('  css asset not inlined:', ref);
  return full;
});

/* -------------------------------- js ------------------------------------ */
const ORDER = ['core', 'store', 'search', 'player', 'bootstrap', 'preview', 'ui', 'app'];
let js = ORDER.map((name) => {
  const src = read(path.join(pub, 'js', `${name}.js`));
  // Guard against a stray </script> inside a string breaking the inline tag.
  return `/* ==== ${name}.js ==== */\n${src.replace(/<\/script/gi, '<\\/script')}`;
}).join('\n');

/* ------------------------------- html ----------------------------------- */
let html = read(path.join(pub, 'index.html'));

html = html.replace(/<link rel="stylesheet" href="css\/style\.css">/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<link rel="preload"[^>]*>\s*/g, '');
html = html.replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="${assetMap['assets/icon.svg']}">`);
html = html.replace(/<script src="js\/[a-z]+\.js"><\/script>\s*/g, '');
html = html.replace('</body>', () => `<script>\n${js}\n</script>\n</body>`);

/* --------------------------- runtime shim ------------------------------- */
// Everything that shipped as a file path now resolves from the inline map, so
// behaviour is byte-identical to the served build.
const shim = `
<script>
/* Nova standalone shim — resolves inline assets before the app boots. */
(function () {
  const MAP = ${JSON.stringify(assetMap)};
  window.__NOVA_INLINE__ = MAP;
  window.__novaAsset = function (p) {
    if (!p) return p;
    const key = String(p).replace(/^\\.?\\//, '');
    return MAP[key] || p;
  };
  // Patch every place the app points at assets/… before scripts run.
  const patchEl = (el, attr) => {
    const v = el.getAttribute(attr);
    if (v && MAP[v]) el.setAttribute(attr, MAP[v]);
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('img[src]').forEach((n) => patchEl(n, 'src'));
    document.querySelectorAll('link[href]').forEach((n) => patchEl(n, 'href'));
  });
  const origCreate = document.createElement.bind(document);
  const ATTRS = ['src', 'href', 'style'];
  document.createElement = function (tag, ...rest) {
    const el = origCreate(tag, ...rest);
    if (tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'source' || tag === 'a') {
      const proto = el;
      if (tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'source') {
        const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src') ||
          Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        if (desc && desc.set) Object.defineProperty(el, 'src', {
          get() { return desc.get.call(el); },
          set(v) { desc.set.call(el, window.__novaAsset(v)); },
          configurable: true,
        });
      }
    }
    return el;
  };
})();
</script>
`;

// Place the shim before the app scripts but after markup exists enough to patch.
html = html.replace('</head>', () => `${shim}\n</head>`);

/* ------------------------- asset-aware data model ----------------------- */
// The store seeds demo entries with relative asset paths; swap them at seed
// time so markdown/HTML string templates keep working untouched.
const storePatch = `
<script>
/* Nova standalone shim — nothing to remap now that the library is real files
   from this machine. Kept so older builds of the app still boot. */
</script>
`;

// Runs after app.js, before the closing body.
html = html.replace('</body>', () => `${storePatch}\n</body>`);

/* --------------------------- launcher scripts --------------------------- */
// The single HTML file is the app. These tiny companions just make it
// discoverable: double-click → it opens in the default browser.
const winLauncher = `@echo off\r
rem Nova Search — opens the single-file app. No install, no npm, no server.\r
start "" "%~dp0Nova Search.html"\r
`;
const macLauncher = `#!/bin/bash
# Nova Search — opens the single-file app. No install, no npm, no server.
DIR="$(cd "$(dirname "$0")" && pwd)"
open "$DIR/Nova Search.html"
`;
const shLauncher = `#!/bin/sh
# Nova Search — opens the single-file app. No install, no npm, no server.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$DIR/Nova Search.html"
elif command -v open >/dev/null 2>&1; then open "$DIR/Nova Search.html"
else echo "Open this file in your browser: $DIR/Nova Search.html"; fi
`;
fs.writeFileSync(path.join(root, 'Open Nova Search.bat'), winLauncher);
fs.writeFileSync(path.join(root, 'Open Nova Search.command'), macLauncher, { mode: 0o755 });
fs.writeFileSync(path.join(root, 'open-nova-search.sh'), shLauncher, { mode: 0o755 });

/* ------------------------------ write ----------------------------------- */
fs.writeFileSync(out, html);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`Nova Search.html  ${kb(Buffer.byteLength(html))}  (inline assets ${kb(assetBytes)}, css ${kb(css.length)}, js ${kb(js.length)})`);
console.log('launchers: Open Nova Search.bat · Open Nova Search.command · open-nova-search.sh');
console.log(`open it with: xdg-open "${out}"`);
