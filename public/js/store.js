/* =========================================================================
   NOVA SEARCH — store.js
   Local-first persistence: settings, pins, history, saved searches, the index
   of folders on this machine, and a tiny IndexedDB wrapper for previews.
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

  /* ------------------------------ library --------------------------------- */
  /* No sample data. Nova is a view of the machine it runs on: the library is
     whatever folders the user indexed, and nothing else. */
  function seedEntries() { return []; }

  /* ------------------------------ defaults -------------------------------- */
  const KEY = 'nova-search:v2';
  const SCHEMA = 2;

  function defaults() {
    return {
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
      saved: [],
      history: [],
      recentViews: [],
      roots: {},
      manual: [],
      entries: [],
      meta: { createdAt: Date.now() },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schema !== SCHEMA) return defaults();
      const fresh = defaults();
      parsed.settings = { ...fresh.settings, ...parsed.settings };
      parsed.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      /* Migration: earlier builds shipped a demo library (ids demo-*, demo:true).
         This build is real-machine-only, so drop any leftovers on load. */
      parsed.entries = parsed.entries.filter((e) => e && !e.demo && !String(e.id || '').startsWith('demo-'));
      const alive = new Set(parsed.entries.map((e) => e.id));
      parsed.pins = (Array.isArray(parsed.pins) ? parsed.pins : []).filter((id) => alive.has(id));
      parsed.saved = (Array.isArray(parsed.saved) ? parsed.saved : []).filter((s2) => !/demo/i.test(String(s2 && s2.q || '')));
      parsed.roots = parsed.roots && typeof parsed.roots === 'object' ? parsed.roots : {};
      parsed.saved = Array.isArray(parsed.saved) ? parsed.saved : [];
      parsed.history = Array.isArray(parsed.history) ? parsed.history : [];
      parsed.recentViews = Array.isArray(parsed.recentViews) ? parsed.recentViews : [];
      parsed.pins = Array.isArray(parsed.pins) ? parsed.pins : [];
      return parsed;
    } catch {
      return defaults();
    }
  }

  const state = load();

  /* Wipe every indexed entry and root, keeping preferences. */
  function clearAll() {
    state.entries = [];
    state.roots = {};
    state.pins = [];
    state.recentViews = [];
    state.saved = [];
    state.history = [];
    persist(true);
  }

  let saveTimer = null;
  // localStorage is ~5 MB. A whole-PC scan can hold hundreds of thousands of
  // entries, so we persist what fits (newest first) and leave the rest in memory;
  // the boot rescan fills the gap. Never mutate live state to make room.
  const PERSIST_BUDGET = 3.6 * 1024 * 1024;

  function payloadFor(entries) {
    return JSON.stringify({ ...state, entries });
  }

  function fitsInBudget() {
    let json = payloadFor(state.entries);
    if (json.length <= PERSIST_BUDGET) return json;
    // Keep every pinned/starred entry, then the newest of the rest.
    const keep = [];
    const rest = [];
    const guard = new Set(state.pins || []);
    for (const e of state.entries) (guard.has(e.id) || e.pinned || e.starred ? keep : rest).push(e);
    rest.sort((a, b) => (b.modified || 0) - (a.modified || 0));
    // Binary-search the largest prefix that fits.
    let lo = 0, hi = rest.length, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cand = JSON.stringify({ ...state, entries: keep.concat(rest.slice(0, mid)) });
      if (cand.length <= PERSIST_BUDGET) { best = cand; lo = mid + 1; } else { hi = mid - 1; }
    }
    return best || JSON.stringify({ ...state, entries: keep, partialIndex: true });
  }

  function persist(immediate = false) {
    const write = () => {
      try {
        localStorage.setItem(KEY, fitsInBudget());
        saveTimer = null;
      } catch (err) {
        // Quota can still bite if other origins' data grew. Drop cached
        // thumbnails, then fall back to metadata-only.
        console.warn('Nova: storage quota reached, trimming thumbnails', err);
        let trimmed = 0;
        for (const entry of state.entries) {
          if (entry.thumb && String(entry.thumb).startsWith('data:')) { delete entry.thumb; trimmed++; }
        }
        try {
          localStorage.setItem(KEY, fitsInBudget());
          if (trimmed) NS.toast?.(`Storage nearly full — removed ${trimmed} cached thumbnails`, 'warn', 'info');
        } catch (err2) {
          console.warn('Nova: could not persist library', err2);
        }
        saveTimer = null;
      }
    };
    if (immediate) {
      clearTimeout(saveTimer);
      saveTimer = null;
      write();
    } else if (!saveTimer) {
      saveTimer = setTimeout(write, 400);
    }
  }

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
      if ((e.rootPath === pathstr || e.path === pathstr || e.path.startsWith(pathstr + '\\') || e.path.startsWith(pathstr + '/'))) {
        remove.add(e.id);
      }
    }
    state.entries = state.entries.filter((e) => !remove.has(e.id));
    persist();
    return { root, removed: remove.size };
  }

  function nativeEntries() {
    return state.entries.filter((e) => e.source !== 'manual');
  }

  function removeEntries(ids) {
    const set = new Set(ids);
    state.entries = state.entries.filter((e) => !set.has(e.id));
  }

  function upsertEntries(entries) {
    const byPath = new Map(state.entries.map((e) => [e.path, e]));
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
    state, persist, load, clearAll, seedEntries,
    snapshotId, getRoot, addRoot, removeRoot, nativeEntries, removeEntries, upsertEntries,
    toggleStar, addTag, removeTag, togglePin, touchRecent,
    logSearch, clearHistory, deleteHistory, addSaved, removeSaved, setSettings,
    folderSummary,
    idb: { put: idbPut, get: idbGet, del: idbDel, clear: idbClear },
  };
})();
