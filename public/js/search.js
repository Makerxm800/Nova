/* =========================================================================
   NOVA SEARCH — search.js
   Tiered fuzzy matcher, query language, ranking, facets and suggestions.
   Pure functions — no DOM, so it can be benchmarked and unit-tested.
   ========================================================================= */
(function () {
  'use strict';
  const NS = window.Nova;
  const U = NS.util;

  /* ---------------------------- normalisation ----------------------------- */
  // Fold accents character-by-character so highlight indices stay aligned.
  const foldCache = new Map();
  function foldChar(ch) {
    let f = foldCache.get(ch);
    if (f === undefined) {
      f = ch.normalize ? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')[0] || ch : ch;
      if (f === 'ø') f = 'o';
      if (f === 'æ') f = 'a';
      if (f === 'œ') f = 'o';
      if (f === 'ß') f = 's';
      if (f === 'ł') f = 'l';
      foldCache.set(ch, f);
    }
    return f;
  }

  function normalize(str) {
    const s = String(str ?? '');
    let out = '';
    for (let i = 0; i < s.length; i++) out += foldChar(s[i]);
    return out.toLowerCase();
  }

  const BOUNDARY = /[\s._\-()[\]{}·,;:|/+~'’"!?@#$%^&=<>]|(?<=[a-z])(?=[A-Z])/;

  /* ---------------------------- matcher ----------------------------------- */
  const TIER = { exact: 0, prefix: 1, word: 2, substring: 3, fuzzy: 4 };
  const TIER_SCORE = [130, 104, 88, 64, 34];
  const TIER_LABEL = ['exact', 'prefix', 'word', 'inside', 'fuzzy'];

  /**
   * Match one token against a folded haystack.
   * Returns {score, tier, indices} or null.
   */
  function matchToken(hay, needle, opts = {}) {
    if (!needle) return { score: 0, tier: TIER.fuzzy, indices: [] };
    const n = hay.length;
    const m = needle.length;

    if (hay === needle) return { score: TIER_SCORE[0] + 24, tier: TIER.exact, indices: range(0, m) };

    // Prefix
    if (hay.startsWith(needle)) {
      let bonus = 12;
      // strong prefix on a word that starts the name
      return { score: TIER_SCORE[1] + bonus, tier: TIER.prefix, indices: range(0, m) };
    }

    // Word-boundary start
    for (let i = 1; i <= n - m; i++) {
      if (!BOUNDARY.test(hay[i - 1])) continue;
      if (hay.startsWith(needle, i)) {
        return { score: TIER_SCORE[2] - i * 0.3, tier: TIER.word, indices: range(i, m) };
      }
    }

    // Substring — best (earliest) occurrence
    const at = hay.indexOf(needle);
    if (at !== -1) {
      const coverage = m / Math.max(n, 1);
      return { score: TIER_SCORE[3] + coverage * 18 - at * 0.25, tier: TIER.substring, indices: range(at, m) };
    }

    // Subsequence (fuzzy) — sequential characters with a small gap penalty
    if (opts.fuzzy !== false && m >= 2) {
      const indices = [];
      let j = 0;
      let gapPenalty = 0;
      let last = -1;
      let boundaries = 0;
      for (let i = 0; i < n && j < m; i++) {
        if (hay[i] !== needle[j]) continue;
        if (last >= 0) gapPenalty += Math.min(i - last - 1, 6);
        if (i === 0 || BOUNDARY.test(hay[i - 1])) boundaries++;
        last = i;
        indices.push(i);
        j++;
      }
      if (j === m && gapPenalty <= m * 2.4 + 4) {
        const shortness = m / Math.max(n, 1);
        return {
          score: TIER_SCORE[4] + boundaries * 6 + shortness * 30 - gapPenalty * 0.8,
          tier: TIER.fuzzy,
          indices,
        };
      }
    }
    return null;
  }

  const range = (start, len) => Array.from({ length: len }, (_, k) => start + k);

  const FIELD_WEIGHT = { name: 1, stem: 1.02, dir: 0.52, tags: 0.62, kind: 0.34 };

  /**
   * Batch matcher with caching of folded strings.
   * The cache is a WeakMap keyed on the entry object, so it never leaks.
   */
  function charMask(str) {
    let mask = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      const bit = c >= 97 && c <= 122 ? c - 97 : c >= 48 && c <= 57 ? 26 + (c - 48) : 36;
      mask |= 1 << bit;
    }
    return mask;
  }

  const folded = new WeakMap();
  function fields(entry) {
    let f = folded.get(entry);
    if (f) return f;
    const name = normalize(entry.name);
    const stem = normalize(U.trimExt(entry.name));
    const dir = normalize(entry.dir || '');
    const tags = normalize((entry.tags || []).join(' '));
    const kind = normalize((NS.describe(entry.name).label || '') + ' ' + (entry.ext || ''));
    const blob = name + ' ' + stem + ' ' + dir + ' ' + tags + ' ' + kind;
    f = { name, stem, dir, tags, kind, blob, mask: charMask(blob) };
    folded.set(entry, f);
    return f;
  }

  /** Score one entry against parsed tokens. Returns null if a token misses. */
  function scoreEntry(entry, tokens, opts = {}) {
    const F = fields(entry);
    if (opts.mask !== false) {
      for (const token of tokens) {
        if ((charMask(token) & ~F.mask) !== 0) return null;
      }
    }
    let total = 0;
    let bestTier = 4;
    let nameIndices = [];
    let allInName = true;

    for (const token of tokens) {
      // Fast rejection: the token never appears literally and is not a subsequence.
      if (opts.prefilter !== false) {
        if (!F.blob.includes(token)) {
          if (opts.fuzzy === false) return null;
          let j = 0;
          for (let i = 0; i < F.blob.length && j < token.length; i++) if (F.blob[i] === token[j]) j++;
          if (j < token.length) return null;
        }
      }
      let best = null;
      const test = (text, field) => {
        const hit = matchToken(text, token, opts);
        if (!hit) return;
        const weighted = hit.score * FIELD_WEIGHT[field];
        if (!best || weighted > best.weighted) best = { ...hit, weighted, field, indices: field === 'name' || field === 'stem' ? hit.indices : [] };
      };
      test(F.name, 'name');
      test(F.stem, 'stem');
      test(F.dir, 'dir');
      test(F.tags, 'tags');
      test(F.kind, 'kind');

      if (!best) {
        if (opts.loose) continue;
        return null;
      }
      if (best.field !== 'name' && best.field !== 'stem') allInName = false;
      if (best.field === 'name' || best.field === 'stem') {
        if (best.tier < bestTier) {
          bestTier = best.tier;
          nameIndices = best.indices;
        }
      }
      total += best.weighted;
    }

    // Boosts — small, explainable nudges.
    const now = Date.now();
    const ageDays = Math.max(0, (now - (entry.modified || now)) / 86400e3);
    const freshness = Math.max(0, 14 - ageDays) * 0.9;
    const favourites = entry.starred ? 22 : 0;
    const pinned = entry.pinned ? 40 : 0;
    const tagHit = tokens.some((t) => (entry.tags || []).some((tag) => normalize(tag).includes(t))) ? 10 : 0;
    const shallow = entry.dir ? Math.max(0, 10 - U.pathParts(entry.dir).length * 2) : 10;
    const nameLen = entry.name.length;
    const brevity = Math.max(0, 12 - nameLen * 0.08);

    const score = total + freshness + favourites + pinned + tagHit + shallow + brevity;
    return { entry, score, tier: bestTier, indices: allInName ? nameIndices : [], nameOnly: allInName };
  }

  /* ---------------------------- query language ---------------------------- */
  const ALIAS_KIND = {
    img: 'image', photo: 'image', photos: 'image', picture: 'image', pictures: 'image', pic: 'image',
    vid: 'video', movie: 'video', clip: 'video',
    aud: 'audio', music: 'audio', song: 'audio', sound: 'audio',
    doc: 'doc', docs: 'doc', document: 'doc', documents: 'doc',
    txt: 'text', text: 'text',
    sheet: 'sheet', sheets: 'sheet', spreadsheet: 'sheet', excel: 'sheet', csv: 'sheet',
    slide: 'slide', slides: 'slide', deck: 'slide', presentation: 'slide', ppt: 'slide',
    code: 'code', source: 'code',
    zip: 'archive', archive: 'archive', archives: 'archive', compressed: 'archive',
    data: 'data', json: 'data',
    font: 'font', fonts: 'font', fonts2: 'font',
    design: 'design', raw: 'design',
    app: 'exec', exe: 'exec', apps: 'exec',
  };

  const KIND_BY_WORD = (word) => {
    const w = word.toLowerCase();
    if (ALIAS_KIND[w]) return ALIAS_KIND[w];
    for (const [kind, def] of Object.entries(NS.kinds)) {
      if (def.label.toLowerCase() === w || def.plural.toLowerCase() === w) return kind;
    }
    return null;
  };

  const SIZE_UNIT = { b: 1, k: 1024, kb: 1024, m: 1048576, mb: 1048576, g: 1073741824, gb: 1073741824, t: 1099511627776, tb: 1099511627776 };

  function parseSize(str) {
    const m = String(str).trim().match(/^([<>]=?|=)?\s*([\d.]+)\s*(b|kb|k|mb|m|gb|g|tb|t)?$/i);
    if (!m) return null;
    const value = parseFloat(m[2]) * (SIZE_UNIT[(m[3] || 'b').toLowerCase()] || 1);
    return { op: m[1] || '=', value };
  }

  function parseDate(str) {
    const s = String(str).trim().toLowerCase();
    const rel = s.match(/^(\d+)\s*(d|day|days|w|week|weeks|m|month|months|y|year|years)$/);
    if (rel) {
      const unit = rel[2][0];
      const mult = unit === 'd' ? 86400e3 : unit === 'w' ? 604800e3 : unit === 'm' ? 2592e6 : 31536e6;
      return { op: '>=', value: Date.now() - parseInt(rel[1], 10) * mult };
    }
    if (s === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return { op: '>=', value: d.getTime() }; }
    if (s === 'yesterday') { const d = new Date(); d.setHours(0, 0, 0, 0); return { op: '>=', value: d.getTime() - 86400e3, upper: d.getTime() }; }
    if (s === 'week' || s === 'thisweek') return { op: '>=', value: Date.now() - 7 * 86400e3 };
    if (s === 'month' || s === 'thismonth') return { op: '>=', value: Date.now() - 30 * 86400e3 };
    if (s === 'year' || s === 'thisyear') return { op: '>=', value: Date.now() - 365 * 86400e3 };
    const d = new Date(s.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2-$3T00:00:00'));
    if (!Number.isNaN(d.getTime())) return { op: s.startsWith('<') ? '<' : '>=', value: d.getTime() };
    const d2 = new Date(s);
    if (!Number.isNaN(d2.getTime())) return { op: '>=', value: d2.getTime() };
    return null;
  }

  const FILTER_KEYS = {
    kind: 'kinds', type: 'kinds', k: 'kinds', t: 'kinds', format: 'kinds',
    ext: 'exts', extname: 'exts',
    tag: 'tags', tags: 'tags',
    in: 'dirs', folder: 'dirs', path: 'dirs',
    is: 'flags', star: 'flags',
    after: 'after', before: 'before', modified: 'after',
    size: 'size',
  };

  function parse(query) {
    const filters = { kinds: [], exts: [], tags: [], dirs: [], flags: [], size: [], after: null, before: null };
    const tokens = [];
    let negateNext = false;
    const re = /(-?)"([^"]*)"|(-?)(\S+)/g;
    let m;
    while ((m = re.exec(query || ''))) {
      let raw = m[2] !== undefined ? m[2] : m[4];
      let neg = (m[1] || m[3]) === '-';
      raw = raw.trim();
      if (!raw) continue;
      const idx = raw.indexOf(':');
      if (idx > 0) {
        const key = raw.slice(0, idx).toLowerCase();
        const val = raw.slice(idx + 1).replace(/^"|"$/g, '');
        if (FILTER_KEYS[key] && val) {
          applyFilter(filters, FILTER_KEYS[key], val, neg);
          continue;
        }
      }
      if (negateNext) neg = true;
      tokens.push({ text: normalize(raw), raw, negate: neg });
      negateNext = false;
    }
    filters.active = filters.kinds.length + filters.exts.length + filters.tags.length + filters.dirs.length + filters.flags.length + filters.size.length + (filters.after ? 1 : 0) + (filters.before ? 1 : 0) > 0;
    return { tokens, filters, raw: query || '' };
  }

  function applyFilter(filters, key, value, negate) {
    switch (key) {
      case 'kinds': {
        const kind = KIND_BY_WORD(value) || (NS.kinds[value] ? value : null);
        if (kind) filters.kinds.push({ value: kind, negate });
        else filters.exts.push({ value: value.replace(/^\./, '').toLowerCase(), negate });
        break;
      }
      case 'exts':
        filters.exts.push({ value: value.replace(/^\./, '').toLowerCase(), negate });
        break;
      case 'tags':
        filters.tags.push({ value: normalize(value), negate });
        break;
      case 'dirs':
        filters.dirs.push({ value: normalize(value), negate });
        break;
      case 'flags': {
        const v = value.toLowerCase();
        if (/star|fav/.test(v)) filters.flags.push({ value: 'starred', negate });
        else if (/pin/.test(v)) filters.flags.push({ value: 'pinned', negate });
        else if (/recent|new/.test(v)) filters.flags.push({ value: 'recent', negate });
        else if (/thumb|preview|art/.test(v)) filters.flags.push({ value: 'thumb', negate });
        else if (/folder/.test(v)) filters.flags.push({ value: 'folder', negate });
        break;
      }
      case 'after': {
        const d = parseDate(value);
        if (d) filters.after = d.value;
        break;
      }
      case 'before': {
        const d = parseDate(value);
        if (d) filters.before = d.value;
        break;
      }
      case 'size': {
        const s = parseSize(value);
        if (s) filters.size.push({ ...s, negate });
        break;
      }
      default:
        break;
    }
  }

  function compare(op, a, b) {
    switch (op) {
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      default: return a === b;
    }
  }

  function passesFilters(entry, f, opts = {}) {
    for (const k of f.kinds) {
      const hit = entry.kind === k.value;
      if (k.negate ? hit : !hit) return false;
    }
    for (const x of f.exts) {
      const hit = (entry.ext || '').toLowerCase() === x.value;
      if (x.negate ? hit : !hit) return false;
    }
    for (const t of f.tags) {
      const hit = (entry.tags || []).some((tag) => normalize(tag).includes(t.value));
      if (t.negate ? hit : !hit) return false;
    }
    for (const d of f.dirs) {
      const hay = normalize(entry.dir || entry.path || '');
      const hit = hay.includes(d.value);
      if (d.negate ? hit : !hit) return false;
    }
    for (const flag of f.flags) {
      let hit = false;
      if (flag.value === 'starred') hit = !!entry.starred;
      else if (flag.value === 'pinned') hit = !!entry.pinned;
      else if (flag.value === 'recent') hit = (entry.modified || 0) > Date.now() - 7 * 86400e3;
      else if (flag.value === 'thumb') hit = !!entry.thumb;
      else if (flag.value === 'folder') hit = false;
      if (flag.negate ? hit : !hit) return false;
    }
    if (f.after && (entry.modified || 0) < f.after) return false;
    if (f.before && (entry.modified || 0) > f.before) return false;
    for (const s of f.size) {
      const hit = compare(s.op, entry.size || 0, s.value);
      if (s.negate ? hit : !hit) return false;
    }
    if (opts.showHidden === false && /(^|[\\/])\./.test(U.pathName(entry.name))) return false;
    return true;
  }

  /* ---------------------------- engine ----------------------------------- */
  const SORTS = {
    relevance: null,
    name: (a, b) => normalize(a.name).localeCompare(normalize(b.name)),
    nameDesc: (a, b) => normalize(b.name).localeCompare(normalize(a.name)),
    date: (a, b) => (b.modified || 0) - (a.modified || 0),
    dateAsc: (a, b) => (a.modified || 0) - (b.modified || 0),
    size: (a, b) => (b.size || 0) - (a.size || 0),
    sizeAsc: (a, b) => (a.size || 0) - (b.size || 0),
    kind: (a, b) => a.kind.localeCompare(b.kind) || normalize(a.name).localeCompare(normalize(b.name)),
  };

  function run(entries, query, opts = {}) {
    const t0 = performance.now();
    const parsed = parse(query);
    const tokens = parsed.tokens.filter((t) => !t.negate).map((t) => t.text);
    const negTokens = parsed.tokens.filter((t) => t.negate).map((t) => t.text);
    const f = parsed.filters;
    const sort = opts.sort && SORTS[opts.sort] ? opts.sort : 'relevance';
    const fuzzyWanted = opts.fuzzy !== false;

    const facets = new Map();
    Object.keys(NS.kinds).forEach((k) => facets.set(k, 0));
    let scanned = 0;
    let pool = [];
    let loose = false;

    const eligible = (entry) => {
      if (opts.ids && !opts.ids.has(entry.id)) return false;
      if (opts.scopeKinds && !opts.scopeKinds.includes(entry.kind)) return false;
      if (opts.kindsAny && !opts.kindsAny.includes(entry.kind)) return false;
      if (!passesFilters(entry, f, opts)) return false;
      if (negTokens.length) {
        const F = fields(entry);
        const blob = F.name + ' ' + F.dir + ' ' + F.tags;
        if (negTokens.some((t) => blob.includes(t))) return false;
      }
      return true;
    };

    for (const entry of entries) {
      scanned++;
      if (!eligible(entry)) continue;
      let hit;
      if (tokens.length) {
        hit = scoreEntry(entry, tokens, { fuzzy: false });
        if (!hit) continue;
      } else {
        hit = { entry, score: 0, tier: 4, indices: [], nameOnly: false };
      }
      pool.push(hit);
    }

    // Rescue 1 — multi-word typo: retry with OR semantics, requiring a real hit.
    let rescue = false;
    if (!pool.length && tokens.length > 1) {
      for (const entry of entries) {
        if (!eligible(entry)) continue;
        let best = null;
        let hits = 0;
        for (const token of tokens) {
          const h = scoreEntry(entry, [token], { fuzzy: false });
          if (h) { hits++; if (!best || h.score > best.score) best = h; }
        }
        if (best) {
          pool.push({ ...best, score: best.score - (tokens.length - hits) * 22 });
        }
      }
      if (pool.length) rescue = true;
    }

    // Rescue 2 — single token fuzzy (subsequence) when strict tiers find nothing.
    if (!pool.length && tokens.length === 1 && fuzzyWanted) {
      for (const entry of entries) {
        if (!eligible(entry)) continue;
        const hit = scoreEntry(entry, tokens, { fuzzy: true });
        if (!hit) continue;
        pool.push(hit);
      }
      loose = pool.length > 0;
    }

    // If fuzzy subsequence hits exist alongside strong hits, keep only the strong ones.
    if (!rescue) {
      const strong = pool.filter((h) => h.tier <= 3).length;
      if (strong >= 3) {
        pool = pool.filter((h) => h.tier <= 3);
      } else if (strong > 0) {
        const weak = pool.filter((h) => h.tier === 4).sort((a, b) => b.score - a.score).slice(0, 6);
        pool = [...pool.filter((h) => h.tier <= 3), ...weak];
      } else if (tokens.length && !loose) {
        pool.sort((a, b) => b.score - a.score);
        pool = pool.slice(0, 24);
        loose = pool.length > 0;
      }
    }

    if (sort === 'relevance') {
      pool.sort((a, b) => b.score - a.score || (b.entry.modified || 0) - (a.entry.modified || 0));
    } else {
      const cmp = SORTS[sort];
      pool.sort((a, b) => cmp(a.entry, b.entry));
    }

    // Facet counts describe the query without the format filter, so the chips
    // stay useful while one format is selected.
    if (!f.kinds.length && !f.exts.length && !opts.kindsAny && !opts.scopeKinds) {
      for (const hit of pool) facets.set(hit.entry.kind, (facets.get(hit.entry.kind) || 0) + 1);
    } else {
      const base = opts.kindsAny || opts.scopeKinds;
      if (base) base.forEach((k) => facets.set(k, 0));
      const relaxed = { ...f, kinds: [], exts: [], active: f.active };
      for (const entry of entries) {
        if (opts.ids && !opts.ids.has(entry.id)) continue;
        if (base && !base.includes(entry.kind)) continue;
        if (!passesFilters(entry, relaxed, opts)) continue;
        if (tokens.length && !scoreEntry(entry, tokens, { fuzzy: false, prefilter: true })) continue;
        facets.set(entry.kind, (facets.get(entry.kind) || 0) + 1);
      }
    }

    const took = performance.now() - t0;
    const kindList = Array.from(facets.entries())
      .map(([kind, count]) => ({ kind, count, ...NS.kinds[kind] }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);

    return {
      results: pool,
      took,
      scanned,
      facets: kindList,
      parsed,
      loose,
      rescue,
      total: pool.length,
      kindsSelected: f.kinds.map((k) => k.value),
    };
  }

  /** Render a highlighted file name (HTML-safe). */
  function highlight(text, indices) {
    if (!text) return '';
    if (!indices || !indices.length) return U.esc(text);
    const set = new Set(indices);
    let out = '';
    let open = false;
    for (let i = 0; i < text.length; i++) {
      const on = set.has(i);
      if (on && !open) { out += '<mark>'; open = true; }
      if (!on && open) { out += '</mark>'; open = false; }
      out += U.esc(text[i]);
    }
    if (open) out += '</mark>';
    return out;
  }

  /** Normalised blob used by the semantic-ish "Ask" suggestions. */
  function entryBlob(entry) {
    return normalize(`${entry.name} ${entry.dir} ${(entry.tags || []).join(' ')} ${entry.kind}`);
  }

  /** Natural-language-ish suggestion chips for the search field. */
  function suggestions(query, entries, opts = {}) {
    const q = normalize(query).trim();
    const out = [];
    if (!q) return out;

    const kinds = new Set();
    for (const entry of entries) kinds.add(entry.kind);
    for (const kind of kinds) {
      const def = NS.kinds[kind];
      if (!def) continue;
      if (normalize(def.plural).startsWith(q) || normalize(def.label).startsWith(q)) {
        out.push({ type: 'kind', label: `kind:${kind}`, hint: `${def.plural} only`, query: `kind:${kind}`, icon: def.icon });
      }
    }
    const seenTags = new Set();
    let budget = 4000;                      // never walk 50k entries for hints
    for (const entry of entries) {
      if (budget-- <= 0 || out.length > 12) break;
      for (const tag of entry.tags || []) {
        if (seenTags.has(tag)) continue;
        const n = normalize(tag);
        if (n.startsWith(q) || (q.length > 1 && n.includes(q))) {
          seenTags.add(tag);
          out.push({ type: 'tag', label: `tag:${tag}`, hint: 'tagged', query: `tag:${tag}`, icon: 'tag' });
          if (out.length > 12) break;
        }
      }
      if (out.length > 12) break;
    }
    const dirs = new Set();
    budget = 4000;
    for (const entry of entries) {
      if (budget-- <= 0 || out.length > 16) break;
      const parts = U.pathParts(entry.dir || '');
      for (const part of parts) {
        if (parts.length && dirs.has(part)) continue;
        if (normalize(part).startsWith(q)) {
          dirs.add(part);
          out.push({ type: 'dir', label: `in:${part}`, hint: 'folder', query: `in:"${part}"`, icon: 'folder' });
        }
        if (out.length > 16) break;
      }
      if (out.length > 16) break;
    }
    const chips = [
      { label: 'is:starred', hint: 'favourites', icon: 'star' },
      { label: 'size:>100mb', hint: 'large files', icon: 'gauge' },
      { label: 'after:week', hint: 'fresh changes', icon: 'clock' },
      { label: 'is:recent', hint: 'last 7 days', icon: 'sparkle' },
    ];
    for (const chip of chips) {
      if (normalize(chip.label).startsWith(q)) out.push({ type: 'filter', ...chip, query: chip.label });
    }
    return out.slice(0, 14);
  }

  /* ------------------------- idle warm-up --------------------------------- */
  // The first query over a fresh index pays for every string fold, regex and
  // mask in the corpus (hundreds of ms on 50k entries). Doing that in idle
  // slices after indexing keeps the first keystroke instant instead.
  const warmState = new WeakSet();
  function warm(entries, opts = {}) {
    if (!Array.isArray(entries) || !entries.length) return Promise.resolve(0);
    if (warmState.has(entries) && !opts.force) return Promise.resolve(0);
    warmState.add(entries);
    const budget = opts.budget || 5;      // ms of work per idle slice
    let i = 0;
    const total = entries.length;
    return new Promise((resolve) => {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 24));
      const slice = (deadline) => {
        const size = Math.min(140, total - i);   // always yield between batches
        const end = i + size;
        while (i < end) fields(entries[i++]);
        if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 1 && i < total) {
          return idle(slice);
        }
        if (i < total) return idle(slice);
        resolve(total);
      };
      idle(slice);
    });
  }

  NS.search = {
    normalize, matchToken, scoreEntry, parse, run, highlight, suggestions, warm,
    entryBlob, TIER, TIER_LABEL, SORTS, KIND_BY_WORD, parseSize, parseDate,
    _fields: fields,
  };
})();
