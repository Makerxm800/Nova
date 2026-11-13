/* =========================================================================
   NOVA SEARCH — bootstrap.js
   First-run experience for the real thing.

   Nova is not a demo: it indexes the computer it runs on. This module owns
   that contract —

     • in the Electron shell, the main process walks the drives itself and
       streams results back, so there is nothing to click;
     • in a browser, the File System Access API can only hand over a folder
       after a user gesture, so Nova asks once, remembers the handle, and
       re-indexes in the background on every launch after that.

   It also publishes the capacity line the interface shows under the field.
   ========================================================================= */
(function () {
  'use strict';
  const NS = window.Nova;
  const store = NS.store;

  const FIRST_RUN_KEY = 'nova-search:first-run-done';

  /* ------------------------- engine capability --------------------------- */
  function engine() {
    if (window.nova?.isDesktop) return 'desktop';
    if (window.showDirectoryPicker) return 'directory';
    return 'drop';
  }

  /* Labels used in the hero and the field footer. */
  function capacity() {
    const kind = engine();
    const indexed = store.state.entries.length;
    const roots = Object.values(store.state.roots || {}).filter(Boolean).length;
    return {
      engine: kind,
      indexed,
      roots,
      canAutoScan: kind === 'desktop' || kind === 'directory',
      label: kind === 'desktop' ? 'This PC'
        : kind === 'directory' ? 'Local folders'
          : 'Drag files in',
      detail: kind === 'desktop' ? 'every fixed drive on this machine'
        : kind === 'directory' ? 'any folder you grant access to'
          : 'this browser needs a drop or an import',
    };
  }

  /* --------------------------- first run --------------------------------- */
  function isFirstRun() {
    try {
      if (localStorage.getItem(FIRST_RUN_KEY)) return false;
    } catch {}
    return store.state.entries.length === 0;
  }

  function markFirstRunDone() {
    try { localStorage.setItem(FIRST_RUN_KEY, String(Date.now())); } catch {}
  }

  /* Ask the shell to index the machine. No-op in a browser. */
  async function scanThisPc(opts = {}) {
    if (!window.nova?.isDesktop) return { ok: false, reason: 'not-desktop' };
    const api = window.nova;
    if (!api.scanComputer) return { ok: false, reason: 'unsupported' };
    const stop = NS.ui.toast(`Indexing this PC…`, 'info', 'drive', 120000);
    try {
      const result = await api.scanComputer({ onProgress: opts.onProgress });
      stop();
      if (!result || !result.ok) {
        NS.ui.toast('Could not read the drives — index a folder instead', 'warn', 'info');
        return result || { ok: false };
      }
      const mapped = NS.app.ingestNativeScan?.('This PC', result);
      markFirstRunDone();
      NS.ui.toast(`Indexed <b>${NS.util.fmtNum(result.entries.length)}</b> files from this PC`, 'good', 'check');
      return { ok: true, count: result.entries.length, mapped };
    } catch (err) {
      stop();
      NS.ui.toast('Indexing failed — index a folder instead', 'warn', 'info');
      return { ok: false, error: String(err) };
    }
  }

  /* Re-index remembered browser folders silently (permission may be granted). */
  async function refreshKnownFolders() {
    if (!NS.app?.refreshFolders) return 0;
    try { return await NS.app.refreshFolders(); } catch { return 0; }
  }

  /* Run automatically on launch when it is safe to do so. */
  async function autoStart() {
    if (engine() === 'desktop') {
      const roots = Object.keys(store.state.roots || {}).filter((k) => store.state.roots[k]);
      if (!roots.length) { await scanThisPc(); return; }
      // Already indexed once: refresh quietly in the background. The result has
      // to be ingested or the scan is wasted (and never repairs a trimmed index).
      try {
        const result = await window.nova.scanComputer?.({ quiet: true });
        if (result && result.ok && result.entries && result.entries.length) {
          NS.app.ingestNativeScan?.('This PC', result);
          markFirstRunDone();
        }
      } catch {}
      return;
    }
    if (engine() === 'directory') {
      const n = await refreshKnownFolders();
      if (n) NS.ui.toast(`Rescanned ${n} folder${n === 1 ? '' : 's'}`, 'good', 'refresh');
    }
  }

  NS.bootstrap = {
    engine, capacity, isFirstRun, markFirstRunDone,
    scanThisPc, refreshKnownFolders, autoStart,
    FIRST_RUN_KEY,
  };
})();
