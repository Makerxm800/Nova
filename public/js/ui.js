/* =========================================================================
   NOVA SEARCH — ui.js
   Reusable interface pieces: icons, toasts, popovers, context menus, sheets,
   command palette plumbing and window chrome.
   ========================================================================= */
(function () {
  'use strict';
  const NS = window.Nova;
  const { $, $$, el, esc, sleep } = NS.util;
  const icon = NS.icon;
  const store = NS.store;

  /* ---------------------------- icons ------------------------------------ */
  function paintIcons(root = document) {
    $$('[data-icon]', root).forEach((node) => {
      const name = node.dataset.icon;
      if (!name || node.dataset.painted === name) return;
      node.innerHTML = icon(name, { size: node.dataset.size || 20 });
      node.dataset.painted = name;
    });
  }

  function svg(name, size = 20) {
    return icon(name, { size });
  }

  /* ---------------------------- toasts ----------------------------------- */
  function toast(message, tone = 'info', iconName = null, ms = 3200) {
    const wrap = $('#toasts');
    if (!wrap) return;
    const ic = iconName || (tone === 'good' ? 'check' : tone === 'warn' ? 'info' : 'sparkle');
    const node = el('div', { class: `toast ${tone}` },
      el('span', { html: icon(ic, { size: 15 }) }),
      el('span', { html: message }),
    );
    wrap.append(node);
    const remove = () => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 260);
    };
    setTimeout(remove, ms);
    node.addEventListener('click', remove);
    while (wrap.children.length > 4) wrap.firstElementChild.remove();
    return remove;
  }

  /* ---------------------------- overlays --------------------------------- */
  const overlayStack = [];

  function openOverlay(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    hidePopovers();
    overlay.hidden = false;
    document.body.classList.add('overlay-open');
    if (!overlayStack.includes(id)) overlayStack.push(id);
    trapFocus(overlay);
  }

  function closeOverlay(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.hidden = true;
    const i = overlayStack.indexOf(id);
    if (i >= 0) overlayStack.splice(i, 1);
    if (!overlayStack.length) document.body.classList.remove('overlay-open');
  }

  function closeTopOverlay() {
    const id = overlayStack[overlayStack.length - 1];
    if (!id) return false;
    closeOverlay(id);
    return true;
  }

  function anyOverlayOpen() {
    return $$('.overlay').some((o) => !o.hidden);
  }

  let focusBeforeTrap = null;
  function trapFocus(root) {
    focusBeforeTrap = document.activeElement;
    setTimeout(() => {
      const target = root.querySelector('[autofocus], input, button:not(.sheet-close)');
      if (target && root.id === 'paletteOverlay') target.focus();
    }, 30);
  }

  // Overlays close on Escape — registered before the app's key map and
  // captured at the document level so it runs no matter where focus sits.
  function bindOverlayEscape() {
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      const palette = document.getElementById('paletteOverlay');
      if (palette && !palette.hidden) {
        // The command palette manages its own Escape and keeps the event.
        palette.hidden = true;
        document.body.classList.remove('overlay-open');
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      if (!anyOverlayOpen()) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      closeTopOverlay();
    }, true);
  }

  document.addEventListener('click', (ev) => {
    const closer = ev.target.closest('[data-close-overlay]');
    if (closer) {
      ev.preventDefault();
      closeOverlay(closer.dataset.closeOverlay);
      return;
    }
    const overlay = ev.target.classList && ev.target.classList.contains('overlay') ? ev.target : null;
    if (overlay) closeOverlay(overlay.id);
  });

  /* ---------------------------- sheets ----------------------------------- */
  function bindSheetTabs() {}

  /* ---------------------------- popovers --------------------------------- */
  const popovers = new Map();
  function registerPopover(id) {
    const node = document.getElementById(id);
    if (!node) return null;
    popovers.set(id, node);
    return node;
  }

  function hidePopovers(exceptId = null) {
    popovers.forEach((node, id) => {
      if (id !== exceptId) node.hidden = true;
    });
    const ctx = $('#ctxMenu');
    if (ctx && exceptId !== 'ctxMenu') ctx.hidden = true;
  }

  function placePopover(node, anchor, align = 'end') {
    node.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const pop = node.getBoundingClientRect();
    let left = align === 'end' ? rect.right - pop.width : rect.left;
    left = Math.min(window.innerWidth - pop.width - 12, Math.max(12, left));
    let top = rect.bottom + 8;
    if (top + pop.height > window.innerHeight - 12) top = Math.max(12, rect.top - pop.height - 8);
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }

  function togglePopover(id, anchor) {
    const node = popovers.get(id) || registerPopover(id);
    if (!node) return;
    if (!node.hidden) { node.hidden = true; return; }
    hidePopovers(id);
    placePopover(node, anchor);
  }

  /* ---------------------------- context menu ------------------------------ */
  function showContextMenu(x, y, items) {
    const menu = $('#ctxMenu');
    if (!menu) return;
    menu.innerHTML = items.map((item) => {
      if (item.sep) return '<div class="ctx-sep"></div>';
      return `<button class="ctx-item ${item.danger ? 'danger' : ''}" data-ctx="${item.id}">
        <span data-icon="${item.icon || 'file'}"></span>
        <span>${esc(item.label)}</span>
        ${item.key ? `<span class="ctx-key">${esc(item.key)}</span>` : ''}
      </button>`;
    }).join('');
    paintIcons(menu);
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 10)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 10)}px`;
    menu.querySelectorAll('[data-ctx]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = items.find((i) => i.id === button.dataset.ctx);
        menu.hidden = true;
        if (item && item.run) item.run();
      });
    });
  }

  document.addEventListener('mousedown', (ev) => {
    if (!ev.target.closest('.popover') && !ev.target.closest('.ctx') && !ev.target.closest('[data-keep-open]')) {
      hidePopovers();
    }
  });
  window.addEventListener('resize', () => hidePopovers());
  window.addEventListener('scroll', () => hidePopovers(), true);

  /* ---------------------------- window chrome ----------------------------- */
  function initChrome() {
    const desktop = !!window.nova?.isDesktop;
    const ctrls = $$('.win-ctrls .win-btn');
    ctrls.forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.win;
        if (desktop) window.nova.window(action);
        else if (action === 'close') toast('Closing is handled by the host window', 'info');
      });
    });
    document.title = 'Nova Search';
    if (desktop) {
      window.nova.platform().then((info) => {
        document.documentElement.dataset.platform = info.platform;
        NS.platform = info;
      });
      window.nova.onMenu((action) => {
        if (action === 'index-folder') NS.app?.indexFolders?.();
        if (action === 'focus-search') NS.app?.focusSearch?.();
        if (action === 'palette') NS.app?.openPalette?.();
      });
      window.nova.onWindowState(({ maximized }) => {
        document.body.classList.toggle('maximized', maximized);
      });
    }
    const privacy = $('#tbPrivacy');
    if (privacy) {
      privacy.innerHTML = `${icon('lock', { size: 12 })}<span>${desktop ? 'Local index' : 'On-device'} · nothing leaves this machine</span>`;
    }
    const hint = $('#privacyHint');
    if (hint) hint.innerHTML = `${icon('shield', { size: 12 })}<span>On-device indexing · no account · no telemetry</span>`;
  }

  /* ---------------------------- keyboard sheet ---------------------------- */
  const SHORTCUTS = [
    { group: 'Search', items: [
      ['Focus search', ['/']],
      ['Command palette', ['⌘', 'K']],
      ['Clear search', ['esc']],
      ['Next suggestion', ['↓']],
    ] },
    { group: 'Results', items: [
      ['Move selection', ['↑', '↓']],
      ['Open preview', ['↵']],
      ['Peek / lightbox', ['space']],
      ['Star file', ['S']],
      ['Copy path', ['⌘', 'C']],
      ['Reveal in folder', ['⌘', '↵']],
    ] },
    { group: 'Views', items: [
      ['List / grid', ['⌘', '1']],
      ['Starred', ['⌘', '2']],
      ['Recent', ['⌘', '3']],
      ['Library', ['⌘', '4']],
      ['Toggle theme', ['⌘', '⇧', 'L']],
    ] },
    { group: 'Library', items: [
      ['Index folder', ['⌘', 'O']],
      ['Import files', ['⌘', 'I']],
      ['Filters', ['⌘', 'F']],
      ['Settings', ['⌘', ',']],
      ['Shortcuts', ['?']],
    ] },
  ];

  function renderShortcuts() {
    const grid = $('#shortcutGrid');
    if (!grid) return;
    grid.innerHTML = SHORTCUTS.map((block) => `
      <div class="sc-group">
        <h3>${esc(block.group)}</h3>
        ${block.items.map(([label, keys]) => `
          <div class="sc-row"><span>${esc(label)}</span><span class="sc-keys">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span></div>
        `).join('')}
      </div>`).join('');
  }

  /* ---------------------------- settings ---------------------------------- */
  function initSettings(handlers) {
    const s = store.state.settings;
    const themeSeg = $('#setTheme');
    const syncTheme = () => {
      $$('#setTheme .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.themeVal === s.theme));
    };
    $$('#setTheme .seg-btn').forEach((btn) => btn.addEventListener('click', () => {
      s.theme = btn.dataset.themeVal;
      store.setSettings({ theme: s.theme });
      syncTheme();
      handlers.applyTheme?.();
    }));

    $$('#setAccent button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.accent === s.accent);
      btn.addEventListener('click', () => {
        s.accent = btn.dataset.accent;
        store.setSettings({ accent: s.accent });
        $$('#setAccent button').forEach((b) => b.classList.toggle('active', b === btn));
        handlers.applyTheme?.();
      });
    });

    $$('#setDensity .seg-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.densityVal === s.density);
      btn.addEventListener('click', () => {
        s.density = btn.dataset.densityVal;
        store.setSettings({ density: s.density });
        $$('#setDensity .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
        handlers.applyDensity?.();
      });
    });

    const bindSwitch = (id, key, label) => {
      const input = $(id);
      if (!input) return;
      input.checked = !!s[key];
      input.addEventListener('change', () => {
        store.setSettings({ [key]: input.checked });
        handlers.settingChanged?.(key, input.checked);
      });
    };
    bindSwitch('#setMotion', 'reducedMotion');
    bindSwitch('#setSmart', 'smart');
    bindSwitch('#setFuzzy', 'fuzzy');
    bindSwitch('#setHidden', 'showHidden');
    bindSwitch('#setHistory', 'rememberHistory');

    $('#btnClearHistory')?.addEventListener('click', () => {
      store.clearHistory();
      toast('Search history cleared', 'good', 'history');
      handlers.refresh?.();
    });

    $('#btnResetLibrary')?.addEventListener('click', () => {
      store.clearAll();
      handlers.refresh?.();
      toast('Index cleared — nothing is tracked until you index again', 'info', 'trash');
    });

    $('#btnAddRoot')?.addEventListener('click', () => handlers.indexFolders?.());
    $('#btnAbout')?.addEventListener('click', () => { closeOverlay('settingsOverlay'); openOverlay('aboutOverlay'); });
    $('#versionTag')?.addEventListener('click', () => openOverlay('aboutOverlay'));
    const versionTag = $('#versionTag');
    if (versionTag) versionTag.textContent = NS.version;
    const aboutVersion = $('#aboutVersion');
    if (aboutVersion) aboutVersion.textContent = NS.version;

    return { sync(snapshot) { Object.assign(s, snapshot); } };
  }

  function renderRoots(handlers) {
    const list = $('#settingsRoots');
    if (!list) return;
    const roots = Object.values(store.state.roots).filter(Boolean);
    if (!roots.length) {
      list.innerHTML = '<div class="root-empty">Nothing indexed yet.<br>Index a folder (or this PC) and its files appear here.</div>';
      return;
    }
    list.innerHTML = roots.map((root) => `
      <div class="root-line" data-root="${esc(root.path)}">
        <span class="rl-ic" data-icon="drive"></span>
        <span class="rl-text"><b>${esc(root.name)}</b><small>${esc(root.path)}</small></span>
        <span class="rl-meta">${NS.util.fmtNum(root.count || 0)} files</span>
        <button class="icon-btn tiny" data-root-remove="${esc(root.path)}" title="Stop indexing">${icon('close', { size: 12 })}</button>
      </div>`).join('');
    list.querySelectorAll('[data-root-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        handlers.removeRoot?.(btn.dataset.rootRemove);
        renderRoots(handlers);
      });
    });
  }

  function resetSettingsForm() {
    const s = store.state.settings;
    $$('#setTheme .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.themeVal === s.theme));
    $$('#setAccent button').forEach((b) => b.classList.toggle('active', b.dataset.accent === s.accent));
    $$('#setDensity .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.densityVal === s.density));
    const map = { '#setMotion': 'reducedMotion', '#setSmart': 'smart', '#setFuzzy': 'fuzzy', '#setHidden': 'showHidden', '#setHistory': 'rememberHistory' };
    for (const [sel, key] of Object.entries(map)) {
      const input = $(sel);
      if (input) input.checked = !!s[key];
    }
  }

  /* ---------------------------- misc ------------------------------------- */
  function emptyArt(kind = 'search') {
    const shapes = {
      search: `<svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="42" cy="42" r="24" stroke="url(#g)" stroke-width="2.5"/>
        <path d="M60 60L78 78" stroke="url(#g)" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="42" cy="42" r="24" stroke="var(--accent)" stroke-width="2.5" opacity=".22" stroke-dasharray="3 5" transform="rotate(-20 42 42) scale(1.18) translate(-6 -6)"/>
        <path d="M34 42h16M42 34v16" stroke="var(--accent-2)" stroke-width="2" stroke-linecap="round" opacity=".7"/>
        <defs><linearGradient id="g" x1="18" y1="18" x2="78" y2="78"><stop stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>
      </svg>`,
      star: `<svg viewBox="0 0 96 96" fill="none"><path d="M48 14l9.4 19.6L78 36.8 61.5 52.6 66 74 48 63.5 30 74l4.5-21.4L18 36.8l20.6-3.2z" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" fill="var(--accent-soft)"/></svg>`,
      clock: `<svg viewBox="0 0 96 96" fill="none"><circle cx="48" cy="48" r="30" stroke="var(--accent)" stroke-width="2.5"/><path d="M48 30v18l12 8" stroke="var(--accent-2)" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    };
    return shapes[kind] || shapes.search;
  }

  /* ---------------------------- boot chrome ------------------------------ */
  function init() {
    paintIcons();
    initChrome();
    renderShortcuts();
    bindOverlayEscape();

    // Cached SVGs for markup used repeatedly (hero mark, rail mark, etc.)
    const star = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="starG" x1="4" y1="4" x2="28" y2="28"><stop stop-color="#22d3ee"/><stop offset=".55" stop-color="var(--accent)"/><stop offset="1" stop-color="#ec4899"/></linearGradient>
        <radialGradient id="starCore" cx=".5" cy=".45" r=".6"><stop stop-color="#fff" stop-opacity=".95"/><stop offset=".6" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill="url(#starCore)"/>
      <path d="M16 3.5 18.2 12 27 16l-8.8 4L16 28.5 13.8 20 5 16l8.8-4z" fill="url(#starG)"/>
      <path d="M16 8.4 17 13.6 16 16l-1-2.4z" fill="#fff" opacity=".72"/>
      <circle cx="26.4" cy="6.4" r="1.2" fill="#22d3ee"/><circle cx="5.4" cy="24" r=".9" fill="#ec4899"/>
    </svg>`;
    const assign = (sel, html) => { const n = $(sel); if (n) n.innerHTML = html; };
    assign('#tbMark', star);
    const railHome = $('#railHome');
    if (railHome) railHome.innerHTML = star;
    ['#heroStar', '#dropMark', '#aboutMark', '#askMark'].forEach((sel) => assign(sel, star));
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) favicon.href = 'assets/icon.svg';

    document.querySelectorAll('[data-win]').forEach((b) => b.setAttribute('aria-label', b.dataset.win));
  }

  NS.ui = {
    paintIcons, svg, toast, openOverlay, closeOverlay, closeTopOverlay, anyOverlayOpen, overlayStack,
    registerPopover, togglePopover, hidePopovers, placePopover,
    showContextMenu, renderShortcuts, renderRoots, initSettings, resetSettingsForm,
    emptyArt, init, SHORTCUTS,
  };
  NS.toast = toast;
  NS.ui.bindSheetTabs = bindSheetTabs;
})();
