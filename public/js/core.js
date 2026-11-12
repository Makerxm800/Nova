/* =========================================================================
   NOVA SEARCH — core.js
   Namespace, utilities, icon system and the file-format registry.
   ========================================================================= */
(function () {
  'use strict';

  const NS = (window.Nova = window.Nova || {});
  NS.version = '2.0.0';

  /* ----------------------------------------------------------------------
     Tiny DOM / utility helpers
     ---------------------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(child));
    }
    return node;
  }

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf = (fn) => requestAnimationFrame(fn);

  function debounce(fn, wait = 120) {
    let t;
    const debounced = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
    debounced.cancel = () => clearTimeout(t);
    debounced.flush = (...args) => {
      clearTimeout(t);
      fn(...args);
    };
    return debounced;
  }

  function throttle(fn, wait = 50) {
    let last = 0, timer = null, lastArgs = null;
    return (...args) => {
      lastArgs = args;
      const now = performance.now();
      if (now - last >= wait) {
        last = now;
        fn(...args);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = performance.now();
          fn(...lastArgs);
        }, wait - (now - last));
      }
    };
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now());

  const clampText = (s, n = 42) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  /* ----------------------------------------------------------------------
     Human formatting
     ---------------------------------------------------------------------- */
  const nf = new Intl.NumberFormat(undefined);
  const fmtNum = (n) => nf.format(Math.round(n || 0));

  function fmtBytes(bytes, short = false) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
    let v = n / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    const digits = v >= 100 || short ? 0 : v >= 10 ? 1 : 2;
    return `${v.toFixed(digits)} ${units[i]}`;
  }

  function fmtDate(ts, style = 'medium') {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    const now = Date.now();
    const diff = now - d.getTime();
    if (style === 'relative') {
      const min = 60e3, hour = 60 * min, day = 24 * hour;
      if (diff < min) return 'just now';
      if (diff < hour) return `${Math.floor(diff / min)}m ago`;
      if (diff < day) return `${Math.floor(diff / hour)}h ago`;
      if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
    }
    const opts = { month: 'short', day: 'numeric' };
    const sameYear = d.getFullYear() === new Date().getFullYear();
    if (!sameYear) opts.year = 'numeric';
    if (style === 'long') { opts.year = 'numeric'; opts.hour = '2-digit'; opts.minute = '2-digit'; }
    return d.toLocaleDateString(undefined, opts);
  }

  function fmtTime(ms) {
    if (ms < 1) return '<1 ms';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  }

  function fmtDuration(sec) {
    if (!Number.isFinite(sec)) return '';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  const fdate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /* ----------------------------------------------------------------------
     Path helpers — accept both / and \ separators.
     ---------------------------------------------------------------------- */
  const SEP = /[\\/]/;

  function pathParts(p) {
    return String(p || '').split(/[\\/]+/).filter(Boolean);
  }
  function pathName(p) {
    const parts = pathParts(p);
    return parts.length ? parts[parts.length - 1] : String(p || '');
  }
  function pathDir(p) {
    const s = String(p || '');
    const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return idx > 0 ? s.slice(0, idx) : '';
  }
  function joinPath(a, b) {
    if (!a) return b;
    if (!b) return a;
    const sep = a.includes('\\') && !a.includes('/') ? '\\' : '/';
    return a.replace(/[\\/]+$/, '') + sep + b.replace(/^[\\/]+/, '');
  }
  function fileExt(name) {
    const base = pathName(name);
    const idx = base.lastIndexOf('.');
    if (idx <= 0) return '';
    return base.slice(idx + 1).toLowerCase();
  }
  function trimExt(name) {
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(0, idx) : name;
  }
  function parentFolder(entry) {
    const parts = pathParts(entry.dir || pathDir(entry.path || ''));
    return parts.length ? parts[parts.length - 1] : 'Library';
  }

  function initials(name) {
    return String(name || '?')
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?';
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = el('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
      return ok;
    }
  }

  function isTypingTarget(node) {
    if (!node) return false;
    const tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
  }

  NS.util = {
    $, $$, el, esc, clamp, sleep, raf, debounce, throttle, uid, clampText,
    nf, fmtNum, fmtBytes, fmtDate, fmtTime, fmtDuration, fdate,
    pathParts, pathName, pathDir, joinPath, fileExt, trimExt, parentFolder,
    initials, hashString, downloadBlob, copyText, isTypingTarget,
  };
  Object.assign(NS, { esc, el, fmtBytes, fmtNum, fmtDate, fmtTime });

  /* ----------------------------------------------------------------------
     Icon system — inline, stroke-based, currentColor.
     ---------------------------------------------------------------------- */
  const P = {
    // navigation & actions
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    sparkle: '<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z"/><path d="M19 3v3M17.5 4.5h3"/>',
    home: '<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    star: '<path d="m12 3.6 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.8l5.9-.9L12 3.6Z"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.8-4.6a1.6 1.6 0 0 1 2.2 0l3.2 3 .8-.8a1.6 1.6 0 0 1 2.2 0l2.3 2.2"/>',
    video: '<rect x="3.5" y="5.5" width="12.5" height="13" rx="3"/><path d="m16 10.5 4.5-2.5v8l-4.5-2.5"/>',
    audio: '<path d="M9 17V6.8a1 1 0 0 1 .8-1l8-1.6a1 1 0 0 1 1.2 1V15"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
    doc: '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/><path d="M9 13h6M9 16.5h4"/>',
    pdf: '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/><path d="M9 16.5v-4h1.5a1.25 1.25 0 0 1 0 2.5H9"/><path d="M13.5 12.5h2v4h-2z"/>',
    sheet: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9.5h16M4 14.5h16M10 4v16M15 4v16"/>',
    slide: '<rect x="3.5" y="4.5" width="17" height="12" rx="2.5"/><path d="M12 16.5V20M8.5 20h7"/>',
    archive: '<path d="M4.5 8.5h15V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19z"/><path d="M4.5 8.5 6 4.5h12l1.5 4"/><path d="M10 12h4"/>',
    code: '<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5l-3 14"/>',
    font: '<path d="M5 19 10.5 6h3L19 19"/><path d="M7.4 14.5h9.2"/>',
    data: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    design: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2.2-.8 2.2-1.9 0-1.4-1.3-1.8-1.3-3 0-1 .8-1.8 2-1.8h2.2a3.4 3.4 0 0 0 3.4-3.4c0-3.6-3.8-6.9-8.5-6.9Z"/><circle cx="8" cy="9" r="1"/><circle cx="12.5" cy="7" r="1"/><circle cx="7" cy="14" r="1"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h6.8a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-12.8a2 2 0 0 1-2-2z"/>',
    folderOpen: '<path d="M3.5 8V7.5a2 2 0 0 1 2-2h4l2 2.2h6.8a2 2 0 0 1 2 2" /><path d="M3.5 9.7h16.2a1.4 1.4 0 0 1 1.35 1.8l-1.6 6.4a2 2 0 0 1-1.95 1.5H5.5a2 2 0 0 1-2-1.9z"/>',
    file: '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/>',
    drive: '<rect x="3.5" y="5" width="17" height="7" rx="2"/><rect x="3.5" y="12.5" width="17" height="6.5" rx="2"/><path d="M7 8.5h.01M7 15.7h.01"/>',
    layers: '<path d="m12 3.5 8.5 4.7L12 12.9 3.5 8.2z"/><path d="m4.5 12.5 7.5 4.1 7.5-4.1M4.5 16.5 12 20.6l7.5-4.1"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
    list: '<path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12"/><circle cx="4.6" cy="6.5" r=".9" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17.5" r=".9" fill="currentColor" stroke="none"/>',
    sort: '<path d="M7 5v14M4 16l3 3 3-3"/><path d="M13 7h7M13 12h5M13 17h3"/>',
    filter: '<path d="M4 6h16l-6 7v6l-4-2v-4z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chevronLeft: '<path d="m14.5 5-7 7 7 7"/>',
    chevronRight: '<path d="m9.5 5 7 7-7 7"/>',
    chevronDown: '<path d="m5 9.5 7 7 7-7"/>',
    chevronUp: '<path d="m5 14.5 7-7 7 7"/>',
    arrowUp: '<path d="M12 20V5M5.5 11.5 12 5l6.5 6.5"/>',
    arrowUpRight: '<path d="M7 17 17 7M9 7h8v8"/>',
    arrowRight: '<path d="M4 12h16M14 6l6 6-6 6"/>',
    arrowLeft: '<path d="M20 12H4M10 6l-6 6 6 6"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9H15"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.46-1 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.46 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    monitor: '<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2.2-.8 2.2-1.9 0-1.4-1.3-1.8-1.3-3 0-1 .8-1.8 2-1.8h2.2a3.4 3.4 0 0 0 3.4-3.4c0-3.6-3.8-6.9-8.5-6.9Z"/><circle cx="7.8" cy="9.2" r="1"/><circle cx="12.3" cy="7" r="1"/><circle cx="16.6" cy="9.2" r="1"/><circle cx="7" cy="14.4" r="1"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5"/>',
    reveal: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l1.9 2.1h7.5a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13.5" r="2.4"/><path d="m13.8 15.4 1.7 1.7"/>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="7" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.4" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/>',
    volume: '<path d="M4 9.5h3l4-3.5v12l-4-3.5H4z"/><path d="M15 8.5a5 5 0 0 1 0 7M17.8 6a9 9 0 0 1 0 12"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2M8 11h6M11 8v6"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2M8 11h6"/>',
    expand: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
    shrink: '<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>',
    download: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11"/><path d="M5 19.5h14"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M9.5 13.5h.01M13 13.5h.01M16.5 13.5h.01M8 16.5h8"/>',
    command: '<path d="M8 8V6.5A2.5 2.5 0 1 0 5.5 9H8Zm0 0h8m-8 0v8m8-8V6.5A2.5 2.5 0 1 1 18.5 9H16Zm0 0v8m0 0H8m8 0v1.5a2.5 2.5 0 1 0 2.5-2.5H16Zm-8 0H6.5A2.5 2.5 0 1 0 9 16.5Z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    pin: '<path d="M9 3.5h6M10 3.5v5L7.5 12v2h9v-2L14 8.5v-5"/><path d="M12 14v6.5"/>',
    trash: '<path d="M4.5 7h15M9 7V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8V7"/><path d="M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12"/><path d="M10 11v6M14 11v6"/>',
    library: '<path d="M4 19.5V6.5a1.5 1.5 0 0 1 1.5-1.5H8l2 2h8.5A1.5 1.5 0 0 1 20 8.5v11z"/><path d="M4 19.5h16"/><path d="M8 12h8M8 15.5h5"/>',
    history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4.5 5v4.2h4.2"/><path d="M12 8v4.5l3 1.8"/>',
    sparkles: '<path d="M12 4c.5 3.8 2 5.3 5.8 5.8-3.8.5-5.3 2-5.8 5.8-.5-3.8-2-5.3-5.8-5.8C10 9.3 11.5 7.8 12 4Z"/><path d="M18.5 14c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3Z"/>',
    bolt: '<path d="M13.5 2.5 5 13.5h5.5L10 21.5l8.5-11H13z"/>',
    shield: '<path d="M12 3 5 5.8v5.4c0 4.4 2.9 8 7 9.8 4.1-1.8 7-5.4 7-9.8V5.8z"/><path d="m9 11.7 2.2 2.2 4-4.1"/>',
    gauge: '<path d="M4.2 17.5a8.5 8.5 0 1 1 15.6 0"/><path d="M12 13.5 16 9"/><circle cx="12" cy="14.5" r="1.4"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M8 3.5v4M16 3.5v4M4 10.5h16"/>',
    tag: '<path d="M4 4.5h6.4a2 2 0 0 1 1.4.6l8 8a2 2 0 0 1 0 2.8l-4.5 4.5a2 2 0 0 1-2.8 0l-8-8a2 2 0 0 1-.5-1.4z"/><circle cx="8.3" cy="8.3" r="1.3"/>',
    windowMin: '<path d="M6 12h12"/>',
    windowMax: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    windowClose: '<path d="m7 7 10 10M17 7 7 17"/>',
    musicNote: '<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    hdd: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M7 12h.01M11 12h.01M15 12h6"/><path d="M6.5 15.5h11"/>',
    arrowDown: '<path d="M12 4v15M5.5 12.5 12 19l6.5-6.5"/>',
    swap: '<path d="M7 4.5 4 7.5l3 3M4 7.5h13M17 19.5l3-3-3-3M20 16.5H7"/>',
    wand: '<path d="m14 5 5 5"/><path d="M5 19 16.5 7.5"/><path d="M18.5 2.5v3M20 4h-3M7.5 3.5v2M8.5 4.5h-2M20 17.5v2M21 18.5h-2"/>',
    link: '<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.3"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.3 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.3-3.6-8.5s1.2-6.2 3.6-8.5Z"/>',
    flame: '<path d="M12 21.5c3.9 0 6.5-2.4 6.5-6 0-4.6-4.4-6.5-4.4-11.5-2.5 1-4.3 3.4-4.3 6.1 0 1.2.4 2.2.9 3.2-.9-.3-1.6-1-2.1-1.8a8 8 0 0 0-.6 3c0 4.6 2.6 7 4 7Z"/>',
  };

  function icon(name, opts = {}) {
    const path = P[name] || P.file;
    const size = opts.size || 20;
    const cls = opts.class ? ` class="${opts.class}"` : '';
    const stroke = opts.stroke || 1.6;
    return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }

  NS.icon = icon;
  NS.iconNames = Object.keys(P);

  /* ----------------------------------------------------------------------
     File-format registry
     ---------------------------------------------------------------------- */
  const KIND_DEFS = {
    image:   { label: 'Image',    plural: 'Images',    icon: 'image',   color: '#f472b6', grad: ['#ec4899', '#f59e0b'] },
    video:   { label: 'Video',    plural: 'Videos',    icon: 'video',   color: '#a78bfa', grad: ['#8b5cf6', '#6366f1'] },
    audio:   { label: 'Audio',    plural: 'Audio',     icon: 'audio',   color: '#34d399', grad: ['#10b981', '#22d3ee'] },
    pdf:     { label: 'PDF',      plural: 'PDFs',      icon: 'pdf',     color: '#fb7185', grad: ['#f43f5e', '#f97316'] },
    doc:     { label: 'Document', plural: 'Documents', icon: 'doc',     color: '#60a5fa', grad: ['#3b82f6', '#6366f1'] },
    sheet:   { label: 'Sheet',    plural: 'Sheets',    icon: 'sheet',   color: '#34d399', grad: ['#059669', '#34d399'] },
    slide:   { label: 'Slides',   plural: 'Slides',    icon: 'slide',   color: '#fbbf24', grad: ['#f59e0b', '#ef4444'] },
    text:    { label: 'Text',     plural: 'Text',      icon: 'doc',     color: '#94a3b8', grad: ['#64748b', '#94a3b8'] },
    code:    { label: 'Code',     plural: 'Code',      icon: 'code',    color: '#22d3ee', grad: ['#0891b2', '#22d3ee'] },
    data:    { label: 'Data',     plural: 'Datasets',  icon: 'data',    color: '#c084fc', grad: ['#a855f7', '#7c3aed'] },
    archive: { label: 'Archive',  plural: 'Archives',  icon: 'archive', color: '#fbbf24', grad: ['#d97706', '#fbbf24'] },
    font:    { label: 'Font',     plural: 'Fonts',     icon: 'font',    color: '#f0abfc', grad: ['#d946ef', '#a855f7'] },
    design:  { label: 'Design',   plural: 'Design',    icon: 'design',  color: '#f9a8d4', grad: ['#db2777', '#8b5cf6'] },
    exec:    { label: 'App',      plural: 'Apps',      icon: 'bolt',    color: '#fb923c', grad: ['#ea580c', '#fbbf24'] },
    other:   { label: 'File',     plural: 'Files',     icon: 'file',    color: '#94a3b8', grad: ['#475569', '#94a3b8'] },
  };

  const EXT_KIND = {};
  const add = (kind, list) => list.split(' ').forEach((e) => e && (EXT_KIND[e] = kind));
  add('image', 'png jpg jpeg jfif gif webp avif svg bmp ico tif tiff heic heif raw cr2 cr3 nef arw dng orf');
  add('video', 'mp4 m4v mov mkv avi webm wmv flv mpg mpeg mpe 3gp 3g2 ogv ts mts m2ts');
  add('audio', 'mp3 wav flac ogg oga m4a aac wma aiff aif opus mid midi amr ape');
  add('pdf', 'pdf');
  add('doc', 'doc docx odt rtf pages tex epub mobi azw3');
  add('sheet', 'xls xlsx xlsm ods numbers csv tsv');
  add('slide', 'ppt pptx pps ppsx odp key');
  add('text', 'txt md markdown mdx log nfo readme license');
  add('code', 'js mjs cjs ts mts cts tsx jsx html htm xhtml css scss sass less styl json jsonc json5 yaml yml toml xml xsl svgz sql py pyw rb go rs java kt kts c h cpp cxx hpp hh cc cs php sh bash zsh fish ps1 psm1 bat cmd lua swift dart vue svelte astro ini cfg conf env properties gradle cmake makefile dockerfile gitignore gitattributes editorconfig patch diff rst adoc');
  add('data', 'db sqlite sqlite3 parquet avro ipynb npy npz pkl pickle h5 h5py hdf5 arrow feather orc sav dta mat');
  add('archive', 'zip rar 7z tar gz gzip bz2 xz zst tgz tbz2 txz iso dmg pkg deb rpm jar war ear apk aab crx');
  add('font', 'ttf otf woff woff2 eot fon fnt');
  add('design', 'psd psb ai eps indd idml sketch fig xd afdesign afphoto blend fbx obj stl gltf glb 3ds max c4d');
  add('exec', 'exe msi app dll so dylib bin appimage com scr');
  add('other', 'part tmp cache bak swp lock');

  // Text-ish extensions that can be rendered as text inside previews.
  const TEXT_EXT = new Set(('txt md markdown mdx log nfo readme license js mjs cjs ts mts cts tsx jsx html htm xhtml css scss sass less styl json jsonc json5 yaml yml toml xml svg svgz sql py pyw rb go rs java kt kts c h cpp cxx hpp hh cc cs php sh bash zsh fish ps1 psm1 bat cmd lua swift dart vue svelte astro ini cfg conf env properties gradle cmake makefile dockerfile gitignore gitattributes editorconfig patch diff rst adoc csv tsvipynb').split(' '));

  function describe(name, mime) {
    const ext = fileExt(name);
    let kind = EXT_KIND[ext];
    if (!kind && mime) {
      if (mime.startsWith('image/')) kind = 'image';
      else if (mime.startsWith('video/')) kind = 'video';
      else if (mime.startsWith('audio/')) kind = 'audio';
      else if (mime === 'application/pdf') kind = 'pdf';
      else if (mime.startsWith('text/')) kind = 'text';
      else if (/zip|compressed|archive/.test(mime)) kind = 'archive';
    }
    kind = kind || 'other';
    const def = KIND_DEFS[kind];
    return {
      ext,
      kind,
      label: def.label,
      plural: def.plural,
      icon: def.icon,
      color: def.color,
      grad: def.grad,
      text: TEXT_EXT.has(ext) || (mime || '').startsWith('text/'),
    };
  }

  const MIME_BY_EXT = {};
  const addMime = (mime, list) => list.split(' ').forEach((e) => e && (MIME_BY_EXT[e] = mime));
  addMime('image/jpeg', 'jpg jpeg jfif');
  addMime('image/png', 'png');
  addMime('image/gif', 'gif');
  addMime('image/webp', 'webp');
  addMime('image/avif', 'avif');
  addMime('image/svg+xml', 'svg');
  addMime('image/bmp', 'bmp');
  addMime('image/x-icon', 'ico');
  addMime('video/mp4', 'mp4 m4v');
  addMime('video/webm', 'webm');
  addMime('video/quicktime', 'mov');
  addMime('video/x-matroska', 'mkv');
  addMime('video/x-msvideo', 'avi');
  addMime('audio/mpeg', 'mp3');
  addMime('audio/wav', 'wav');
  addMime('audio/flac', 'flac');
  addMime('audio/ogg', 'ogg oga');
  addMime('audio/mp4', 'm4a');
  addMime('audio/aac', 'aac');
  addMime('application/pdf', 'pdf');
  addMime('application/json', 'json jsonc');
  addMime('text/plain', 'txt log nfo md markdown readme ini cfg conf');
  addMime('text/csv', 'csv');
  addMime('text/html', 'html htm xhtml');
  addMime('text/css', 'css');
  addMime('text/javascript', 'js mjs cjs');
  addMime('application/zip', 'zip jar apk');
  addMime('font/woff2', 'woff2');
  addMime('font/woff', 'woff');
  addMime('font/ttf', 'ttf');
  addMime('font/otf', 'otf');

  function mimeFor(name) {
    return MIME_BY_EXT[fileExt(name)] || 'application/octet-stream';
  }

  NS.kinds = KIND_DEFS;
  NS.format = { describe, mimeFor, TEXT_EXT, EXT_KIND };
  NS.describe = describe;
  NS.kindOf = (entry) => KIND_DEFS[entry && entry.kind] || KIND_DEFS.other;
})();
