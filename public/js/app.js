/* =========================================================================
   NOVA SEARCH — app.js
   Application controller: views, search loop, results, preview panel,
   library, indexing bridges and keyboard map.
   ========================================================================= */
(function () {
  'use strict';
  const NS = window.Nova;
  const U = NS.util;
  const { $, $$, el, esc, debounce, throttle, fmtBytes, fmtNum, fmtDate, fmtTime, parentFolder, pathName, clamp } = U;
  const store = NS.store;
  const search = NS.search;
  const ui = NS.ui;
  const icon = NS.icon;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const modKey = isMac ? '⌘' : 'Ctrl';

  const SCOPES = [
    { id: 'everything', label: 'Everything', icon: 'layers', kinds: null },
    { id: 'images', label: 'Pictures', icon: 'image', kinds: ['image'] },
    { id: 'docs', label: 'Documents', icon: 'doc', kinds: ['doc', 'pdf', 'sheet', 'slide', 'text'] },
    { id: 'media', label: 'Media', icon: 'video', kinds: ['video', 'audio'] },
    { id: 'code', label: 'Code', icon: 'code', kinds: ['code', 'data'] },
    { id: 'archives', label: 'Archives', icon: 'archive', kinds: ['archive'] },
    { id: 'models', label: 'Models', icon: 'cube', kinds: ['model'] },
    { id: 'disks', label: 'Disks', icon: 'drive', kinds: ['disk'] },
  ];

  const SORTS = [
    { id: 'relevance', label: 'Relevance', icon: 'sparkles' },
    { id: 'name', label: 'Name A → Z', icon: 'sort' },
    { id: 'nameDesc', label: 'Name Z → A', icon: 'sort' },
    { id: 'date', label: 'Newest first', icon: 'clock' },
    { id: 'dateAsc', label: 'Oldest first', icon: 'clock' },
    { id: 'size', label: 'Largest first', icon: 'gauge' },
    { id: 'sizeAsc', label: 'Smallest first', icon: 'gauge' },
    { id: 'kind', label: 'Format', icon: 'grid' },
  ];

  const state = {
    view: 'search',
    scope: 'everything',
    chipKind: null,
    layout: store.state.settings.layout || 'list',
    sort: 'date',
    filters: { sizes: new Set(), dates: new Set(), flags: new Set() },
    smartDismissed: new Set(),
    lastSmart: [],
    query: '',
    run: null,
    activeId: null,
    multi: new Set(),
    renderLimit: 80,
    suggestIndex: -1,
    suggestItems: [],
    lastTook: null,
    browserFiles: new Map(),
    fsRoots: new Map(),
    types: new Set(),
  };

  const refs = {};

  /* Mixing platform separators is common (Windows paths pasted on macOS),
     so treat both slash styles as safe. */
  function urlFor(p) {
    if (!p) return '';
    const clean = String(p).replace(/^file:{2,4}[/\\]+/i, '').replace(/\\/g, '/');
    return `nova-preview://local/?path=${encodeURIComponent(clean)}`;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Boot
     ═══════════════════════════════════════════════════════════════════════ */
  function boot() {
    ui.init();
    cacheRefs();
    applyTheme();
    applyDensity();
    bindChrome();
    bindField();
    bindScopes();
    bindViews();
    bindResults();
    bindPreview();
    bindIndexing();
    bindFilters();
    bindSort();
    bindLayout();
    bindLibrary();
    bindKeyboard();
    bindDrop();
    bindPalette();
    NS.preview.bindLightbox();
    renderHero();
    renderHistory();
    renderScopes();
    refreshMeta();
    setView('search', { keepQuery: true });
    focusQuery();
    warmIndex();
    // Real machine, real index: pick up where the last session left off.
    NS.bootstrap?.markFirstRunDone?.();
    setTimeout(() => NS.bootstrap?.autoStart?.(), 600);
    bindScopeWheel();
    setTimeout(syncScopeFade, 300);
    document.fonts?.ready?.then(syncScopeFade).catch(() => {});

    window.addEventListener('resize', debounce(() => { updatePreviewVisibility(); syncScopeFade(); }, 120));
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (store.state.settings.theme === 'system') applyTheme();
    });
    setInterval(() => {
      const el = $('#tbIndex');
      if (el && state.view === 'search') el.textContent = `${fmtNum(store.state.entries.length)} entries · ${state.lastTook != null ? Math.round(state.lastTook) + 'ms' : 'ready'}`;
    }, 15000);
    console.info('%cNOVA SEARCH', 'font-weight:700;letter-spacing:.2em;color:#a78bfa', `v${NS.version} · local-first`);
  }

  function cacheRefs() {
    const ids = [
      'app', 'query', 'field', 'suggest', 'underField', 'btnClear', 'smartToggle', 'fieldKbd',
      'scopes', 'indexState', 'indexCount', 'btnIndex', 'stageBody', 'hero', 'heroChips', 'formatStrip', 'heroStats',
      'results', 'resultsTitle', 'resultMeta', 'kindChips', 'activeFilters', 'list', 'emptyState', 'emptyArt',
      'emptyTitle', 'emptyText', 'emptyActions', 'selectionBar', 'selCount', 'resultScroll', 'listColumns',
      'library', 'rootGrid', 'folderGrid', 'folderCount', 'preview',
      'pvStar', 'pvMore', 'pvClose', 'pvOpen', 'pvReveal', 'pvCopy', 'tbIndex', 'tbMark', 'filterCount', 'sortLabel',
      'pvScroll', 'pvKind', 'pvName', 'pvPath', 'pvMeta', 'pvTags', 'pvNote', 'pvMedia',
      'btnFilters', 'btnSort', 'btnTheme', 'btnSettings', 'btnHelp', 'btnShortcuts', 'railHome', 'paletteInput',
      'paletteList', 'paletteOverlay', 'filterPop', 'sortPop', 'filterSize', 'filterDate', 'filterFlags', 'sortList',
      'btnIndex', 'storageSize', 'storageFill', 'storageText', 'settingsRoots', 'dropVeil', 'fileInput', 'folderInput',
    ];
    ids.forEach((id) => { refs[id] = document.getElementById(id); });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Theme, density, counts
     ═══════════════════════════════════════════════════════════════════════ */
  function applyTheme() {
    const root = document.documentElement;
    const s = store.state.settings;
    let theme = s.theme;
    if (theme === 'system') theme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    root.dataset.theme = theme;
    root.dataset.accent = s.accent || 'violet';
    const btn = $('#btnTheme');
    if (btn) {
      btn.querySelector('.rub-ic').innerHTML = icon(theme === 'light' ? 'moon' : 'sun', { size: 18 });
      btn.querySelector('.rub-tip').textContent = theme === 'light' ? 'Dark theme' : 'Light theme';
    }
    refs.app.dataset.theme = theme;
  }

  function applyDensity() {
    const s = store.state.settings;
    document.documentElement.dataset.density = s.density;
    document.documentElement.dataset.motion = s.reducedMotion ? 'reduced' : 'full';
  }

  function refreshMeta() {
    const entries = store.state.entries;
    const folders = store.folderSummary();
    const kinds = new Set(entries.map((e) => e.kind));
    state.types = kinds;
    const roots = Object.values(store.state.roots).filter(Boolean);
    const label = roots.length ? `${fmtNum(entries.length)} indexed` : 'nothing indexed';
    const countEl = $('#indexCount');
    if (countEl) countEl.textContent = label;
    if (refs.tbIndex) refs.tbIndex.textContent = roots.length
      ? `${fmtNum(entries.length)} entries · ${roots.length} ${roots.length === 1 ? 'location' : 'locations'}`
      : 'no files indexed yet';
    if (refs.indexState) refs.indexState.querySelector('b').textContent = roots.length ? 'Indexed' : 'Not indexed';

    // hero stats — the fourth cell reports a real median, never a single sample
    if (refs.heroStats) {
      const totalSize = entries.reduce((sum, e) => sum + (e.size || 0), 0);
      const recent = (state.recentTook || []).slice(-9).sort((a, b) => a - b);
      const median = recent.length ? recent[Math.floor(recent.length / 2)] : null;
      // Root-level files have no sub-folder of their own; the drive they live
      // on is still a location, so count roots as locations too.
      const rootNames = new Set(Object.values(store.state.roots).filter(Boolean).map((r) => r.name));
      const locations = new Set([...folders.keys(), ...rootNames]);
      const stats = entries.length
        ? [
          { value: fmtNum(entries.length), unit: '', label: 'files indexed' },
          { value: String(kinds.size), unit: '', label: 'formats live' },
          { value: fmtNum(locations.size), unit: '', label: locations.size === 1 ? 'location' : 'locations' },
          { value: median != null ? String(Math.max(1, Math.round(median))) : '—', unit: 'ms', label: 'median query' },
        ]
        : [
          { value: '0', unit: '', label: 'files indexed' },
          { value: NS.bootstrap ? NS.bootstrap.capacity().label : 'Local', unit: '', label: 'ready to index', wide: true },
        ];
      refs.heroStats.innerHTML = stats.map((st) => `<div class="stat${st.wide ? ' wide' : ''}"><b>${st.value}${st.unit ? `<span class="unit">${st.unit}</span>` : ''}</b><span>${st.label}</span></div>`).join('');
      refs.heroStats.title = `${fmtBytes(totalSize)} tracked locally`;
      refs.heroStats.querySelectorAll('.stat b').forEach((b, i) => {
        b.style.animation = 'none';
      });
    }

    // storage meter
    if (refs.storageSize) {
      refs.storageSize.textContent = fmtBytes(entries.reduce((s, e) => s + (e.size || 0), 0));
      const fill = clamp((entries.length / 60000) * 100, 2, 100);
      refs.storageFill.style.width = fill + '%';
      refs.storageText.textContent = `${fmtNum(entries.length)} entries · metadata only, stored on this device.`;
    }
    renderScopes();
  }

  function renderScopes() {
    if (!refs.scopes) return;
    const entries = store.state.entries;
    const counts = new Map();
    for (const scope of SCOPES) {
      if (!scope.kinds) continue;
      counts.set(scope.id, entries.filter((e) => scope.kinds.includes(e.kind)).length);
    }
    refs.scopes.innerHTML = SCOPES.map((scope) => `
      <button class="scope ${state.scope === scope.id ? 'active' : ''}" data-scope="${scope.id}" title="${scope.label} — ${scope.kinds ? fmtNum(counts.get(scope.id) || 0) : fmtNum(entries.length)} files">
        <span data-icon="${scope.icon}"></span><span class="sc-label">${scope.label}</span>${scope.kinds ? `<b>${fmtNum(counts.get(scope.id) || 0)}</b>` : `<b>${fmtNum(entries.length)}</b>`}
      </button>`).join('');
    ui.paintIcons(refs.scopes);
    syncScopeFade();
  }

  function bindScopeWheel() {
    const rail = refs.scopes;
    if (!rail) return;
    rail.addEventListener('wheel', (ev) => {
      if (Math.abs(ev.deltaY) < Math.abs(ev.deltaX)) return;
      if (rail.scrollWidth - rail.clientWidth < 4) return;
      rail.scrollLeft += ev.deltaY;
      ev.preventDefault();
    }, { passive: false });
  }

  function syncScopeFade() {
    const rail = refs.scopes;
    if (!rail) return;
    const over = rail.scrollWidth - rail.clientWidth > 4;
    rail.classList.toggle('faded', over);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Hero content
     ═══════════════════════════════════════════════════════════════════════ */
  function renderHero() {
    const cap = NS.bootstrap ? NS.bootstrap.capacity() : { engine: 'drop', indexed: store.state.entries.length, detail: '' };
    const empty = store.state.entries.length === 0;

    // Quick filters only make sense once there is something to filter.
    const chips = [
      { label: 'Photos', icon: 'image', q: 'kind:image' },
      { label: 'Music', icon: 'music', q: 'kind:audio' },
      { label: 'Videos', icon: 'video', q: 'kind:video' },
      { label: 'Documents', icon: 'doc', q: 'kind:doc kind:pdf' },
      { label: 'Big files', icon: 'gauge', q: 'size:>1gb' },
      { label: 'This week', icon: 'clock', q: 'after:week' },
    ];
    refs.heroChips.innerHTML = chips.map((chip, i) => `
      <button class="hero-chip" data-hero="${esc(chip.q)}" style="animation-delay:${i * 45}ms">
        <span data-icon="${chip.icon}"></span>${esc(chip.label)}
      </button>`).join('');
    ui.paintIcons(refs.heroChips);

    // The format strip doubles as the "what does it understand" answer.
    const formats = [
      ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['pdf', 'PDF'], ['doc', 'Docs'],
      ['sheet', 'Sheets'], ['code', 'Code'], ['archive', 'Archives'], ['model', 'Models'],
      ['disk', 'Disks'], ['font', 'Fonts'], ['data', 'Datasets'],
    ];
    refs.formatStrip.innerHTML = formats.map(([kind, label], i) => {
      const def = NS.kinds[kind];
      return `<button class="fmt" data-fmt="${kind}" style="--fc:${def.color};animation-delay:${i * 30}ms"><i></i>${esc(label)}</button>`;
    }).join('');

    renderHeroCta(empty, cap);
  }

  /* The hero's primary action: index this machine, in one click. */
  function renderHeroCta(empty, cap) {
    let host = $('#heroCta');
    if (!host) {
      host = el('div', { class: 'hero-cta', id: 'heroCta' });
      const anchor = refs.formatStrip || refs.heroChips;
      anchor.parentNode.insertBefore(host, anchor.nextSibling);
    }
    const isDesktop = cap.engine === 'desktop';
    if (empty) {
      host.className = 'hero-cta';
      host.innerHTML = `
        <button class="cta-primary" data-cta="${isDesktop ? 'scan-pc' : 'index'}">
          <span data-icon="${isDesktop ? 'drive' : 'folderPlus'}"></span>
          ${isDesktop ? 'Index this PC' : 'Index a folder'}
        </button>
        <button class="cta-ghost" data-cta="import"><span data-icon="download"></span>Add files</button>
        <p class="cta-hint">${isDesktop
          ? 'Nova walks every drive on this machine. Nothing is uploaded.'
          : 'Or drop a folder anywhere on this window. Nothing is uploaded.'}</p>`;
    } else {
      host.className = 'hero-cta quiet';
      host.innerHTML = `
        <button class="cta-ghost" data-cta="index"><span data-icon="plus"></span>Index another folder</button>
        <span class="cta-count">${fmtNum(cap.indexed)} files · ${cap.roots || 1} location${(cap.roots || 1) === 1 ? '' : 's'}</span>`;
    }
    ui.paintIcons(host);
    host.querySelectorAll('[data-cta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.cta;
        if (act === 'index') indexFolders();
        else if (act === 'scan-pc') NS.bootstrap.scanThisPc();
        else if (act === 'import') refs.fileInput.click();
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Search field
     ═══════════════════════════════════════════════════════════════════════ */
  function bindField() {
    const input = refs.query;
    input.addEventListener('focus', () => {
      refs.field.classList.add('focus');
      if (state.view !== 'search' && state.view !== 'starred' && state.view !== 'recent') setView('search', { keepQuery: true });
    });
    input.addEventListener('blur', () => setTimeout(() => {
      refs.field.classList.remove('focus');
      hideSuggest();
    }, 140));
    input.addEventListener('input', () => {
      state.query = input.value;
      // While a burst of typing is in flight keep the first paint small; a
      // trailing pass restores the full page once the keyboard goes quiet.
      const bursting = Date.now() - (state._lastKey || 0) < 220;
      state._lastKey = Date.now();
      state.renderLimit = bursting ? 48 : 80;
      clearTimeout(bindField._grow);
      bindField._grow = setTimeout(() => {
        if (state.renderLimit !== 80) { state.renderLimit = 80; runSearch(); }
      }, 260);
      state.smartDismissed.clear();
      state.forceMode = null;
      refs.field.classList.toggle('typing', true);
      clearTimeout(bindField._t);
      bindField._t = setTimeout(() => refs.field.classList.remove('typing'), 320);
      refs.btnClear.hidden = !input.value;
      if (state.view === 'library') setView('search', { keepQuery: true, silent: true });
      runSearch();
      renderSuggest();
    });
    input.addEventListener('keydown', onQueryKeydown);

    refs.btnClear.addEventListener('click', () => {
      input.value = '';
      state.query = '';
      state.chipKind = null;
      refs.btnClear.hidden = true;
      hideSuggest();
      runSearch();
      input.focus();
    });

    refs.smartToggle.addEventListener('click', () => {
      const on = !store.state.settings.smart;
      store.setSettings({ smart: on });
      refs.smartToggle.setAttribute('aria-pressed', String(on));
      if (!on) state.smartDismissed.clear();
      runSearch();
      ui.toast(on ? 'Smart language on — sentences become filters' : 'Smart language off', 'info', 'sparkles');
    });
    refs.smartToggle.setAttribute('aria-pressed', String(!!store.state.settings.smart));
    const kbd = $('#fieldKbd');
    if (kbd) kbd.textContent = `${modKey}K`;

    refs.btnIndex.addEventListener('click', indexFolders);
    $('#railHome').addEventListener('click', () => {
      input.value = '';
      state.query = '';
      state.chipKind = null;
      refs.btnClear.hidden = true;
      setView('search', { keepQuery: true, silent: true });
      runSearch();
    });
  }

  function onQueryKeydown(ev) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      ev.stopPropagation();
      if (state.suggestItems.length && !refs.suggest.hidden) {
        state.suggestIndex = (state.suggestIndex + 1) % state.suggestItems.length;
        paintSuggestActive();
      } else {
        moveActive(1);
      }
      return;
    }
    if (ev.key === 'ArrowUp' && state.suggestItems.length && !refs.suggest.hidden && state.suggestIndex >= 0) {
      ev.preventDefault();
      ev.stopPropagation();
      state.suggestIndex--;
      if (state.suggestIndex < 0) state.suggestIndex = -1;
      paintSuggestActive();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      if (state.suggestIndex >= 0 && state.suggestItems[state.suggestIndex]) {
        applySuggestion(state.suggestItems[state.suggestIndex]);
        return;
      }
      runSearch({ commit: true });
      if (state.run && state.run.results.length) {
        state.activeId = state.run.results[0].entry.id;
        paintActive();
        openPreview(entryById(state.activeId));
      }
      hideSuggest();
      return;
    }
    if (ev.key === 'Escape') {
      if (!refs.suggest.hidden) { hideSuggest(); ev.stopPropagation(); return; }
      if (refs.query.value) {
        refs.query.value = '';
        state.query = '';
        refs.btnClear.hidden = true;
        runSearch();
      } else refs.query.blur();
    }
    if (ev.key === 'Tab' && !refs.suggest.hidden && state.suggestItems.length) {
      ev.preventDefault();
      ev.stopPropagation();
      applySuggestion(state.suggestItems[0]);
    }
  }

  function renderSuggest() {
    const q = state.query.trim();
    if (!q || document.activeElement !== refs.query) { hideSuggest(); return; }
    const items = search.suggestions(q, store.state.entries).map((s) => ({
      type: s.type, label: s.label, hint: s.hint, icon: s.icon, query: s.query,
      title: s.label,
    }));
    const files = (state.run?.results || []).slice(0, 4).map((r) => ({
      type: 'file', label: r.entry.name, hint: parentFolder(r.entry), icon: NS.kindOf(r.entry).icon,
      entry: r.entry, title: r.entry.name,
    }));
    state.suggestItems = [...items, ...files];
    state.suggestIndex = -1;
    if (!state.suggestItems.length) { hideSuggest(); return; }
    let html = '';
    const filterItems = items.filter((i) => i.type !== 'file');
    const fileItems = state.suggestItems.filter((i) => i.type === 'file');
    if (filterItems.length) {
      html += '<div class="sg-label">Refine</div>';
      html += filterItems.map((item) => `<button class="sg-item" data-sg="${esc(item.query)}"><span data-icon="${item.icon}"></span><b>${highlightText(item.label, q)}</b><span class="sg-hint">${esc(item.hint)}</span></button>`).join('');
    }
    if (fileItems.length) {
      html += '<div class="sg-label">Jump to file</div>';
      html += fileItems.map((item) => `<button class="sg-item" data-sg-file="${esc(item.entry.id)}"><span data-icon="${item.icon}"></span><b>${highlightText(esc(item.entry.name), q)}</b><span class="sg-hint">${esc(item.hint)}</span></button>`).join('');
    }
    refs.suggest.innerHTML = html;
    refs.suggest.hidden = false;
    ui.paintIcons(refs.suggest);
    refs.suggest.querySelectorAll('[data-sg]').forEach((b) => b.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      applyQuery(b.dataset.sg);
    }));
    refs.suggest.querySelectorAll('[data-sg-file]').forEach((b) => b.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      hideSuggest();
      const entry = entryById(b.dataset.sgFile);
      if (entry) { state.activeId = entry.id; openPreview(entry); paintActive(); }
    }));
  }

  function highlightText(text, q) {
    const folded = search.normalize(text);
    const needle = search.normalize(q);
    const at = folded.indexOf(needle);
    if (!needle || at === -1) return esc(text);
    const raw = text.slice(at, at + needle.length);
    return esc(text.slice(0, at)) + `<mark>${esc(raw)}</mark>` + esc(text.slice(at + needle.length));
  }

  function paintSuggestActive() {
    const nodes = refs.suggest.querySelectorAll('.sg-item');
    nodes.forEach((n, i) => n.classList.toggle('active', i === state.suggestIndex));
    if (state.suggestIndex >= 0) nodes[state.suggestIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function hideSuggest() {
    refs.suggest.hidden = true;
    state.suggestIndex = -1;
    state.suggestItems = [];
  }

  function applySuggestion(item) {
    if (item.entry) {
      hideSuggest();
      state.activeId = item.entry.id;
      openPreview(item.entry);
      paintActive();
      return;
    }
    applyQuery(item.query);
  }

  function applyQuery(q) {
    state.forceMode = null;
    refs.query.value = q;
    state.query = q;
    refs.btnClear.hidden = !q;
    hideSuggest();
    refs.query.focus();
    runSearch();
  }

  function focusQuery() {
    setTimeout(() => refs.query.focus(), 60);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Smart language
     ═══════════════════════════════════════════════════════════════════════ */
  const KIND_WORDS = [
    [/^(photos?|pictures?|images?|pics?|screenshots?|wallpapers?)$/i, 'image', 'image', 'Pictures'],
    [/^(videos?|movies?|clips?|footage)$/i, 'video', 'video', 'Video'],
    [/^(music|songs?|audio|sounds?|tracks?|podcasts?)$/i, 'audio', 'audio', 'Audio'],
    [/^(pdfs?)$/i, 'pdf', 'pdf', 'PDF'],
    [/^(docs?|documents?|texts?|notes?|markdown)$/i, 'doc', 'doc', 'Documents'],
    [/^(spreadsheets?|sheets?|excel|csv)$/i, 'sheet', 'sheet', 'Sheets'],
    [/^(slides?|decks?|presentations?|pptx?|keynotes?)$/i, 'slide', 'slide', 'Slides'],
    [/^(code|scripts?|source)$/i, 'code', 'code', 'Code'],
    [/^(zips?|archives?|backups?)$/i, 'archive', 'archive', 'Archives'],
    [/^(fonts?|typefaces?)$/i, 'font', 'font', 'Fonts'],
    [/^(datasets?|data|json)$/i, 'data', 'data', 'Datasets'],
    [/^(designs?|psds?|blends?|figma)$/i, 'design', 'design', 'Design files'],
  ];

  const STOP = new Set(['the', 'a', 'an', 'my', 'me', 'show', 'find', 'get', 'all', 'any', 'of', 'in', 'on', 'at', 'for', 'from', 'file', 'files', 'that', 'this', 'these', 'those', 'with', 'and', 'or', 'to', 'is', 'are', 'was', 'were', 'be', 'been', 'edited', 'modified', 'created', 'changed', 'updated', 'made', 'i', 'we', 'you', 'it', 'please', 'some']);

  function analyzeSmart(text) {
    const chips = [];
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const kept = [];
    let i = 0;
    const push = (key, label, query, iconName) => {
      if (!chips.some((c) => c.key === key)) chips.push({ key, label, query, icon: iconName });
    };
    while (i < words.length) {
      const raw = words[i];
      const w = raw.replace(/[",.?!]+$/g, '');
      const lower = w.toLowerCase();
      // multi-word time phrases
      const pair = `${lower} ${(words[i + 1] || '').toLowerCase().replace(/[",.?!]+$/g, '')}`;
      if (pair === 'last week' || lower === 'thisweek' || lower === 'weekly') { push('after:week', 'last week', 'after:week', 'clock'); i += pair === 'last week' ? 2 : 1; continue; }
      if (pair === 'last month') { push('after:month', 'last month', 'after:month', 'calendar'); i += 2; continue; }
      if (pair === 'last year') { push('after:year', 'this year', 'after:year', 'calendar'); i += 2; continue; }
      if (pair === 'this week') { push('after:week', 'this week', 'after:week', 'clock'); i += 2; continue; }
      if (lower === 'today' || lower === 'tonight') { push('after:today', 'today', 'after:today', 'clock'); i++; continue; }
      if (lower === 'yesterday') { push('yesterday', 'yesterday', 'after:yesterday', 'clock'); i++; continue; }
      if (lower === 'recent' || lower === 'latest' || lower === 'new' || lower === 'newest') { push('after:week', 'recent', 'after:week', 'clock'); i++; continue; }
      if (lower === 'about' || lower === 'regarding' || lower === 'mentioning' || lower === 'containing' || lower === 'named' || lower === 'called') { i++; continue; }

      let matchedKind = false;
      for (const [re, kind, iconName, label] of KIND_WORDS) {
        if (re.test(raw)) { push(`kind:${kind}`, label, `kind:${kind}`, iconName); i++; matchedKind = true; break; }
      }
      if (matchedKind) continue;

      if (/^(big|large|huge|heavy)$/.test(lower)) { push('size:big', 'over 100 MB', 'size:>100mb', 'gauge'); i++; continue; }
      if (/^(giant|enormous|massive)$/.test(lower)) { push('size:huge', 'over 1 GB', 'size:>1gb', 'gauge'); i++; continue; }
      if (/^(small|tiny|light)$/.test(lower)) { push('size:small', 'under 1 MB', 'size:<1mb', 'gauge'); i++; continue; }
      if (/^(starred|favorite|favourite|favorites|favourites|pinned)$/.test(lower)) {
        const pin = /pin/.test(lower);
        push(pin ? 'is:pinned' : 'is:starred', pin ? 'pinned' : 'starred', pin ? 'is:pinned' : 'is:starred', pin ? 'pin' : 'star');
        i++; continue;
      }
      if (/^(downloaded|downloads)$/.test(lower)) { push('in:downloads', 'in Downloads', 'in:Downloads', 'download'); i++; continue; }
      if (/^(screenshots?)$/.test(lower)) { push('in:screenshot', 'in Screenshots', 'in:Screenshot', 'image'); i++; continue; }
      if (/^(wallpaper|wallpapers|backgrounds?)$/.test(lower)) { push('tag:wallpaper', 'wallpapers', 'tag:wallpaper', 'image'); i++; continue; }

      // "from <place>" — keep place as token
      if (lower === 'from' || lower === 'in' || lower === 'near') { i++; continue; }

      if (STOP.has(lower)) { i++; continue; }
      kept.push(w);
      i++;
    }
    const kindChips = chips.filter((c) => c.key.startsWith('kind:'));
    const filterChips = chips.filter((c) => !c.key.startsWith('kind:'));
    const keywords = kept.join(' ');
    const filters = chips.map((c) => c.query).join(' ');
    let mode = 'both';
    let keywordHits = 0;
    let filterHits = 0;
    if (keywords) {
      keywordHits = search.run(store.state.entries, keywords, { fuzzy: true }).total;
      filterHits = search.run(store.state.entries, filters, { fuzzy: true }).total;
      if (!keywordHits && filterChips.length) mode = 'filters';
      else if (!filterHits) mode = 'keywords';
    } else if (filters) {
      mode = 'filters';
    } else {
      mode = 'keywords';
    }
    const effective = mode === 'keywords' ? keywords : mode === 'filters' ? filters : `${keywords} ${filters}`.trim();
    return { chips, tokens: kept, effective, kindChips, keywords, filters, mode, keywordHits };
  }

  function smartQuery() {
    const s = store.state.settings;
    if (!s.smart || !state.query.trim()) { state.lastSmart = []; return { query: state.query, chips: [] }; }
    const analysis = analyzeSmart(state.query);
    const chips = analysis.chips.filter((c) => !state.smartDismissed.has(c.key));
    state.lastSmart = chips;
    state.smartMode = analysis.mode;
    state.smartKeywords = analysis.keywords;
    state.smartFilters = analysis.filters;
    return { query: analysis.effective, chips, mode: analysis.mode, keywords: analysis.keywords };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Effective query + run
     ═══════════════════════════════════════════════════════════════════════ */
  function filterQuery() {
    const parts = [];
    const { sizes, dates, flags } = state.filters;
    sizes.forEach((size) => {
      if (size === 'tiny') parts.push('size:<100kb');
      if (size === 'small') parts.push('size:>100kb size:<10mb');
      if (size === 'big') parts.push('size:>10mb size:<500mb');
      if (size === 'huge') parts.push('size:>500mb');
    });
    dates.forEach((d) => parts.push(`after:${d}`));
    flags.forEach((f) => parts.push(`is:${f}`));
    return parts.join(' ');
  }

  function scopeKinds() {
    const scope = SCOPES.find((s) => s.id === state.scope);
    return scope && scope.kinds ? scope.kinds : null;
  }

  function runSearch(opts = {}) {
    const smart = smartQuery();
    let smartEffective = smart.query;
    if (state.forceMode) {
      const kw = state.smartKeywords || '';
      const fl = state.smartFilters || '';
      smartEffective = state.forceMode === 'keywords' ? kw : state.forceMode === 'filters' ? fl : `${kw} ${fl}`.trim();
    }
    const effective = [smartEffective, filterQuery()].filter(Boolean).join(' ').trim();
    const entries = entriesForView();
    const run = search.run(entries, effective, {
      sort: state.sort,
      showHidden: store.state.settings.showHidden,
      fuzzy: store.state.settings.fuzzy !== false,
      kindsAny: state.chipKind ? [state.chipKind] : null,
      scopeKinds: scopeKinds(),
    });
    state.run = run;
    state.lastTook = run.took;
    if (run.took != null && run.total > 0) {
      state.recentTook = (state.recentTook || []).concat(run.took).slice(-30);
    }
    state.smartChips = smart.chips;
    state.effectiveQuery = effective;
    if (state.view === 'search' || state.view === 'starred' || state.view === 'recent') {
      const hasQuery = !!effective.trim();
      const showResults = hasQuery || state.view !== 'search' || state.chipKind || state.filters.sizes.size || state.filters.dates.size || state.filters.flags.size;
      refs.app.dataset.mode = showResults ? 'results' : 'hero';
      refs.hero.hidden = showResults;
      if (!showResults) renderHistory();
      refs.results.hidden = !showResults;
      if (showResults) { renderResults(run); renderUnderField(run); }
      else renderUnderField(run, { hero: true });
    } else {
      renderUnderField(run);
    }
    if (opts.commit && store.state.settings.rememberHistory) {
      store.logSearch({ query: refs.query.value.trim(), scope: state.scope, count: run.total });
      renderHistory();
    }
    refreshMetaLite();
    if (refs.hero && !refs.hero.hidden && refs.heroStats) {
      const ms = state.lastTook != null ? Math.max(1, Math.round(state.lastTook)) : '—';
      const median = refs.heroStats.querySelectorAll('.stat b')[3];
      if (median) median.innerHTML = `${ms}<span class="unit">ms</span>`;
    }
  }

  /* Pre-fold the corpus while the UI is idle so the first keystroke is instant. */
  function warmIndex() {
    const entries = store.state.entries;
    if (!entries || entries.length < 400) return;
    // Let the render settle first: warming is never allowed to compete with
    // the frame the user is looking at.
    const kick = () => { try { NS.search.warm(entries); } catch {} };
    if (window.requestIdleCallback) window.requestIdleCallback(kick, { timeout: 1800 });
    else setTimeout(kick, 700);
  }

  function refreshMetaLite() {
    if (!refs.resultMeta || !state.run) return;
    const totalSize = state.run.results.reduce((s, r) => s + (r.entry.size || 0), 0);
    refs.resultMeta.innerHTML = `<b>${fmtNum(state.run.total)}</b> ${state.run.total === 1 ? 'match' : 'matches'} · ${fmtBytes(totalSize)} · <b>${fmtTime(state.run.took)}</b> · scanned ${fmtNum(state.run.scanned)}`;
  }

  function entriesForView() {
    if (state.view === 'starred') return store.state.entries.filter((e) => e.starred);
    return store.state.entries;
  }

  const SMART_MODE_LABEL = { both: 'Words + filters', keywords: 'Words only', filters: 'Filters only' };
  function effectiveMode() {
    return state.forceMode || state.smartMode || 'both';
  }

  function renderUnderField(run, opts = {}) {
    const wrap = refs.underField;
    if (opts.hero) {
      wrap.innerHTML = `
        <span class="uf-item">${icon('lock', { size: 13 })}On-device only</span><span class="uf-sep"></span>
        <span class="uf-item">${icon('bolt', { size: 13 })}<b>${fmtNum(store.state.entries.length)}</b> entries warm in memory</span><span class="uf-sep"></span>
        <span class="uf-item">${icon('gauge', { size: 13 })}<b>${state.lastTook != null ? Math.max(1, Math.round(state.lastTook)) : '—'} ms</b> last query</span>`;
      return;
    }
    const smartChips = (state.smartChips || []).map((chip) => `<button class="uf-filter" data-smart="${esc(chip.key)}" title="Remove this interpretation">${icon(chip.icon, { size: 10 })}${esc(chip.label)}${icon('close', { size: 9 })}</button>`).join('');
    wrap.innerHTML = `
      <span class="uf-item">${icon('search', { size: 13 })}<b>${fmtNum(run.total)}</b> ${run.total === 1 ? 'result' : 'results'} in <b>${fmtTime(run.took)}</b></span>
      <span class="uf-sep"></span>
      <span class="uf-item">${icon('layers', { size: 13 })}scanned <b>${fmtNum(run.scanned)}</b> entries</span>
      ${run.loose ? `<span class="uf-sep"></span><span class="uf-item" style="color:var(--warn)">${icon('wand', { size: 13 })}loose fuzzy mode</span>` : ''}
      ${run.kindsSelected.length ? `<span class="uf-sep"></span><span class="uf-item">${icon('filter', { size: 13 })}${run.kindsSelected.map((k) => `<span class="uf-filter">${esc(NS.kinds[k]?.label || k)}</span>`).join(' ')}</span>` : ''}
      ${smartChips ? `<span class="uf-sep"></span><span class="uf-item" style="gap:5px">${icon('sparkles', { size: 13 })}${smartChips}</span>` : ''}
      ${(state.smartKeywords && state.smartFilters) ? `<span class="uf-sep"></span><button class="uf-toggle" data-smart-mode="${effectiveMode()}" title="Cycle: words + filters → words only → filters only">${icon('swap', { size: 12 })}${SMART_MODE_LABEL[effectiveMode()]}</button>` : ''}`;
    wrap.querySelectorAll('[data-smart-mode]').forEach((btn) => btn.addEventListener('click', () => {
      const cur = effectiveMode();
      state.forceMode = cur === 'both' ? 'keywords' : cur === 'keywords' ? 'filters' : 'both';
      runSearch();
    }));
    wrap.querySelectorAll('[data-smart]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.smartDismissed.add(btn.dataset.smart);
        runSearch();
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Results rendering
     ═══════════════════════════════════════════════════════════════════════ */
  function nameHTML(entry, indices) {
    const name = entry.name;
    const dot = name.lastIndexOf('.');
    const hasExt = dot > 0 && dot > name.length - 9 && dot < name.length - 1;
    const stem = hasExt ? name.slice(0, dot) : name;
    const ext = hasExt ? name.slice(dot) : '';
    const idx = indices || [];
    const stemIdx = idx.filter((i) => i < stem.length);
    const extIdx = idx.filter((i) => i >= stem.length).map((i) => i - stem.length);
    return `${search.highlight(stem, stemIdx)}${ext ? `<span class="ext">${search.highlight(ext, extIdx)}</span>` : ''}`;
  }

  function thumbHTML(entry, def) {
    if (entry.thumb) return `<img src="${esc(entry.thumb)}" alt="" loading="lazy" decoding="async">`;
    return icon(def.icon, { size: 20 });
  }

  function rowHTML(item, index, view) {
    const entry = item.entry;
    const def = NS.kindOf(entry);
    const delay = Math.min(index, 14) * 22;
    const starred = entry.starred;
    const pinned = entry.pinned || store.state.pins.includes(entry.id);
    const tags = (entry.tags || []).slice(0, 3);
    const today = entry.modified && new Date(entry.modified).toDateString() === new Date().toDateString();
    const badge = entry.badge ? `<span class="r-badge" style="--bc:${badgeColor(entry.badge.tone)}">${esc(entry.badge.text)}</span>` : '';
    const subTags = tags.map((t) => `<span class="r-tag">#${esc(t)}</span>`).join('');
    const gmeta = `${esc(def.label)} · ${fmtBytes(entry.size)} · ${fmtDate(entry.modified)}`;
    return `<article class="row" data-id="${esc(entry.id)}" tabindex="-1" style="--kc:${def.color};animation-delay:${delay}ms">
      <div class="r-main">
        <div class="thumb ${entry.thumb ? '' : 'ext-thumb'}" data-ext="${esc((entry.ext || def.label).slice(0, 6))}">${thumbHTML(entry, def)}</div>
        <div class="r-text">
          <div class="r-name">${nameHTML(entry, item.indices)}${pinned ? `<span class="flag" title="Pinned">${icon('pin', { size: 12 })}</span>` : ''}${starred ? `<span class="flag star" title="Starred">${icon('star', { size: 12 })}</span>` : ''}</div>
          <div class="r-sub">${badge}${subTags || `<span class="r-gmeta">${gmeta}</span>`}</div>
        </div>
      </div>
      <div class="r-loc">${icon('folder', { size: 12 })}<span>${esc(parentFolder(entry))}</span></div>
      <div class="r-kind-cell"><span class="pill" style="--kc:${def.color}">${icon(def.icon, { size: 10 })}${esc(def.label)}</span></div>
      <div class="r-size">${fmtBytes(entry.size)}</div>
      <div class="r-date ${today ? 'today' : ''}">${fmtDate(entry.modified)}</div>
      <div class="r-actions">
        <button class="mini-btn ${starred ? 'on' : ''}" data-act="star" title="Star (S)">${icon('star', { size: 14 })}</button>
        <button class="mini-btn" data-act="more" title="More">${icon('more', { size: 14 })}</button>
      </div>
    </article>`;
  }

  /* Update an existing row in place (fast typing path). */
  function patchRow(row, item, index) {
    const entry = item.entry;
    const def = NS.kindOf(entry);
    row.dataset.id = entry.id;
    row.style.setProperty('--kc', def.color);
    row.style.animationDelay = `${Math.min(index, 14) * 22}ms`;
    const nameEl = row.querySelector('.r-name');
    if (nameEl) {
      const wanted = nameHTML(entry, item.indices) + flagHTML(entry);
      if (nameEl.innerHTML !== wanted) nameEl.innerHTML = wanted;
    }
    const locEl = row.querySelector('.r-loc span');
    const loc = parentFolder(entry);
    if (locEl && locEl.textContent !== loc) locEl.textContent = loc;
    const subEl = row.querySelector('.r-sub');
    if (subEl) {
      const wanted = (entry.badge ? `<span class="r-badge" style="--bc:${badgeColor(entry.badge.tone)}">${esc(entry.badge.text)}</span>` : '')
        + ((entry.tags || []).slice(0, 3).map((t) => `<span class="r-tag">#${esc(t)}</span>`).join('')
        || `<span class="r-gmeta">${esc(`${def.label} · ${fmtBytes(entry.size)} · ${fmtDate(entry.modified)}`)}</span>`);
      if (subEl.innerHTML !== wanted) subEl.innerHTML = wanted;
    }
    const setText = (sel, text) => { const n = row.querySelector(sel); if (n && n.textContent !== text) n.textContent = text; };
    setText('.r-size', fmtBytes(entry.size));
    setText('.r-date', fmtDate(entry.modified));
    const thumb = row.querySelector('.thumb');
    if (thumb) {
      const ext = (entry.ext || def.label).slice(0, 6);
      if (thumb.dataset.ext !== ext) thumb.dataset.ext = ext;
      const wanted = entry.thumb ? 'img' : 'svg';
      if (!thumb.firstElementChild || thumb.firstElementChild.tagName.toLowerCase() !== wanted) {
        thumb.innerHTML = thumbHTML(entry, def);
        thumb.classList.toggle('ext-thumb', !entry.thumb);
      }
    }
    // The kind pill is row-recycled too: an .mp4 slot can become an .mp3.
    const pill = row.querySelector('.r-kind-cell .pill');
    if (pill) {
      const label = def.label;
      if (pill.dataset.kind !== entry.kind) {
        pill.dataset.kind = entry.kind;
        pill.style.setProperty('--kc', def.color);
        pill.innerHTML = `${icon(def.icon, { size: 10 })}${esc(label)}`;
      } else if (pill.textContent !== label) {
        pill.textContent = label;
      }
    }
  }

  function flagHTML(entry) {
    const pinned = entry.pinned || store.state.pins.includes(entry.id);
    return (pinned ? `<span class="flag" title="Pinned">${icon('pin', { size: 12 })}</span>` : '')
      + (entry.starred ? `<span class="flag star" title="Starred">${icon('star', { size: 12 })}</span>` : '');
  }

  function badgeColor(tone) {
    return { violet: '#a78bfa', cyan: '#22d3ee', green: '#34d399', amber: '#fbbf24', rose: '#fb7185' }[tone] || '#a78bfa';
  }

  function dayBucket(ts) {
    const now = new Date();
    const d = new Date(ts || 0);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (d.getTime() >= startToday) return 'Today';
    if (d.getTime() >= startToday - 86400e3) return 'Yesterday';
    if (d.getTime() >= startToday - 6 * 86400e3) return 'Earlier this week';
    if (d.getTime() >= startToday - 30 * 86400e3) return 'This month';
    return 'Older';
  }

  function renderResults(run) {
    const list = refs.list;
    list.dataset.layout = state.layout;
    refs.listColumns.style.display = state.layout === 'grid' ? 'none' : '';
    viewTitle(run);
    renderKindChips(run);
    renderActiveFilters();

    const items = run.results.slice(0, state.renderLimit);
    if (!run.results.length) {
      list.innerHTML = '';
      renderEmpty(run);
      refs.emptyState.hidden = false;
      refs.list.hidden = false;
      paintActive();
      updateSelectionBar();
      return;
    }
    refs.emptyState.hidden = true;

    let html = '';
    if (state.view === 'recent') {
      let bucket = null;
      let count = 0;
      const buckets = [];
      for (const item of items) {
        const b = dayBucket(item.entry.modified);
        if (b !== bucket) { bucket = b; buckets.push({ name: b, items: [] }); }
        buckets[buckets.length - 1].items.push(item);
        count++;
      }
      html = buckets.map((group) => `
        <div class="group-head"><span>${esc(group.name)}</span><i>${group.items.length}</i><em></em></div>
        ${group.items.map((item, i) => rowHTML(item, i, state.view)).join('')}`).join('');
    } else {
      html = items.map((item, i) => rowHTML(item, i, state.view)).join('');
    }

    if (run.results.length > items.length) {
      html += `<button class="load-more" id="loadMore">Load ${Math.min(120, run.results.length - items.length)} more · ${fmtNum(run.results.length - items.length)} remaining</button>`;
    }
    list.hidden = false;
    const recycle = state.layout === 'list' && state.view !== 'recent'
      && list.querySelectorAll('article.row').length === items.length;
    if (recycle) {
      // Same geometry, new content: patch in place so the browser never
      // re-parses 80 rows of markup while the user is still typing.
      const rows = list.querySelectorAll('article.row');
      for (let i = 0; i < items.length; i++) patchRow(rows[i], items[i], i);
      const tail = list.querySelector('.load-more');
      if (tail) tail.remove();
    } else {
      list.innerHTML = html;
      if (html.includes('data-icon')) ui.paintIcons(list);
    }
    const more = document.getElementById('loadMore');
    if (more) more.addEventListener('click', () => { state.renderLimit += 120; renderResults(run); });

    if (!state.activeId || !entryById(state.activeId)) {
      state.activeId = items[0].entry.id;
    }
    paintActive();
    updateSelectionBar();
  }

  function viewTitle(run) {
    const map = { search: 'Results', starred: 'Starred', recent: 'Recent activity' };
    let title = map[state.view] || 'Results';
    if (state.view === 'search') {
      if (state.chipKind) title = NS.kinds[state.chipKind]?.plural || 'Results';
      else if (!state.effectiveQuery && state.scope !== 'everything') title = SCOPES.find((s) => s.id === state.scope)?.label || 'Results';
      else if (!state.effectiveQuery) title = 'All files';
    }
    refs.resultsTitle.textContent = title;
  }

  function renderKindChips(run) {
    const wrap = refs.kindChips;
    if (!run.facets.length) { wrap.innerHTML = ''; return; }
    const facets = run.facets.slice(0, 9);
    wrap.innerHTML = facets.map((f, i) => `
      <button class="kind-chip ${state.chipKind === f.kind ? 'on' : ''}" data-chip="${f.kind}" style="--kc:${f.color};animation-delay:${i * 25}ms" title="Filter to ${esc(f.plural)}">
        ${icon(f.icon, { size: 13 })}<span>${esc(f.plural)}</span><span class="kc-count">${fmtNum(f.count)}</span>
      </button>`).join('') + (state.chipKind ? `<button class="kind-chip" data-chip="" style="--kc:var(--faint)">${icon('close', { size: 12 })}<span>Clear format</span></button>` : '');
    wrap.querySelectorAll('[data-chip]').forEach((btn) => btn.addEventListener('click', () => {
      const kind = btn.dataset.chip;
      state.chipKind = !kind || state.chipKind === kind ? null : kind;
      state.renderLimit = 80;
      runSearch();
    }));
  }

  function filterLabels() {
    const out = [];
    if (state.chipKind) out.push({ key: `kind`, label: `Format: ${NS.kinds[state.chipKind]?.label || state.chipKind}`, clear: () => { state.chipKind = null; } });
    state.filters.sizes.forEach((s) => out.push({
      key: `size-${s}`, label: { tiny: 'Under 100 KB', small: '100 KB – 10 MB', big: '10 – 500 MB', huge: 'Over 500 MB' }[s],
      clear: () => state.filters.sizes.delete(s),
    }));
    const dateLabels = { today: 'Modified today', week: 'This week', month: 'This month', year: 'This year', day: 'Modified today' };
    state.filters.dates.forEach((d) => out.push({
      key: `date-${d}`, label: dateLabels[d] || `After ${d}`,
      clear: () => state.filters.dates.delete(d),
    }));
    const flagLabels = { starred: 'Starred', pinned: 'Pinned', thumb: 'Has artwork' };
    state.filters.flags.forEach((f) => out.push({
      key: `flag-${f}`, label: flagLabels[f] || f,
      clear: () => state.filters.flags.delete(f),
    }));
    return out;
  }

  function parsedFilterLabels() {
    const out = [];
    const parsed = state.run?.parsed;
    if (!parsed) return out;
    const f = parsed.filters;
    const uiSizePreset = f.size.length > 1 && state.filters.sizes.size > 0;
    if (uiSizePreset) return out;
    f.kinds.forEach((k) => out.push({ key: `qkind:${k.value}`, label: `Format: ${NS.kinds[k.value]?.label || k.value}` }));
    f.exts.forEach((x) => out.push({ key: `qext:${x.value}`, label: `Extension: .${x.value}` }));
    f.tags.forEach((t) => out.push({ key: `qtag:${t.value}`, label: `Tag: ${t.value}` }));
    f.dirs.forEach((d) => out.push({ key: `qdir:${d.value}`, label: `Folder: ${d.value}` }));
    f.flags.forEach((fl) => out.push({ key: `qflag:${fl.value}`, label: { starred: 'Starred', pinned: 'Pinned', recent: 'Recent', thumb: 'Has artwork' }[fl.value] || fl.value }));
    if (f.after) out.push({ key: 'qafter', label: `After ${new Date(f.after).toLocaleDateString()}` });
    f.size.forEach((sz) => out.push({ key: `qsize:${sz.op}${sz.value}`, label: `Size ${sz.op === '=' ? '=' : sz.op} ${fmtBytes(sz.value)}` }));
    return out;
  }

  function stripQueryFilter(key) {
    const [kind, value] = key.split(/:(.*)/);
    const raw = state.query.trim();
    if (!raw) return;
    let next = raw;
    if (kind === 'qkind') next = raw.replace(new RegExp(`(^|\\s)(-?)(kind|type|format):\\s*"?${escRe(value)}"?`, 'gi'), ' ');
    if (kind === 'qext') next = raw.replace(new RegExp(`(^|\\s)(-?)(ext):\\s*"?${escRe(value)}"?`, 'gi'), ' ');
    if (kind === 'qtag') next = raw.replace(new RegExp(`(^|\\s)(-?)(tag|tags):\\s*"?${escRe(value)}"?`, 'gi'), ' ');
    if (kind === 'qdir') next = raw.replace(new RegExp(`(^|\\s)(-?)(in|folder|path):\\s*"${escRe(value)}"`, 'gi'), ' ');
    if (kind === 'qflag') next = raw.replace(new RegExp(`(^|\\s)(-?)(is):\\s*${escRe(value)}`, 'gi'), ' ');
    if (kind === 'qafter') next = raw.replace(/(^|\s)(after|modified):\s*\S+/gi, ' ');
    if (kind === 'qsize') next = raw.replace(/(^|\s)size:\s*\S+/gi, ' ');
    applyQuery(next.replace(/\s{2,}/g, ' ').trim());
  }

  function escRe(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function renderActiveFilters() {
    const labels = filterLabels();
    const parsedLabels = parsedFilterLabels();
    const wrap = refs.activeFilters;
    const count = state.filters.sizes.size + state.filters.dates.size + state.filters.flags.size;
    if (refs.filterCount) {
      refs.filterCount.hidden = count === 0;
      refs.filterCount.textContent = String(count);
    }
    refs.btnFilters.classList.toggle('on', count > 0);
    if (!labels.length && !parsedLabels.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    wrap.hidden = false;
    wrap.innerHTML = labels.map((l) => `<span class="af">${esc(l.label)}<button data-af="${esc(l.key)}" aria-label="Remove filter">${icon('close', { size: 9 })}</button></span>`).join('')
      + parsedLabels.map((l) => `<span class="af">${esc(l.label)}<button data-qaf="${esc(l.key)}" aria-label="Remove from query">${icon('close', { size: 9 })}</button></span>`).join('')
      + `<button class="af-clear" id="afClear">Clear all</button>`;
    wrap.querySelectorAll('[data-af]').forEach((btn) => btn.addEventListener('click', () => {
      const found = labels.find((l) => l.key === btn.dataset.af);
      if (found) { found.clear(); state.renderLimit = 80; runSearch(); }
    }));
    wrap.querySelectorAll('[data-qaf]').forEach((btn) => btn.addEventListener('click', () => stripQueryFilter(btn.dataset.qaf)));
    document.getElementById('afClear')?.addEventListener('click', () => {
      state.chipKind = null;
      state.filters.sizes.clear();
      state.filters.dates.clear();
      state.filters.flags.clear();
      syncFilterPopover();
      const stripped = state.query.replace(/(^|\s)(kind|type|format|ext|tag|tags|in|folder|path|is|after|before|modified|size):("[^"]*"|\S+)/gi, ' ').replace(/\s{2,}/g, ' ').trim();
      if (stripped !== state.query) { refs.query.value = stripped; state.query = stripped; refs.btnClear.hidden = !stripped; }
      runSearch();
    });
  }

  function renderEmpty(run) {
    const q = state.effectiveQuery || state.query;

    // Nothing indexed at all is a different situation from "no match":
    // it needs a first action, not a search tip.
    if (!store.state.entries.length) {
      const cap = NS.bootstrap ? NS.bootstrap.capacity() : { engine: 'drop' };
      const desktop = cap.engine === 'desktop';
      refs.emptyArt.innerHTML = ui.emptyArt('search');
      refs.emptyTitle.textContent = 'Nothing indexed yet';
      refs.emptyText.textContent = desktop
        ? 'Nova has not read this PC yet. Index every drive in one click — 240,000 files, names and metadata only, nothing uploaded.'
        : 'Choose a folder to search. Nova reads names, dates and sizes in place and can play any media inside it.';
      refs.emptyActions.innerHTML = `
        <button class="ghost-btn primary" data-empty-scan>${icon(desktop ? 'drive' : 'folderPlus', { size: 14 })}${desktop ? 'Index this PC' : 'Index a folder'}</button>
        <button class="ghost-btn" data-empty-import>${icon('download', { size: 14 })}Add files</button>`;
      refs.emptyActions.querySelector('[data-empty-scan]')?.addEventListener('click', () => {
        if (desktop) NS.bootstrap.scanThisPc(); else indexFolders();
      });
      refs.emptyActions.querySelector('[data-empty-import]')?.addEventListener('click', () => refs.fileInput.click());
      return;
    }
    const hasFilters = run.parsed.filters.active || state.chipKind || state.filters.sizes.size || state.filters.dates.size || state.filters.flags.size;
    refs.emptyArt.innerHTML = ui.emptyArt('search');
    refs.emptyTitle.textContent = state.view === 'starred' ? 'Nothing starred yet' : 'No signal for that query';
    refs.emptyText.textContent = state.view === 'starred'
      ? 'Star a file with S or the star button and it will wait for you here.'
      : hasFilters
        ? 'Your query is fine — the active filters are narrowing it to nothing. Try relaxing one.'
        : `Nothing matched “${q}”. Check the spelling, try fewer words, or search only part of the name.`;
    const actions = [];
    if (state.chipKind) actions.push({ label: 'Clear format filter', run: () => { state.chipKind = null; runSearch(); } });
    if (state.filters.sizes.size || state.filters.dates.size || state.filters.flags.size) actions.push({ label: 'Reset filters', run: () => { state.filters.sizes.clear(); state.filters.dates.clear(); state.filters.flags.clear(); syncFilterPopover(); runSearch(); } });
    if (q && state.smartChips?.length) actions.push({ label: 'Drop smart filters', run: () => { state.smartDismissed = new Set(state.smartChips.map((c) => c.key)); runSearch(); } });
    if (q) actions.push({ label: 'Search everything', run: () => { state.scope = 'everything'; state.chipKind = null; state.filters.sizes.clear(); state.filters.dates.clear(); state.filters.flags.clear(); renderScopes(); runSearch(); } });
    refs.emptyActions.innerHTML = actions.map((a, i) => `<button class="ghost-btn ${i === 0 ? 'primary' : ''}" data-empty="${i}">${a.icon ? icon(a.icon, { size: 14 }) : ''}${esc(a.label)}</button>`).join('');
    refs.emptyActions.querySelectorAll('[data-empty]').forEach((btn) => btn.addEventListener('click', () => actions[Number(btn.dataset.empty)].run()));
  }

  /* ---------- selection ---------- */
  function entryById(id) {
    return store.state.entries.find((e) => e.id === id) || null;
  }

  function activeItem() {
    if (!state.run || !state.activeId) return null;
    return state.run.results.find((r) => r.entry.id === state.activeId) || null;
  }

  function navRows() {
    return Array.from(refs.list.querySelectorAll('.row'));
  }

  function paintActive() {
    const rows = navRows();
    rows.forEach((row) => {
      row.classList.toggle('active', row.dataset.id === state.activeId);
      row.classList.toggle('selected', state.multi.has(row.dataset.id));
    });
    const active = rows.find((r) => r.dataset.id === state.activeId);
    if (active) active.scrollIntoView({ block: 'nearest' });
    const item = activeItem();
    if (item && refs.preview && !refs.preview.hidden) renderPreviewPanel(item.entry, { silent: true });
  }

  function moveActive(delta) {
    if (!state.run || !state.run.results.length) return;
    const rows = navRows();
    if (!rows.length) return;
    let index = rows.findIndex((r) => r.dataset.id === state.activeId);
    if (index === -1) index = 0;
    index = clamp(index + delta, 0, rows.length - 1);
    state.activeId = rows[index].dataset.id;
    paintActive();
    if (refs.preview && !refs.preview.hidden) renderPreviewPanel(entryById(state.activeId), { silent: true });
  }

  function selectActive(preview = false) {
    const entry = entryById(state.activeId);
    if (!entry) return;
    if (preview) openPreview(entry);
    paintActive();
  }

  function updateSelectionBar() {
    const count = state.multi.size;
    refs.selectionBar.hidden = count < 2;
    if (count >= 2) refs.selCount.textContent = `${count} selected`;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Result interactions
     ═══════════════════════════════════════════════════════════════════════ */
  function bindResults() {
    const list = refs.list;
    list.addEventListener('click', (ev) => {
      const row = ev.target.closest('.row');
      if (!row) return;
      hideSuggest();
      const id = row.dataset.id;
      const act = ev.target.closest('[data-act]');
      if (act) {
        ev.stopPropagation();
        if (act.dataset.act === 'star') { toggleStar(id); return; }
        if (act.dataset.act === 'more') { openRowMenu(entryById(id), act.getBoundingClientRect()); return; }
      }
      if (ev.metaKey || ev.ctrlKey) {
        if (state.multi.has(id)) state.multi.delete(id); else state.multi.add(id);
        state.activeId = id;
        updateSelectionBar();
        paintActive();
        return;
      }
      if (ev.shiftKey && state.activeId) {
        const rows = navRows();
        const from = rows.findIndex((r) => r.dataset.id === state.activeId);
        const to = rows.findIndex((r) => r.dataset.id === id);
        if (from !== -1 && to !== -1) {
          for (let i = Math.min(from, to); i <= Math.max(from, to); i++) state.multi.add(rows[i].dataset.id);
          updateSelectionBar();
        }
      } else {
        state.multi.clear();
        updateSelectionBar();
      }
      state.activeId = id;
      paintActive();
      const entry = entryById(id);
      if (entry) {
        if (entry.kind === 'folder') { drillInto(entry); return; }
        openPreview(entry);
      }
    });
    list.addEventListener('dblclick', (ev) => {
      const row = ev.target.closest('.row');
      if (!row) return;
      const entry = entryById(row.dataset.id);
      if (entry) openEntry(entry);
    });
    list.addEventListener('contextmenu', (ev) => {
      const row = ev.target.closest('.row');
      if (!row) return;
      ev.preventDefault();
      state.activeId = row.dataset.id;
      paintActive();
      openRowMenu(entryById(row.dataset.id), { left: ev.clientX, top: ev.clientY, width: 0, height: 0, right: ev.clientX, bottom: ev.clientY });
    });

    refs.results.addEventListener('pointerenter', () => { if (refs.suggest && !refs.suggest.hidden) hideSuggest(); });
    refs.selectionBar.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-sel]');
      if (!btn) return;
      const ids = [...state.multi];
      const entries = ids.map(entryById).filter(Boolean);
      const action = btn.dataset.sel;
      if (action === 'clear') { state.multi.clear(); updateSelectionBar(); paintActive(); return; }
      if (action === 'star') {
        entries.forEach((e) => { if (!e.starred) { e.starred = true; } });
        store.persist();
        paintActive();
        ui.toast(`Starred ${entries.length} files`, 'good', 'star');
      }
      if (action === 'copy') {
        U.copyText(entries.map((e) => e.path || e.name).join('\n')).then((ok) => ui.toast(ok ? `Copied ${entries.length} paths` : 'Clipboard unavailable', ok ? 'good' : 'warn', 'copy'));
      }
      if (action === 'reveal') {
        const ok = entries.every((e) => e.source === 'native') && window.nova;
        if (ok) entries.forEach((e) => window.nova.reveal(e.path));
        else ui.toast('Reveal needs indexed desktop files', 'warn', 'reveal');
      }
      if (action === 'preview') {
        const first = entries[0];
        if (first) openPreview(first);
      }
    });
  }

  function toggleStar(id) {
    const entry = entryById(id);
    if (!entry) return;
    entry.starred = !entry.starred;
    store.persist();
    if (refs.pvStar) {
      const current = state.previewEntry;
      if (current && current.id === id) refs.pvStar.classList.toggle('on', !!entry.starred);
    }
    paintActive();
    if (state.run) renderKindChips(state.run);
    ui.toast(entry.starred ? 'Starred · saved to this device' : 'Star removed', entry.starred ? 'good' : 'info', 'star');
    if (state.view === 'starred') runSearch();
  }

  function openRowMenu(entry, rect) {
    if (!entry) return;
    const items = [
      { id: 'open', label: 'Open preview', icon: 'eye', run: () => { state.activeId = entry.id; paintActive(); openPreview(entry); } },
      { id: 'peek', label: 'Peek fullscreen', icon: 'expand', key: 'Space', run: () => peek(entry) },
      { id: 'star', label: entry.starred ? 'Remove star' : 'Star file', icon: 'star', key: 'S', run: () => toggleStar(entry.id) },
      { sep: true },
      { id: 'copy', label: 'Copy path', icon: 'copy', key: `${modKey}C`, run: () => copyPath(entry) },
      { id: 'copyname', label: 'Copy name', icon: 'file', run: () => U.copyText(entry.name).then((ok) => ui.toast(ok ? 'Name copied' : 'Clipboard unavailable', ok ? 'good' : 'warn', 'copy')) },
      { id: 'save', label: 'Save extracted text', icon: 'download', run: () => saveEntry(entry) },
      { sep: true },
      { id: 'folder', label: 'Search this folder', icon: 'folder', run: () => drillInto(entry) },
      { id: 'tag', label: 'Add a tag…', icon: 'tag', run: () => addTagFlow(entry) },
    ];
    if (entry.source === 'native' && window.nova) {
      items.push({ sep: true });
      items.push({ id: 'reveal', label: 'Reveal in folder', icon: 'reveal', run: () => window.nova.reveal(entry.path) });
      items.push({ id: 'sysopen', label: 'Open with system app', icon: 'external', run: () => openEntry(entry) });
    }
    ui.showContextMenu(rect.left, rect.bottom || rect.top, items);
  }

  async function copyPath(entry) {
    const ok = window.nova?.isDesktop && entry.source === 'native'
      ? (await window.nova.copyPath(entry.path)).ok
      : await U.copyText(entry.path || entry.name);
    ui.toast(ok ? 'Path copied to clipboard' : 'Clipboard unavailable', ok ? 'good' : 'warn', 'copy');
  }

  function saveEntry(entry) {
    if (entry.content != null) {
      U.downloadBlob(new Blob([String(entry.content)], { type: 'text/plain' }), U.trimExt(entry.name) + '.txt');
      ui.toast('Extracted text saved', 'good', 'download');
      return;
    }
    ui.toast('This entry has no stored bytes — index real folders for save support', 'warn', 'info');
  }

  function addTagFlow(entry) {
    const tag = window.prompt(`Add a tag to “${entry.name}”`, '');
    if (!tag || !tag.trim()) return;
    store.addTag(entry.id, tag.trim().toLowerCase());
    ui.toast(`Tagged #${tag.trim().toLowerCase()}`, 'good', 'tag');
    if (state.previewEntry && state.previewEntry.id === entry.id) renderPreviewPanel(entry, { silent: true });
    runSearch();
  }

  function drillInto(entry) {
    const folder = entry.kind === 'folder' ? pathName(entry.path || entry.name) : parentFolder(entry);
    if (!folder) return;
    closePreview();
    setView('search', { keepQuery: true, silent: true });
    applyQuery(`in:"${folder}"`);
    ui.toast(`Searching inside “${folder}”`, 'info', 'folder');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Preview panel
     ═══════════════════════════════════════════════════════════════════════ */
  function bindPreview() {
    refs.pvClose.addEventListener('click', closePreview);
    refs.pvStar.addEventListener('click', () => state.previewEntry && toggleStar(state.previewEntry.id));
    refs.pvOpen.addEventListener('click', () => state.previewEntry && openEntry(state.previewEntry));
    refs.pvReveal.addEventListener('click', () => {
      const e = state.previewEntry;
      if (!e) return;
      if (e.source === 'native' && window.nova) window.nova.reveal(e.path);
      else if (e.kind === 'folder') drillInto(e);
      else ui.toast('Reveal is available for indexed desktop files', 'info', 'reveal');
    });
    refs.pvCopy.addEventListener('click', () => state.previewEntry && copyPath(state.previewEntry));
    refs.pvMore.addEventListener('click', (ev) => {
      if (!state.previewEntry) return;
      openRowMenu(state.previewEntry, { left: ev.clientX - 190, top: ev.clientY + 10, bottom: ev.clientY + 10 });
    });
    refs.pvPath.addEventListener('click', () => state.previewEntry && copyPath(state.previewEntry));
    refs.pvTags.addEventListener('click', (ev) => {
      const entry = state.previewEntry;
      if (!entry) return;
      const remove = ev.target.closest('[data-tag-remove]');
      if (remove) {
        store.removeTag(entry.id, remove.dataset.tagRemove);
        renderPreviewPanel(entry, { silent: true });
        return;
      }
      if (ev.target.closest('[data-tag-add]')) addTagFlow(entry);
    });
  }

  function updatePreviewVisibility() {
    if (window.innerWidth < 960 && refs.preview && !refs.preview.hidden) {
      refs.preview.classList.add('floating');
    } else refs.preview?.classList.remove('floating');
  }

  function openPreview(entry) {
    if (!entry) return;
    state.previewEntry = entry;
    refs.preview.hidden = false;
    updatePreviewVisibility();
    renderPreviewPanel(entry);
    hydratePreview(entry).then(() => {
      if (state.previewEntry && state.previewEntry.id === entry.id) renderPreviewPanel(entry, { silent: true });
    });
  }

  function closePreview() {
    refs.preview.hidden = true;
    NS.preview?.stopAudio?.();
    state.previewEntry = null;
  }

  function renderPreviewPanel(entry, opts = {}) {
    if (!entry) return;
    state.previewEntry = entry;
    const def = NS.kindOf(entry);
    refs.preview.style.setProperty('--kc', def.color);
    refs.pvScroll.scrollTop = opts.silent ? refs.pvScroll.scrollTop : 0;
    NS.preview.render(entry, {
      container: refs.pvMedia,
      queue: state.run ? state.run.results.map((r) => r.entry) : [entry],
      name: refs.pvName,
      path: refs.pvPath,
      meta: refs.pvMeta,
      tags: refs.pvTags,
      note: refs.pvNote,
      kind: refs.pvKind,
      star: refs.pvStar,
    });
    refs.pvOpen.innerHTML = `${icon(entry.kind === 'folder' ? 'folderOpen' : 'eye', { size: 15 })}<span>${entry.kind === 'folder' ? 'Open folder' : 'Open'}</span>`;
    refs.pvStar.classList.toggle('on', !!entry.starred);
    refs.pvStar.title = entry.starred ? 'Remove star' : 'Star';
    store.touchRecent(entry.id);
  }

  async function hydratePreview(entry) {
    if (entry.url || entry.content != null) return;
    try {
      if (entry.source === 'native' && window.nova) {
        const result = await window.nova.readPreview(entry.path, { kind: entry.kind });
        if (result.ok && result.kind === 'text') { entry.content = result.text; return; }
        if (result.ok && result.kind === 'media') {
          entry.url = `data:${result.mime};base64,${result.base64}`;
          return;
        }
        if (result.ok && result.kind === 'media-url') {
          entry.url = urlFor(result.url);
          return;
        }
        if (result.reason === 'file-too-large') entry.previewNote = 'File is large — open it in its native app.';
      }
      if (entry.source === 'browser') {
        const file = state.browserFiles.get(entry.path);
        if (!file) return;
        const kind = entry.kind;
        if (['image', 'video', 'audio'].includes(kind) && file.size < 40 * 1024 * 1024) {
          entry.url = URL.createObjectURL(file);
        } else if (['text', 'code', 'doc', 'data', 'sheet'].includes(kind) && file.size < 512 * 1024) {
          entry.content = await file.text();
        }
      }
    } catch (err) {
      console.warn('preview hydrate failed', err);
    }
  }

  function peek(entry) {
    if (!entry) return;
    if (entry.kind === 'folder') { drillInto(entry); return; }
    NS.preview.openLightbox(entry, state.run ? state.run.results.map((r) => r.entry) : [entry]);
  }

  async function openEntry(entry) {
    if (!entry) return;
    if (entry.kind === 'folder') { drillInto(entry); return; }
    if (entry.source === 'native' && window.nova) {
      const result = await window.nova.openPath(entry.path);
      if (!result.ok) ui.toast('Could not open this file with the system app', 'warn', 'info');
      return;
    }
    const hasPeek = entry.url || entry.content != null || entry.thumb || ['image', 'video', 'audio', 'doc', 'text', 'code', 'sheet', 'pdf', 'data', 'slide'].includes(entry.kind);
    if (hasPeek) peek(entry);
    else ui.toast('Sample entry — index a real folder to open its native file', 'info', 'info');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Views, scopes, layout, sort
     ═══════════════════════════════════════════════════════════════════════ */
  function bindViews() {
    $$('.rail .rub[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });
    $('#btnSettings').addEventListener('click', () => {
      ui.resetSettingsForm();
      ui.renderRoots(rootHandlers);
      ui.openOverlay('settingsOverlay');
    });
    $('#btnHelp').addEventListener('click', () => ui.openOverlay('shortcutsOverlay'));
    $('#btnShortcuts')?.addEventListener('click', () => ui.openOverlay('shortcutsOverlay'));
    $('#btnTheme').addEventListener('click', () => {
      const current = document.documentElement.dataset.theme;
      store.setSettings({ theme: current === 'light' ? 'dark' : 'light' });
      applyTheme();
      ui.resetSettingsForm();
    });
    refs.heroChips.addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-hero]');
      if (!chip) return;
      applyQuery(chip.dataset.hero);
    });
    refs.formatStrip.addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-fmt]');
      if (!chip) return;
      applyQuery(`kind:${chip.dataset.fmt}`);
    });
  }

  function setView(view, opts = {}) {
    state.view = view;
    state.multi.clear();
    updateSelectionBar();
    $$('.rail .rub[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('.deck').style.display = '';
    refs.scopes.parentElement.style.display = '';
    refs.hero.hidden = true;
    refs.results.hidden = true;
    refs.library.hidden = true;
    closePreview();
    if (view === 'library') {
      refs.app.dataset.mode = 'library';
      refs.library.hidden = false;
      renderLibrary();
      return;
    }
    if (!opts.keepQuery) {
      state.chipKind = null;
      refs.query.value = state.query = '';
      refs.btnClear.hidden = true;
    }
    state.renderLimit = 80;
    if (!opts.silent) {
      if (view === 'search' && !state.query) refs.query.focus();
    }
    if (view === 'recent') state.sort = 'date';
    setSort(state.view === 'recent' ? 'date' : state.sort, { silent: true });
    runSearch();
    if (view === 'search' && !state.query && !opts.silent) refs.query.focus();
  }

  function bindScopes() {
    refs.scopes.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-scope]');
      if (!btn) return;
      state.scope = btn.dataset.scope;
      state.renderLimit = 80;
      renderScopes();
      runSearch();
    });
  }

  function bindLayout() {
    $$('.results-tools [data-layout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.layout = btn.dataset.layout;
        $$('.results-tools [data-layout]').forEach((b) => b.classList.toggle('active', b === btn));
        store.setSettings({ layout: state.layout });
        if (state.run && refs.app.dataset.mode === 'results') renderResults(state.run);
      });
    });
    $$('.results-tools [data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout));
  }

  function bindFilters() {
    refs.btnFilters.addEventListener('click', () => {
      syncFilterPopover();
      ui.togglePopover('filterPop', refs.btnFilters);
    });
    $('#filterClose')?.addEventListener('click', () => { refs.filterPop.hidden = true; });
    $('#filterApply')?.addEventListener('click', () => { refs.filterPop.hidden = true; runSearch(); });
    $('#filterReset')?.addEventListener('click', () => {
      state.filters.sizes.clear();
      state.filters.dates.clear();
      state.filters.flags.clear();
      state.chipKind = null;
      syncFilterPopover();
      runSearch();
    });
    refs.filterSize.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-size]');
      if (!btn) return;
      toggleSet(state.filters.sizes, btn.dataset.size);
      syncFilterPopover();
      runSearch();
    });
    refs.filterDate.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-date]');
      if (!btn) return;
      const val = btn.dataset.date;
      const mapped = val === 'day' ? 'today' : val;
      state.filters.dates.clear();
      if (!btn.classList.contains('on')) state.filters.dates.add(mapped);
      syncFilterPopover();
      runSearch();
    });
    refs.filterFlags.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-flag]');
      if (!btn) return;
      toggleSet(state.filters.flags, btn.dataset.flag);
      syncFilterPopover();
      runSearch();
    });
    refs.listColumns.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-sort]');
      if (!btn) return;
      const key = btn.dataset.sort;
      const next = state.sort === key ? (key === 'date' ? 'dateAsc' : key === 'name' ? 'nameDesc' : 'date') : key;
      setSort(next);
    });
  }

  function toggleSet(set, value) {
    if (set.has(value)) set.delete(value); else set.add(value);
  }

  function syncFilterPopover() {
    refs.filterSize.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('on', state.filters.sizes.has(b.dataset.size)));
    refs.filterDate.querySelectorAll('[data-date]').forEach((b) => {
      const mapped = b.dataset.date === 'day' ? 'today' : b.dataset.date;
      b.classList.toggle('on', state.filters.dates.has(mapped));
    });
    refs.filterFlags.querySelectorAll('[data-flag]').forEach((b) => b.classList.toggle('on', state.filters.flags.has(b.dataset.flag)));
  }

  function bindSort() {
    refs.btnSort.addEventListener('click', () => {
      if (refs.sortPop.hidden) {
        refs.sortList.innerHTML = SORTS.map((s) => `<button class="pop-item ${state.sort === s.id ? 'active' : ''}" data-sort-id="${s.id}">${esc(s.label)}${icon('check', { size: 14 })}</button>`).join('');
        refs.sortList.querySelectorAll('[data-sort-id]').forEach((btn) => btn.addEventListener('click', () => {
          setSort(btn.dataset.sortId);
          refs.sortPop.hidden = true;
        }));
      }
      ui.togglePopover('sortPop', refs.btnSort);
    });
    ui.registerPopover('filterPop');
    ui.registerPopover('sortPop');
  }

  function setSort(id, opts = {}) {
    state.sort = id;
    const label = SORTS.find((s) => s.id === id)?.label || 'Relevance';
    if (refs.sortLabel) refs.sortLabel.textContent = label;
    $$('.list-columns .col').forEach((c) => {
      const key = c.dataset.sort;
      const on = (key === 'name' && (id === 'name' || id === 'nameDesc')) || (key === 'date' && (id === 'date' || id === 'dateAsc')) || (key === 'size' && (id === 'size' || id === 'sizeAsc')) || (key === 'kind' && id === 'kind');
      c.classList.toggle('sorted', on);
      c.classList.toggle('desc', on && (id === 'nameDesc' || id === 'dateAsc' || id === 'sizeAsc'));
    });
    if (refs.sortList && !refs.sortPop.hidden) {
      refs.sortList.querySelectorAll('[data-sort-id]').forEach((b) => b.classList.toggle('active', b.dataset.sortId === id));
    }
    if (!opts.silent && state.run) runSearch();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Library
     ═══════════════════════════════════════════════════════════════════════ */
  function bindLibrary() {
    refs.rootGrid.addEventListener('click', (ev) => {
      const add = ev.target.closest('[data-root-add]');
      if (add) { indexFolders(); return; }
      const remove = ev.target.closest('[data-root-remove]');
      if (remove) {
        ev.stopPropagation();
        removeRoot(remove.dataset.rootRemove);
        return;
      }
      const card = ev.target.closest('[data-root]');
      if (!card) return;
      const root = store.state.roots[card.dataset.root];
      if (!root) return;
      setView('search', { keepQuery: true, silent: true });
      applyQuery(`in:"${pathName(root.path) || root.name}"`);
    });
    refs.folderGrid.addEventListener('click', (ev) => {
      const card = ev.target.closest('[data-folder]');
      if (!card) return;
      setView('search', { keepQuery: true, silent: true });
      applyQuery(`in:"${card.dataset.folder}"`);
    });
  }

  function renderLibrary() {
    const roots = Object.values(store.state.roots).filter(Boolean);
    const entries = store.state.entries;
    const rootCards = roots.map((root) => {
      const files = entries.filter((e) => e.rootPath === root.path);
      const size = files.reduce((s, e) => s + (e.size || 0), 0);
      const kinds = new Set(files.map((e) => e.kind));
      return `<div class="root-card" data-root="${esc(root.id)}">
        <button class="icon-btn tiny rc-remove" data-root-remove="${esc(root.path)}" title="Stop indexing">${icon('close', { size: 12 })}</button>
        <div class="rc-top"><span class="rc-ic">${icon('drive', { size: 18 })}</span><div style="min-width:0"><b>${esc(root.name)}</b><small>${esc(root.path)}</small></div></div>
        <div class="rc-stats">
          <div><b>${fmtNum(files.length)}</b><span>files</span></div>
          <div><b>${fmtBytes(size)}</b><span>size</span></div>
          <div><b>${kinds.size}</b><span>formats</span></div>
        </div>
        <div class="rc-bar"><i style="width:${clamp((files.length / 6000) * 100, 4, 100)}%"></i></div>
      </div>`;
    }).join('');
    refs.rootGrid.innerHTML = rootCards + `<button class="root-card add" data-root-add><span data-icon="plus"></span><span>Index a folder from this machine</span><small style="font-family:var(--font-ui);color:var(--faint);font-size:10px">${window.nova?.isDesktop ? 'Native folder picker' : 'Browser folder import'}</small></button>`;
    ui.paintIcons(refs.rootGrid);

    const folders = Array.from(store.folderSummary().values()).sort((a, b) => b.count - a.count).slice(0, 60);
    refs.folderCount.textContent = `${folders.length} folders`;
    refs.folderGrid.innerHTML = folders.map((folder) => {
      const topKind = Array.from(folder.kinds.entries()).sort((a, b) => b[1] - a[1])[0];
      const def = NS.kinds[topKind?.[0]] || NS.kinds.other;
      return `<button class="folder-card" data-folder="${esc(folder.name)}">
        <span class="fc-ic" style="color:${def.color};background:color-mix(in srgb,${def.color} 12%,transparent)">${icon('folder', { size: 16 })}</span>
        <span class="fc-text"><b>${esc(folder.name)}</b><small>${fmtNum(folder.count)} files · ${fmtBytes(folder.size)}</small></span>
        ${icon('chevronRight', { size: 14 })}
      </button>`;
    }).join('') || '<div class="root-empty" style="grid-column:1/-1">No folders mapped yet — index a location to see its folder tree.</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Indexing bridges
     ═══════════════════════════════════════════════════════════════════════ */
  const rootHandlers = {
    indexFolders: () => indexFolders(),
    removeRoot: (path) => removeRoot(path),
    refresh: async () => {
      if (state.fsRoots.size) {
        const n = await refreshDirectoryRoots();
        if (n) ui.toast(`Rescanned ${n} folder${n === 1 ? '' : 's'}`, 'good', 'refresh');
      }
      runSearch(); renderScopes(); renderHero(); refreshMeta();
    },
  };

  function bindIndexing() {
    refs.fileInput.addEventListener('change', (ev) => {
      importFiles([...ev.target.files]);
      ev.target.value = '';
    });
    refs.folderInput.addEventListener('change', async (ev) => {
      const files = [...ev.target.files];
      ev.target.value = '';
      if (files.length) await ingestFileList(files, 'Folder');
    });
  }

  async function indexFolders() {
    if (window.nova?.isDesktop) {
      const folders = await window.nova.pickFolders();
      for (const folder of folders) {
        const stop = ui.toast(`Scanning <b>${esc(pathName(folder) || folder)}</b>…`, 'info', 'refresh', 120000);
        const result = await window.nova.scanFolder(folder);
        stop();
        if (!result.ok) { ui.toast(`Could not scan that folder: ${esc(result.error || 'unknown error')}`, 'warn', 'info'); continue; }
        ingestNativeScan(folder, result);
      }
      return;
    }
    // Chrome, Edge and the Electron shell expose a real directory picker.
    // Use it when we can: it also lets "refresh" rescan silently.
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker({ id: 'nova-root', mode: 'read' });
        if (dir) {
          await ingestDirectoryHandle(dir, { rescan: false });
          state.fsRoots.set(dir.name, dir);
          return;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // fall through to the classic directory input
      }
    }
    refs.folderInput.click();
  }

  /* Walk a FileSystemDirectoryHandle (Chrome/Edge/Electron): names, sizes,
     dates, plus browser-playable media URLs so video and music work straight
     from the real folder. */
  async function ingestDirectoryHandle(dir, opts = {}) {
    const rootName = dir.name;
    const stop = ui.toast(`Reading <b>${esc(rootName)}</b>…`, 'info', 'refresh', 120000);
    const entries = [];
    const maxFiles = 25000;
    const playable = (name, size) => {
      const ext = U.fileExt(name);
      if (['mp4', 'm4v', 'webm', 'ogv', 'mov'].includes(ext) && size < 800 * 1024 * 1024) return 'video';
      if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'].includes(ext) && size < 300 * 1024 * 1024) return 'audio';
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'].includes(ext) && size < 40 * 1024 * 1024) return 'image';
      return '';
    };

    const walk = async (handle, prefix, depth) => {
      if (entries.length >= maxFiles || depth > 12) return;
      for await (const [name, child] of handle.entries()) {
        if (entries.length >= maxFiles) return;
        const rel = prefix ? `${prefix}/${name}` : name;
        if (child.kind === 'directory') {
          if (/(^|[\\/])(node_modules|\.git|\.cache|Library|AppData)$/.test(rel)) continue;
          entries.push({
            id: 'f-' + U.hashString(rel.toLowerCase()), name, path: rel, dir: U.pathDir(rel),
            root: rootName, rootPath: rootName, ext: '', kind: 'folder', size: 0,
            modified: Date.now(), tags: [], starred: false, pinned: false, thumb: '', meta: {},
            source: 'browser', demo: false,
          });
          await walk(child, rel, depth + 1);
          continue;
        }
        if (/\.(part|tmp|crdownload|download)$/i.test(name)) continue;
        let file = null;
        try { file = await child.getFile(); } catch { continue; }
        if (!file) continue;
        const hidden = /(^|[\\/])\./.test(name);
        if (hidden && !store.state.settings.showHidden) continue;
        const desc = NS.describe(name);
        const entry = {
          id: 'f-' + U.hashString(rel.toLowerCase()), name, path: rel, dir: U.pathDir(rel),
          root: rootName, rootPath: rootName, ext: U.fileExt(name), kind: desc.kind,
          size: file.size, modified: file.lastModified || Date.now(),
          tags: [], starred: false, pinned: false, thumb: '', meta: {},
          source: 'browser', demo: false,
        };
        try {
          if (desc.kind === 'image' && file.size < 6 * 1024 * 1024) entry.thumb = await readThumb(file);
          if (playable(name, file.size)) entry.url = URL.createObjectURL(file);
          else if (desc.text && file.size < 512 * 1024) entry.content = await file.text();
        } catch {}
        entries.push(entry);
      }
    };

    try { await walk(dir, '', 0); } catch (err) {
      console.warn('directory walk stopped', err);
    }
    stop();

    store.addRoot(rootName, { name: rootName, source: 'browser', count: entries.filter((e) => e.kind !== 'folder').length, lastIndexed: Date.now() });
    const known = new Set(store.state.entries.map((e) => e.path));
    const fresh = entries.filter((e) => !known.has(e.path) || e.kind === 'folder');
    const kept = store.state.entries.filter((e) => !(e.root === rootName && e.source === 'browser'));
    store.state.entries = kept.concat(fresh);
    store.persist(true);
    runSearch();
    renderHero();
    refreshMeta();
    renderScopes();
    if (state.view === 'library') renderLibrary();
    const files = fresh.filter((e) => e.kind !== 'folder').length;
    warmIndex();
    ui.toast(`Indexed <b>${fmtNum(files)}</b> files from ${esc(rootName)}${entries.length >= maxFiles ? ' · capped at 25k' : ''}`, 'good', 'check');
    if (opts.rescan) renderHistory();
  }

  /* Rescan every remembered directory handle (Chrome keeps permission). */
  async function refreshDirectoryRoots() {
    let count = 0;
    for (const [name, handle] of state.fsRoots) {
      try {
        const perm = await handle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') continue;
        await ingestDirectoryHandle(handle, { rescan: true });
        count++;
      } catch (err) { console.warn('rescan failed', name, err); }
    }
    return count;
  }

  function ingestNativeScan(folder, result) {
    const rootName = folder === 'This PC' ? 'This PC' : (pathName(folder) || folder);
    store.addRoot(folder, { name: rootName, source: 'native', count: result.entries.filter((e) => !e.isDir).length, lastIndexed: Date.now() });
    const existing = new Set(store.state.entries.map((e) => e.path));
    const mapped = [];
    for (const raw of result.entries) {
      if (existing.has(raw.path)) continue;
      const name = raw.name;
      const ext = raw.ext || '';
      const base = U.pathDir(raw.path);
      mapped.push({
        id: 'n-' + U.hashString(raw.path.toLowerCase()),
        name,
        path: raw.path,
        dir: base,
        root: rootName,
        rootPath: folder,
        ext,
        kind: raw.isDir ? 'folder' : NS.describe(name).kind,
        size: raw.size || 0,
        modified: raw.modified || Date.now(),
        tags: [],
        starred: false,
        pinned: false,
        thumb: raw.thumb || '',
        meta: {},
        source: 'native',
        demo: false,
      });
    }
    store.state.entries.push(...mapped);
    store.persist(true);
    runSearch();
    renderHero();
    refreshMeta();
    renderScopes();
    if (state.view === 'library') renderLibrary();
    warmIndex();
    ui.toast(`Indexed <b>${fmtNum(mapped.length)}</b> entries from ${esc(rootName)} · ${fmtTime(result.took)}${result.truncated ? ' · truncated at limit' : ''}`, 'good', 'check');
  }

  async function ingestFileList(files, rootLabel) {
    const rootName = files[0]?.webkitRelativePath?.split('/')[0] || rootLabel;
    const maxFiles = 20000;
    const list = files.slice(0, maxFiles);
    const entries = [];
    let thumbs = 0;
    const stop = ui.toast(`Reading <b>${esc(rootName)}</b> · ${fmtNum(list.length)} files…`, 'info', 'refresh', 120000);
    for (const file of list) {
      const rel = file.webkitRelativePath || (file._rel && file._rel.replace(/^\/+/, '')) || `${rootName}/${file.name}`;
      const name = file.name;
      const dir = U.pathDir(rel);
      const hidden = /(^|[\\/])\./.test(name);
      if (hidden && !store.state.settings.showHidden) continue;
      const ext = U.fileExt(name);
      const entry = {
        id: 'b-' + U.hashString(rel.toLowerCase()),
        name,
        path: rel,
        dir,
        root: rootName,
        rootPath: rootName,
        ext,
        kind: 'file-ext',
        size: file.size,
        modified: file.lastModified || Date.now(),
        tags: [],
        starred: false,
        pinned: false,
        thumb: '',
        meta: {},
        source: 'browser',
        demo: false,
      };
      const desc = NS.describe(name);
      entry.kind = desc.kind;
      entry.color = desc.color;
      state.browserFiles.set(rel, file);
      if (desc.kind === 'image' && file.size < 6 * 1024 * 1024 && thumbs < 160) {
        try {
          entry.thumb = await readThumb(file);
          thumbs++;
        } catch {}
      }
      entries.push(entry);
    }
    stop();
    store.addRoot(rootName, { name: rootName, source: 'browser', count: entries.length, lastIndexed: Date.now() });
    const known = new Set(store.state.entries.map((e) => e.path));
    const fresh = entries.filter((e) => !known.has(e.path));
    store.state.entries.push(...fresh);
    store.persist(true);
    runSearch();
    renderHero();
    refreshMeta();
    renderScopes();
    if (state.view === 'library') renderLibrary();
    warmIndex();
    ui.toast(`Indexed <b>${fmtNum(fresh.length)}</b> entries from ${esc(rootName)}${list.length === maxFiles ? ' · capped at 20k' : ''}`, 'good', 'check');
  }

  function readThumb(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const size = 128;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function importFiles(files) {
    if (!files.length) return;
    let added = 0;
    for (const file of files) {
      const desc = NS.describe(file.name);
      const hidden = /^\./.test(file.name);
      if (hidden && !store.state.settings.showHidden) continue;
      const entry = {
        id: 'm-' + U.hashString(file.name + file.size + file.lastModified + Math.random()),
        name: file.name,
        path: `Imported/${file.name}`,
        dir: 'Imported',
        root: 'Imported',
        ext: U.fileExt(file.name),
        kind: desc.kind,
        size: file.size,
        modified: file.lastModified || Date.now(),
        tags: [],
        starred: false,
        thumb: '',
        meta: {},
        source: 'manual',
        demo: false,
      };
      try {
        if (['image', 'video', 'audio'].includes(desc.kind) && file.size < 25 * 1024 * 1024) {
          entry.url = await readDataURL(file);
        } else if (desc.text && file.size < 512 * 1024) {
          entry.content = await file.text();
        }
        if (desc.kind === 'image' && file.size < 6 * 1024 * 1024) entry.thumb = await readThumb(file);
        state.browserFiles.set(entry.path, file);
      } catch (err) {
        console.warn('import read failed', err);
      }
      store.state.entries.push(entry);
      added++;
    }
    store.persist(true);
    setView('search', { keepQuery: true, silent: true });
    runSearch();
    ui.toast(added ? `Imported <b>${added}</b> file${added === 1 ? '' : 's'} into the local index` : 'No files imported', added ? 'good' : 'warn', 'download');
    renderHero();
    refreshMeta();
  }

  function readDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function removeRoot(path) {
    const result = store.removeRoot(path);
    runSearch();
    renderHero();
    refreshMeta();
    if (state.view === 'library') renderLibrary();
    ui.renderRoots(rootHandlers);
    ui.toast(`Stopped indexing · removed ${fmtNum(result.removed)} entries`, 'info', 'trash');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Drag & drop
     ═══════════════════════════════════════════════════════════════════════ */
  function bindDrop() {
    let depth = 0;
    const veil = refs.dropVeil;
    window.addEventListener('dragenter', (ev) => {
      if (!ev.dataTransfer || ![...ev.dataTransfer.types].includes('Files')) return;
      depth++;
      veil.classList.add('on');
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) veil.classList.remove('on');
    });
    window.addEventListener('dragover', (ev) => {
      if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault();
    });
    window.addEventListener('drop', async (ev) => {
      if (!ev.dataTransfer) return;
      const files = [...ev.dataTransfer.files];
      if (!files.length) return;
      ev.preventDefault();
      depth = 0;
      veil.classList.remove('on');
      const fancy = ev.dataTransfer.items && [...ev.dataTransfer.items].some((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()?.isDirectory);
      if (fancy) {
        const collected = [];
        const walkers = [...ev.dataTransfer.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
        for (const entry of walkers) await walkEntry(entry, collected, 0);
        if (collected.length) { await ingestFileList(collected, 'Dropped'); return; }
      }
      importFiles(files);
    });
  }

  async function walkEntry(entry, out, depth) {
    if (!entry || depth > 10 || out.length > 20000) return;
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      if (file) {
        try { Object.defineProperty(file, '_rel', { value: entry.fullPath || '', configurable: true }); } catch {}
        out.push(file);
      }
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walkEntry(child, out, depth + 1);
      } while (batch.length);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Command palette
     ═══════════════════════════════════════════════════════════════════════ */
  const COMMANDS = [
    { id: 'index', title: 'Index a folder', sub: 'Scan names, formats and metadata locally', icon: 'drive', key: `${modKey}O`, run: () => indexFolders() },
    { id: 'import', title: 'Import files', sub: 'Add individual files to the index', icon: 'download', key: `${modKey}I`, run: () => refs.fileInput.click() },
    { id: 'starred', title: 'Go to Starred', sub: 'Every file you saved', icon: 'star', key: `${modKey}2`, run: () => setView('starred') },
    { id: 'recent', title: 'Go to Recent', sub: 'Sorted by modification time', icon: 'clock', key: `${modKey}3`, run: () => setView('recent') },
    { id: 'library', title: 'Open Library', sub: 'Roots, folders and coverage', icon: 'layers', key: `${modKey}4`, run: () => setView('library') },
    { id: 'layout', title: 'Toggle list / grid', sub: 'Switch result layout', icon: 'grid', key: `${modKey}1`, run: () => { state.layout = state.layout === 'list' ? 'grid' : 'list'; store.setSettings({ layout: state.layout }); $$('.results-tools [data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout)); if (state.run) renderResults(state.run); } },
    { id: 'theme', title: 'Toggle theme', sub: 'Dark ↔ light', icon: 'moon', key: `${modKey}⇧L`, run: () => { store.setSettings({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }); applyTheme(); } },
    { id: 'filters', title: 'Open filters', sub: 'Size, dates and flags', icon: 'filter', key: `${modKey}F`, run: () => { syncFilterPopover(); ui.togglePopover('filterPop', refs.btnFilters); } },
    { id: 'settings', title: 'Open settings', sub: 'Appearance, search and privacy', icon: 'settings', key: `${modKey},`, run: () => { ui.resetSettingsForm(); ui.renderRoots(rootHandlers); ui.openOverlay('settingsOverlay'); } },
    { id: 'shortcuts', title: 'Keyboard shortcuts', sub: 'The full map', icon: 'command', key: '?', run: () => ui.openOverlay('shortcutsOverlay') },
    { id: 'history', title: 'Clear search history', sub: 'Wipe local history and recent views', icon: 'history', run: () => { store.clearHistory(); ui.toast('History cleared', 'good', 'history'); } },
    { id: 'rescan', title: 'Rescan this PC', sub: 'Re-walk every indexed drive and folder', icon: 'refresh', run: async () => {
      if (window.nova?.isDesktop && window.nova.scanComputer) { NS.bootstrap.scanThisPc(); return; }
      const n = await NS.bootstrap.refreshKnownFolders();
      ui.toast(n ? `Rescanned ${n} folder${n === 1 ? '' : 's'}` : 'Index a folder first — there is nothing to rescan yet', n ? 'good' : 'info', 'refresh');
    } },
    { id: 'clear', title: 'Clear the index', sub: 'Forget every indexed file and folder', icon: 'trash', run: () => {
      store.clearAll();
      runSearch(); renderHero(); refreshMeta(); renderScopes();
      if (state.view === 'library') renderLibrary();
      ui.toast('Index cleared — this PC holds nothing until you index again', 'info', 'trash');
    } },
  ];

  let paletteItems = [];
  let paletteIndex = 0;

  function bindPalette() {
    refs.paletteInput.addEventListener('input', () => renderPalette());
    refs.paletteInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); movePalette(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); movePalette(-1); }
      else if (ev.key === 'Enter') { ev.preventDefault(); runPalette(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closePalette(); }
    });
    refs.paletteOverlay.addEventListener('click', (ev) => { if (ev.target === refs.paletteOverlay) closePalette(); });
  }

  function openPalette() {
    document.body.classList.add('overlay-open');
    refs.paletteOverlay.hidden = false;
    refs.paletteInput.value = '';
    refs.paletteInput.focus();
    renderPalette();
  }

  function closePalette() {
    refs.paletteOverlay.hidden = true;
    document.body.classList.remove('overlay-open');
  }

  function renderPalette() {
    const q = refs.paletteInput.value.trim();
    const nq = search.normalize(q);
    const cmds = COMMANDS.filter((c) => !nq || search.normalize(c.title + ' ' + c.sub).includes(nq));
    const files = q
      ? search.run(store.state.entries, q, { sort: 'relevance' }).results.slice(0, 5)
      : (state.run?.results || []).slice(0, 5);
    paletteItems = [
      ...cmds.map((c) => ({ type: 'cmd', title: c.title, sub: c.sub, icon: c.icon, key: c.key, run: c.run })),
      ...files.map((f) => ({
        type: 'file', title: f.entry.name, sub: `${parentFolder(f.entry)} · ${fmtBytes(f.entry.size)}`,
        icon: NS.kindOf(f.entry).icon, entry: f.entry,
        run: () => { closePalette(); state.activeId = f.entry.id; openPreview(f.entry); },
      })),
    ];
    if (!paletteItems.length) {
      refs.paletteList.innerHTML = '<div class="pal-empty">No commands or files match that.</div>';
      paletteIndex = 0;
      return;
    }
    paletteIndex = clamp(paletteIndex, 0, paletteItems.length - 1);
    let html = '';
    const cmdCount = paletteItems.filter((i) => i.type === 'cmd').length;
    paletteItems.forEach((item, i) => {
      if (i === 0) html += '<div class="pal-group-label">Commands</div>';
      if (i === cmdCount) html += '<div class="pal-group-label">Files</div>';
      html += `<button class="pal-item ${i === paletteIndex ? 'active' : ''}" data-pal="${i}">
        <span class="pal-ic">${icon(item.icon, { size: 15 })}</span>
        <span class="pal-text"><b>${highlightText(item.title, q)}</b><small>${esc(item.sub)}</small></span>
        ${item.key ? `<kbd>${esc(item.key)}</kbd>` : ''}
      </button>`;
    });
    refs.paletteList.innerHTML = html;
    refs.paletteList.querySelectorAll('[data-pal]').forEach((btn) => btn.addEventListener('click', () => {
      paletteIndex = Number(btn.dataset.pal);
      runPalette();
    }));
  }

  function movePalette(delta) {
    if (!paletteItems.length) return;
    paletteIndex = (paletteIndex + delta + paletteItems.length) % paletteItems.length;
    refs.paletteList.querySelectorAll('.pal-item').forEach((n, i) => {
      n.classList.toggle('active', i === paletteIndex);
      if (i === paletteIndex) n.scrollIntoView({ block: 'nearest' });
    });
  }

  function runPalette() {
    const item = paletteItems[paletteIndex];
    if (!item) return;
    item.run();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Keyboard
     ═══════════════════════════════════════════════════════════════════════ */
  function bindKeyboard() {
    document.addEventListener('keydown', (ev) => {
      const typing = U.isTypingTarget(document.activeElement);
      const mod = isMac ? ev.metaKey : ev.ctrlKey;
      const key = ev.key.toLowerCase();

      // Lightbox handles itself.
      if (document.getElementById('lightbox')?.hidden === false) return;

      if (ev.key === 'Escape') {
        if (ui.anyOverlayOpen()) {
          // Overlays own Escape: close the top sheet without touching the query.
          ui.closeTopOverlay();
          ev.preventDefault();
          return;
        }
        if (!refs.paletteOverlay.hidden) { closePalette(); return; }
        if (!refs.preview.hidden) { closePreview(); return; }
        if (state.multi.size) { state.multi.clear(); updateSelectionBar(); paintActive(); return; }
        if (!refs.suggest.hidden) { hideSuggest(); return; }
        return;
      }

      if (mod && key === 'k' && !ev.shiftKey) { ev.preventDefault(); openPalette(); return; }
      if (mod && ev.key === ',') { ev.preventDefault(); ui.resetSettingsForm(); ui.renderRoots(rootHandlers); ui.openOverlay('settingsOverlay'); return; }
      if (mod && key === 'o') { ev.preventDefault(); indexFolders(); return; }
      if (mod && key === 'i' && !ev.shiftKey) { ev.preventDefault(); refs.fileInput.click(); return; }
      if (mod && key === 'f') { ev.preventDefault(); if (state.view === 'search' && $('#app').dataset.mode === 'hero') { applyQuery(''); } syncFilterPopover(); ui.togglePopover('filterPop', refs.btnFilters); return; }
      if (mod && key === '1') { ev.preventDefault(); state.layout = state.layout === 'list' ? 'grid' : 'list'; store.setSettings({ layout: state.layout }); $$('.results-tools [data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout)); if (state.run) renderResults(state.run); return; }
      if (mod && key === '2') { ev.preventDefault(); setView('starred'); return; }
      if (mod && key === '3') { ev.preventDefault(); setView('recent'); return; }
      if (mod && key === '4') { ev.preventDefault(); setView('library'); return; }
      if (mod && key === 'a' && typing) return;
      if (mod && key === 'c' && !typing && state.activeId) {
        ev.preventDefault();
        const entry = entryById(state.activeId);
        if (entry) copyPath(entry);
        return;
      }
      if (mod && key === 'l') { ev.preventDefault(); refs.query.focus(); refs.query.select(); return; }
      if (mod && ev.shiftKey && key === 'l') { ev.preventDefault(); store.setSettings({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }); applyTheme(); ui.resetSettingsForm(); return; }

      if (ev.key === '/' && !typing) { ev.preventDefault(); refs.query.focus(); return; }
      if (ev.key === '?' && !typing) { ev.preventDefault(); ui.openOverlay('shortcutsOverlay'); return; }
      if (ev.key === '?' && typing) { ui.openOverlay('shortcutsOverlay'); return; }
      if (typing) return;

      if (ev.key === 'ArrowDown') { ev.preventDefault(); moveActive(1); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); moveActive(-1); return; }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const entry = entryById(state.activeId);
        if (ev.metaKey || ev.ctrlKey) { if (entry) openEntry(entry); return; }
        if (refs.preview.hidden) { selectActive(true); } else if (entry) openEntry(entry);
        return;
      }
      if (ev.key === ' ') {
        ev.preventDefault();
        const entry = entryById(state.activeId);
        if (entry) peek(entry);
        return;
      }
      if (key === 's') {
        const entry = entryById(state.activeId);
        if (entry) toggleStar(entry.id);
        return;
      }
      if (key === 'o') {
        const entry = entryById(state.activeId);
        if (entry) openEntry(entry);
        return;
      }
      if (key === 'g') { state.layout = state.layout === 'list' ? 'grid' : 'list'; store.setSettings({ layout: state.layout }); $$('.results-tools [data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout)); if (state.run) renderResults(state.run); return; }
      if (ev.key === 'Home') { ev.preventDefault(); moveActive(-9999); return; }
      if (ev.key === 'End') { ev.preventDefault(); moveActive(9999); return; }
      if (ev.key === 'PageDown') { ev.preventDefault(); moveActive(8); return; }
      if (ev.key === 'PageUp') { ev.preventDefault(); moveActive(-8); return; }
    }, false);

    document.addEventListener('keydown', (ev) => {
      if (!refs.paletteOverlay.hidden && ev.key === 'Escape') closePalette();
    });
    // Close overlays when clicking their backdrop handled in ui.js.
  }

  function renderHistory() {
    const wrap = $('#heroHistory');
    if (!wrap) return;
    const history = (store.state.history || []).slice(0, 4);
    if (!history.length || !store.state.settings.rememberHistory) {
      wrap.hidden = true;
      wrap.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    wrap.innerHTML = `<span class="hh-label">${icon('history', { size: 12 })}Recent searches</span>`
      + history.map((h) => `<button class="hh-chip" data-history="${esc(h.query)}" title="Run this search again">${esc(U.clampText(h.query, 34))}<i>${h.count}</i><button class="hh-x" data-history-drop="${esc(h.id)}" aria-label="Remove">${icon('close', { size: 8 })}</button></button>`).join('');
    wrap.querySelectorAll('[data-history]').forEach((btn) => btn.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-history-drop]')) return;
      applyQuery(btn.dataset.history);
    }));
    wrap.querySelectorAll('[data-history-drop]').forEach((btn) => btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      store.deleteHistory(btn.dataset.historyDrop);
      renderHistory();
    }));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Misc
     ═══════════════════════════════════════════════════════════════════════ */
  function bindChrome() {
    // settings handlers
    ui.initSettings({
      applyTheme,
      applyDensity,
      refresh: () => { runSearch(); renderHero(); refreshMeta(); },
      indexFolders,
      settingChanged: (key) => {
        if (key === 'reducedMotion') applyDensity();
        if (key === 'showHidden' || key === 'fuzzy' || key === 'smart') runSearch();
      },
    });
    ui.renderRoots(rootHandlers);
    const versionTag = $('#versionTag');
    if (versionTag) versionTag.textContent = NS.version;
    // settings roots group refresh whenever opened
    $('#btnSettings')?.addEventListener('click', () => ui.renderRoots(rootHandlers));
    // apply persisted layout
    $$('.results-tools [data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout));
    setSort(state.sort, { silent: true });
  }

  NS.app = {
    state, runSearch, setView, applyQuery, openPreview, closePreview, openPalette, renderHistory,
    focusSearch: () => { refs.query.focus(); },
    indexFolders, importFiles, refreshMeta, renderLibrary, boot, analyzeSmart,
    ingestFiles: (files, label) => ingestFileList(files, label || 'Folder'),
    ingestNativeScan: (label, result) => {
      // Accept a synthetic folder label so whole-PC scans reuse the same mapper.
      ingestNativeScan(label, result);
      return result.entries.length;
    },
    scanThisPc: () => (NS.bootstrap ? NS.bootstrap.scanThisPc() : null),
    refreshFolders: refreshDirectoryRoots,
  };

  NS.build = '2026-11-12.r1';
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
