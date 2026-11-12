/* =========================================================================
   NOVA SEARCH — preview.js
   Rich, format-aware renderers for the preview panel and the lightbox.
   ========================================================================= */
(function () {
  'use strict';
  const NS = window.Nova;
  const { el, esc, fmtBytes, fmtDate, fmtDuration, pathName, parentFolder } = NS.util;
  const { describe } = NS.format;
  const icon = NS.icon;

  const MAX_TEXT = 64 * 1024;
  let activeAudio = null;
  let lightboxState = { list: [], index: 0, zoom: 1, entry: null };

  const art = (entry) => {
    const d = describe(entry.name);
    return `<div class="pv-art" style="--kc:${d.color}">${icon(d.icon, { class: 'big', size: 52 })}<span class="art-ext">${esc(entry.ext || 'file')}</span></div>`;
  };

  /* ---------------------------- markdown-lite ----------------------------- */
  function mdToHtml(src) {
    const raw = String(src || '');
    const lines = raw.split(/\r?\n/);
    let html = '';
    let inCode = false;

    const inline = (s) => {
      let t = esc(s);
      t = t.replace(/`([^`]+)`/g, '<code style="font-family:var(--font-mono);font-size:.92em;background:rgba(139,92,246,.12);padding:1px 4px;border-radius:4px">$1</code>');
      t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span style="color:var(--accent)">$1</span>');
      t = t.replace(/^(\s*)\[x\]/i, '$1<span style="color:var(--good)">✓</span>');
      t = t.replace(/^(\s*)\[ \]/, '$1<span style="color:var(--faint)">○</span>');
      return t;
    };

    for (const line of lines) {
      if (/^```/.test(line)) {
        inCode = !inCode;
        html += inCode ? '<pre style="margin:6px 0">' : '</pre>';
        continue;
      }
      if (inCode) { html += esc(line) + '\n'; continue; }
      if (/^#{1,6}\s/.test(line)) {
        const level = line.match(/^#+/)[0].length;
        html += `<div style="font-family:var(--font-display);font-weight:${level <= 2 ? 600 : 550};font-size:${[0, 17, 15, 13.5, 12.5, 12, 12][level]}px;color:var(--text);margin:${level <= 2 ? '12px' : '9px'} 0 4px">${inline(line.replace(/^#+\s*/, ''))}</div>`;
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line)) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
        const cells = line.trim().replace(/^\||\|$/g, '').split('|');
        html += `<div style="display:flex;gap:10px;border-bottom:1px solid var(--line);padding:3px 0">${cells.map((c) => `<span style="flex:1;min-width:0">${inline(c.trim())}</span>`).join('')}</div>`;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        html += `<div style="display:flex;gap:8px;padding:1px 0"><span style="color:var(--accent)">•</span><span>${inline(line.replace(/^\s*[-*]\s+/, ''))}</span></div>`;
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        html += `<div style="display:flex;gap:8px;padding:1px 0"><span style="color:var(--accent);font-variant-numeric:tabular-nums">${line.match(/^\s*(\d+)/)[1]}.</span><span>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</span></div>`;
        continue;
      }
      if (!line.trim()) { html += '<div style="height:7px"></div>'; continue; }
      if (/^---+$/.test(line.trim())) { html += '<div style="height:1px;background:var(--line);margin:8px 0"></div>'; continue; }
      html += `<div style="padding:1px 0">${inline(line)}</div>`;
    }
    return html;
  }

  /* ---------------------------- code highlighter -------------------------- */
  const KEYWORDS = new Set(('const let var function return if else for while class extends new import from export default async await try catch throw typeof instanceof in of this super switch case break continue do yield static get set public private readonly interface type enum implements namespace declare void null undefined true false NaN Infinity typeof').split(' '));

  function highlightCode(src, ext) {
    const text = String(src || '').slice(0, MAX_TEXT);
    const tokens = [];
    let i = 0;
    const isWord = (c) => /[A-Za-z0-9_$]/.test(c);
    while (i < text.length) {
      const c = text[i];
      const rest = text.slice(i, i + 2);
      // comments
      if ((ext === 'py' || ext === 'rb' || ext === 'sh' || ext === 'bash') && c === '#') {
        const end = text.indexOf('\n', i);
        const stop = end === -1 ? text.length : end;
        tokens.push(['c', text.slice(i, stop)]);
        i = stop;
        continue;
      }
      if ((rest === '//') || (ext !== 'css' && rest === '/*')) {
        const stop = rest === '//'
          ? (text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i))
          : (text.indexOf('*/', i) === -1 ? text.length : text.indexOf('*/', i) + 2);
        tokens.push(['c', text.slice(i, stop)]);
        i = stop;
        continue;
      }
      if ((ext === 'html' || ext === 'xml' || ext === 'svg') && rest === '<!--') {
        const stop = text.indexOf('-->', i) === -1 ? text.length : text.indexOf('-->', i) + 3;
        tokens.push(['c', text.slice(i, stop)]);
        i = stop;
        continue;
      }
      // strings
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        while (j < text.length && text[j] !== c) {
          if (text[j] === '\\') j++;
          j++;
        }
        tokens.push(['s', text.slice(i, j + 1)]);
        i = j + 1;
        continue;
      }
      // numbers
      if (/[0-9]/.test(c) && (i === 0 || !isWord(text[i - 1]))) {
        let j = i;
        while (j < text.length && /[0-9a-fA-Fx._]/.test(text[j])) j++;
        tokens.push(['n', text.slice(i, j)]);
        i = j;
        continue;
      }
      // words
      if (/[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < text.length && isWord(text[j])) j++;
        const word = text.slice(i, j);
        if (KEYWORDS.has(word)) tokens.push(['k', word]);
        else if (text[j] === '(') tokens.push(['f', word]);
        else if (/^[A-Z]/.test(word) && word.length > 1) tokens.push(['t', word]);
        else tokens.push(['', word]);
        i = j;
        continue;
      }
      // html tags
      if ((ext === 'html' || ext === 'xml' || ext === 'svg') && c === '<') {
        const stop = text.indexOf('>', i);
        const end = stop === -1 ? text.length : stop + 1;
        tokens.push(['k', text.slice(i, end)]);
        i = end;
        continue;
      }
      tokens.push(['', c]);
      i++;
    }
    const classes = { c: 'tok-c', s: 'tok-s', k: 'tok-k', n: 'tok-n', f: 'tok-f', t: 'tok-t', '': '' };
    return tokens.map(([t, v]) => `<span class="${classes[t]}">${esc(v)}</span>`).join('');
  }

  /* ---------------------------- csv table --------------------------------- */
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function csvTable(text) {
    const rows = parseCSV(text).slice(0, 60);
    if (!rows.length) return '';
    const head = rows[0];
    const body = rows.slice(1);
    return `<div class="pv-table" style="overflow:auto;max-height:260px;border:1px solid var(--line);border-radius:10px">
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;font-family:var(--font-mono)">
        <thead><tr>${head.map((h) => `<th style="text-align:left;padding:6px 8px;color:var(--accent);border-bottom:1px solid var(--line-2);position:sticky;top:0;background:var(--panel-2);font-weight:600;white-space:nowrap">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${body.map((r) => `<tr>${r.map((c) => `<td style="padding:4px 8px;color:var(--text-2);border-bottom:1px solid var(--line);white-space:nowrap">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
  }

  /* ---------------------------- renderers --------------------------------- */

  function imageBlock(entry) {
    const src = entry.url || entry.thumb;
    if (src) {
      return `<img class="pv-img" src="${esc(src)}" alt="${esc(entry.name)}" loading="lazy" data-lb-open>`;
    }
    return `<div class="pv-art" style="--kc:${describe(entry.name).color};aspect-ratio:16/10;width:100%;display:grid;place-items:center;background:radial-gradient(120% 100% at 30% 0%,color-mix(in srgb, var(--kc) 30%, transparent),transparent 70%),var(--panel-2);position:relative">
      ${icon('image', { size: 52 })}
      <span class="art-ext">${esc(entry.ext)}</span>
    </div>`;
  }

  function videoBlock(entry) {
    if (entry.url) {
      return `<video src="${esc(entry.url)}" controls playsinline preload="metadata" ${entry.thumb ? `poster="${esc(entry.thumb)}"` : ''}></video>`;
    }
    const poster = entry.thumb ? `<img src="${esc(entry.thumb)}" alt="" style="width:100%;display:block;aspect-ratio:16/10;object-fit:cover">` : '';
    return `<div class="pv-video-ph" style="position:relative;width:100%;background:#000">
      ${poster || `<div style="aspect-ratio:16/10;display:grid;place-items:center;color:${describe(entry.name).color}">${icon('video', { size: 46 })}</div>`}
      <div style="position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(circle at 50% 60%,#0009,transparent 70%)">
        <span class="play-badge" style="width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:#0b0c12cc;border:1px solid #ffffff2a;color:#fff;backdrop-filter:blur(8px)">
          ${icon('play', { size: 20 })}
        </span>
      </div>
      <div style="position:absolute;left:10px;bottom:8px;font-size:9.5px;font-family:var(--font-mono);color:#fff;background:#0b0c12b3;padding:3px 7px;border-radius:5px">
        ${entry.meta && entry.meta.duration ? fmtDuration(entry.meta.duration) + ' · ' : ''}${esc(entry.ext.toUpperCase())} preview still
      </div>
    </div>`;
  }

  function audioBlock(entry) {
    const m = entry.meta || {};
    const bars = 44;
    const seed = NS.util.hashString(entry.name);
    const wave = Array.from({ length: bars }, (_, i) => {
      const v = (Math.sin(i * 0.6 + seed) * 0.5 + 0.5) * 0.7 + 0.3;
      return Math.max(0.18, v);
    });
    const art = entry.thumb
      ? `<img src="${esc(entry.thumb)}" alt="">`
      : `<span style="font-family:var(--font-display);font-size:22px;font-weight:700;color:#fff">${esc(NS.util.initials(m.artist || entry.name))}</span>`;
    return `<div class="audio-card" data-audio-card>
      <div class="audio-top">
        <div class="audio-art">${art}</div>
        <div class="audio-meta">
          <b>${esc(NS.util.trimExt(entry.name))}</b>
          <small>${esc(m.artist || 'Unknown artist')} · ${esc(m.album || 'Loose file')}</small>
          <small style="color:var(--faint)">${esc(m.sampleRate || 'Audio file')}${m.duration ? ' · ' + fmtDuration(m.duration) : ''}</small>
        </div>
      </div>
      <div class="waveform">${wave.map((v, i) => `<i style="height:${(v * 100).toFixed(0)}%;animation-delay:${(i * 38) % 900}ms;animation-duration:${1100 + ((seed + i * 37) % 700)}ms"></i>`).join('')}</div>
      ${entry.url ? `<audio src="${esc(entry.url)}" controls preload="none" style="width:100%"></audio>` : `
      <div class="audio-actions">
        <button class="play-btn" data-audio-toggle>${icon('play', { size: 16 })}</button>
        <span class="audio-time" data-audio-time>0:00 / ${fmtDuration(m.duration || 0)}</span>
        <span style="margin-left:auto;font-size:9px;color:var(--faint);letter-spacing:.06em;text-transform:uppercase">Synthesised preview</span>
      </div>`}
    </div>`;
  }

  function textBlock(entry) {
    const content = entry.content == null ? '' : String(entry.content);
    if (!content) {
      return `<div class="pv-note">No readable text captured for this file.<br><span style="color:var(--faint)">Index real folders to preview their contents.</span></div>`;
    }
    const ext = (entry.ext || '').toLowerCase();
    if (ext === 'md' || ext === 'markdown' || ext === 'mdx') {
      return `<div class="pv-note title" data-md>${mdToHtml(content)}</div>`;
    }
    if (ext === 'csv' || ext === 'tsv') {
      const table = csvTable(ext === 'tsv' ? content.replace(/\t/g, ',') : content);
      return table + `<div class="pv-note" style="margin-top:10px">${esc(content.split(/\r?\n/).slice(0, 3).join('\n'))}${content.split(/\r?\n/).length > 3 ? '\n…' : ''}</div>`;
    }
    if (ext === 'json' || ext === 'jsonc' || ext === 'json5') {
      let pretty = content;
      try { pretty = JSON.stringify(JSON.parse(content), null, 2); } catch (err) { pretty = content; }
      return `<div class="pv-note" style="max-height:240px">${esc(pretty.slice(0, 4000))}</div>`;
    }
    if (['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'tsx', 'jsx', 'css', 'scss', 'html', 'htm', 'py', 'rb', 'go', 'rs', 'java', 'sql', 'sh', 'bash', 'yml', 'yaml', 'toml', 'xml', 'vue', 'svelte', 'php', 'c', 'cpp', 'h'].includes(ext)) {
      return `<div class="pv-note code" style="max-height:300px;padding:0;border:0;background:transparent"><pre style="margin:0;padding:13px;border-radius:12px;border:1px solid var(--line);background:var(--panel);max-height:300px;overflow:auto">${highlightCode(content, ext)}</pre></div>`;
    }
    return `<div class="pv-note" style="max-height:240px">${esc(content.slice(0, 4000))}${content.length > 4000 ? '\n…' : ''}</div>`;
  }

  function pdfBlock(entry) {
    const pages = (entry.meta && entry.meta.pages) || 1;
    const content = entry.content;
    if (entry.url && /\.pdf$/i.test(entry.url)) {
      return `<div style="width:100%;padding:10px;background:var(--panel)">
        <iframe src="${esc(entry.url)}" title="PDF preview" style="width:100%;height:320px;border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>
        <div style="display:flex;justify-content:space-between;padding:7px 4px 0;font-family:var(--font-mono);font-size:9px;color:var(--faint)"><span>embedded PDF · ${pages} pages</span><span>scroll inside</span></div>
      </div>`;
    }
    const sample = content
      ? `<div class="pdf-page" style="background:#f6f4ee;color:#25222b;border-radius:8px;padding:20px 20px 26px;font-family:Georgia,serif;font-size:11px;line-height:1.7;box-shadow:0 20px 40px -20px #000a;max-height:230px;overflow:auto;position:relative">
          <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:7.5px;letter-spacing:.14em;color:#8a8794;margin-bottom:12px"><span>NOVA / DOCUMENT</span><span>PAGE 1 OF ${pages}</span></div>
          <div style="white-space:pre-wrap">${esc(content.slice(0, 900))}</div>
          <div style="border-top:1px solid #dcd8cc;margin-top:14px;padding-top:6px;font-size:7.5px;color:#9b97a4;font-family:var(--font-mono)">rendered from extracted text</div>
        </div>`
      : `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px;color:var(--muted);font-size:11px">${icon('pdf', { size: 40 })}<span>PDF artwork is not stored locally</span></div>`;
    return `<div style="padding:14px;display:grid;place-items:center;background:repeating-linear-gradient(45deg,var(--panel),var(--panel) 10px,transparent 10px,transparent 20px)">${sample}</div>`;
  }

  function sheetBlock(entry) {
    if (entry.content && /[,;\t]/.test(entry.content) && /\n/.test(entry.content)) {
      return csvTable(entry.content);
    }
    return `<div class="pv-note">${esc(entry.content || 'Workbook metadata only.\nSheets: ' + ((entry.meta && entry.meta.sheets) || 1))}</div>`;
  }

  function fontBlock(entry) {
    const family = (entry.meta && entry.meta.family) || NS.util.trimExt(entry.name);
    return `<div class="font-specimen" style="padding:18px 16px;border-radius:12px;border:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;gap:10px">
      <div style="font-family:var(--font-display);font-size:34px;line-height:1.1;letter-spacing:-0.02em;color:var(--text)">Aa Bb Cc</div>
      <div style="font-size:15px;color:var(--text-2);letter-spacing:.01em">${esc(family)} — 0123456789</div>
      <div style="font-size:11px;color:var(--muted);line-height:1.7">The quick brown fox jumps over the lazy dog.<br>THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.</div>
      <div style="font-family:var(--font-mono);font-size:9px;color:var(--faint);border-top:1px solid var(--line);padding-top:8px">Substituted specimen — install the file to see its real glyphs.</div>
    </div>`;
  }

  function archiveBlock(entry) {
    const m = entry.meta || {};
    return `<div style="padding:16px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
      <div style="width:64px;height:64px;border-radius:16px;display:grid;place-items:center;color:${describe(entry.name).color};background:color-mix(in srgb,${describe(entry.name).color} 12%,transparent);border:1px solid color-mix(in srgb,${describe(entry.name).color} 24%,transparent)">${icon('archive', { size: 30 })}</div>
      <div style="font-size:12px;color:var(--text-2);font-weight:550">${m.entries ? NS.util.fmtNum(m.entries) + ' entries' : 'Archive container'}</div>
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--faint)">${esc(m.method || '')}${m.format ? ' · ' + m.format : ''}</div>
      <div style="font-size:10.5px;color:var(--faint);max-width:220px">Contents are listed by name. Files are never extracted or uploaded.</div>
    </div>`;
  }

  function dataBlock(entry) {
    if (entry.content) {
      try {
        const parsed = JSON.parse(entry.content);
        const pretty = JSON.stringify(parsed, null, 2);
        return `<div class="pv-note" style="max-height:240px">${esc(pretty.slice(0, 4000))}</div>`;
      } catch {}
      return `<div class="pv-note" style="max-height:240px">${esc(String(entry.content).slice(0, 3000))}</div>`;
    }
    return `<div class="pv-note">Dataset file — indexed by name and format.\n${esc(JSON.stringify(entry.meta || {}, null, 2).slice(0, 500))}</div>`;
  }

  function genericBlock(entry, d) {
    const m = entry.meta || {};
    const rows = Object.entries(m).slice(0, 4);
    return `<div style="width:100%;display:flex;flex-direction:column;align-items:center;gap:10px;padding:26px 18px;text-align:center">
      <div style="width:72px;height:72px;border-radius:18px;display:grid;place-items:center;color:${d.color};background:color-mix(in srgb,${d.color} 10%,transparent);border:1px solid color-mix(in srgb,${d.color} 22%,transparent)">${icon(d.icon, { size: 32 })}</div>
      <div style="font-size:12px;color:var(--text-2)">${esc(d.label)} file</div>
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--faint)">${rows.map(([k, v]) => `${esc(k)}: ${esc(String(v))}`).join('<br>') || esc(entry.ext.toUpperCase())}</div>
    </div>`;
  }

  /** Render media block by kind. Returns HTML string. */
  function mediaHTML(entry) {
    const d = describe(entry.name);
    switch (d.kind) {
      case 'image': return imageBlock(entry);
      case 'video': return videoBlock(entry);
      case 'audio': return audioBlock(entry);
      case 'pdf': return pdfBlock(entry);
      case 'doc':
      case 'text':
      case 'code': return textBlock(entry);
      case 'sheet': return sheetBlock(entry);
      case 'font': return fontBlock(entry);
      case 'archive': return archiveBlock(entry);
      case 'data': return dataBlock(entry);
      case 'slide': return entry.content ? `<div class="pv-note">${mdToHtml(entry.content)}</div>` : art(entry);
      default: return entry.thumb
        ? `<img class="pv-img" src="${esc(entry.thumb)}" alt="" data-lb-open>`
        : genericBlock(entry, d);
    }
  }

  function metaRows(entry) {
    const d = describe(entry.name);
    const m = entry.meta || {};
    const rows = [
      ['Format', `${d.label}${entry.ext ? ' · .' + entry.ext : ''}`],
      ['Size', fmtBytes(entry.size)],
      ['Modified', fmtDate(entry.modified, 'long')],
      ['Location', parentFolder(entry)],
    ];
    if (m.width && m.height) rows.splice(1, 0, ['Dimensions', `${m.width} × ${m.height}`]);
    if (m.duration) rows.push(['Duration', fmtDuration(m.duration)]);
    if (m.camera) rows.push(['Camera', m.camera]);
    if (m.lens) rows.push(['Lens', m.lens]);
    if (m.pages) rows.push(['Pages', String(m.pages)]);
    if (m.artist) rows.push(['Artist', m.artist]);
    if (m.album) rows.push(['Album', m.album]);
    if (m.family) rows.push(['Family', m.family]);
    if (m.language) rows.push(['Language', m.language]);
    if (m.rows) rows.push(['Rows', NS.util.fmtNum(m.rows)]);
    if (m.entries) rows.push(['Entries', NS.util.fmtNum(m.entries)]);
    if (m.codec) rows.push(['Codec', m.codec]);
    if (entry.source === 'native') rows.push(['Indexed', 'this machine']);
    return rows.map(([k, v]) => `<div class="pm${String(v).length > 26 ? ' wide' : ''}"><span>${esc(k)}</span><b title="${esc(String(v))}">${esc(String(v))}</b></div>`).join('');
  }

  /* ---------------------------- main renderer ----------------------------- */

  function render(entry, ctx = {}) {
    const container = ctx.container;
    if (!container) return;
    if (!entry) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--faint);font-size:12px">Select a file to preview it.</div>`;
      return;
    }
    stopAudio();
    const d = describe(entry.name);
    container.style.setProperty('--kc', d.color);
    container.innerHTML = mediaHTML(entry);
    wireMedia(container, entry);

    if (ctx.meta) ctx.meta.innerHTML = metaRows(entry);
    if (ctx.name) ctx.name.textContent = entry.name;
    if (ctx.path) {
      ctx.path.textContent = entry.path || entry.dir + '/' + entry.name;
      ctx.path.title = 'Click to copy path';
    }
    if (ctx.kind) {
      ctx.kind.style.setProperty('--kc', d.color);
      ctx.kind.innerHTML = `${icon(d.icon, { size: 12 })}<span>${esc(d.label)}</span>`;
    }
    if (ctx.note) {
      const note = describeNote(entry);
      ctx.note.className = 'pv-note';
      ctx.note.innerHTML = note || '';
      ctx.note.style.display = note ? '' : 'none';
    }
    if (ctx.tags) {
      ctx.tags.innerHTML = (entry.tags || []).map((t) => `<span class="pv-tag">${esc(t)}<button data-tag-remove="${esc(t)}" title="Remove tag">${icon('close', { size: 9 })}</button></span>`).join('')
        + `<button class="pv-tag add" data-tag-add>+ tag</button>`;
    }
    if (ctx.star) {
      ctx.star.classList.toggle('on', !!entry.starred);
      ctx.star.title = entry.starred ? 'Starred' : 'Star';
    }
  }

  function describeNote(entry) {
    const d = describe(entry.name);
    if (entry.content && d.kind === 'text') return '';
    if (entry.demo && (d.kind === 'video' || d.kind === 'design' || d.kind === 'archive')) {
      return `<span style="color:var(--faint)">Sample entry from the demo library. Index a real folder to preview this format's actual contents.</span>`;
    }
    if (entry.source === 'native' && entry.size > 50 * 1024 * 1024 && d.kind === 'image') {
      return '<span style="color:var(--faint)">Large file — preview loaded on demand.</span>';
    }
    return '';
  }

  function wireMedia(container, entry) {
    const img = container.querySelector('[data-lb-open]');
    if (img) img.addEventListener('click', () => openLightbox(entry));
    const toggle = container.querySelector('[data-audio-toggle]');
    if (toggle) {
      toggle.addEventListener('click', async () => {
        const card = container.querySelector('[data-audio-card]');
        if (activeAudio && activeAudio.card === card) {
          stopAudio();
          return;
        }
        stopAudio();
        card.classList.add('playing');
        toggle.innerHTML = icon('pause', { size: 16 });
        const timeEl = container.querySelector('[data-audio-time]');
        const duration = (entry.meta && entry.meta.duration) || 16;
        const started = performance.now();
        const handle = { card, toggle, timer: null };
        handle.timer = setInterval(() => {
          const elapsed = (performance.now() - started) / 1000;
          if (timeEl) timeEl.textContent = `${fmtDuration(Math.min(elapsed, duration))} / ${fmtDuration(duration)}`;
          if (elapsed >= duration) stopAudio();
        }, 200);
        activeAudio = handle;
        try { playAmbient(entry); } catch {}
      });
    }
  }

  /* tiny Web Audio ambience for demo audio entries */
  let audioCtx = null;
  let audioNodes = null;
  function playAmbient(entry) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    gain.connect(audioCtx.destination);
    const masterFilter = audioCtx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    masterFilter.frequency.value = 900;
    masterFilter.Q.value = 0.7;
    masterFilter.connect(gain);
    const seed = NS.util.hashString(entry.name);
    const root = 110 * Math.pow(2, (seed % 5) / 12);
    const ratios = [1, 1.5, 2, 2.6667];
    const oscs = ratios.map((r, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = i % 2 ? 'sine' : 'triangle';
      osc.frequency.value = root * r;
      const g = audioCtx.createGain();
      g.gain.value = 0.22 / (i + 1);
      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.017;
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 0.12;
      lfo.connect(lfoGain).connect(g.gain);
      osc.connect(g).connect(masterFilter);
      osc.start();
      lfo.start();
      return { osc, lfo };
    });
    gain.gain.linearRampToValueAtTime(0.16, audioCtx.currentTime + 1.8);
    audioNodes = { gain, oscs };
    setTimeout(() => {
      if (audioNodes) {
        try {
          audioNodes.gain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 1.2);
          setTimeout(() => stopAudio(), 1300);
        } catch {}
      }
    }, 15000);
  }

  function stopAudio() {
    if (audioNodes) {
      try {
        audioNodes.gain.gain.cancelScheduledValues(audioCtx.currentTime);
        audioNodes.gain.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.15);
        const nodes = audioNodes;
        setTimeout(() => {
          nodes.oscs.forEach(({ osc, lfo }) => { try { osc.stop(); lfo.stop(); } catch {} });
        }, 400);
      } catch {}
      audioNodes = null;
    }
    if (activeAudio) {
      clearInterval(activeAudio.timer);
      const { card, toggle } = activeAudio;
      card.classList.remove('playing');
      toggle.innerHTML = icon('play', { size: 16 });
      activeAudio = null;
    }
  }

  /* ---------------------------- lightbox ---------------------------------- */
  function openLightbox(entry, list) {
    const lb = document.getElementById('lightbox');
    if (!lb) return;
    const pool = (list && list.length ? list : [entry]).filter((e) => e.thumb || e.url || e.content);
    lightboxState = {
      list: pool.length ? pool : [entry],
      index: Math.max(0, pool.findIndex((e) => e.id === entry.id)),
      zoom: 1,
      entry,
    };
    if (lightboxState.index < 0) lightboxState.index = 0;
    const current = lightboxState.list[lightboxState.index] || entry;
    renderLightbox(current);
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function renderLightbox(entry) {
    const d = describe(entry.name);
    const stage = document.getElementById('lbStage');
    const title = document.getElementById('lbTitle');
    const strip = document.getElementById('lbStrip');
    const zoomEl = document.getElementById('lbZoom');
    if (!stage) return;
    lightboxState.entry = entry;
    lightboxState.zoom = 1;
    if (zoomEl) zoomEl.textContent = '100%';
    if (title) title.innerHTML = `${esc(entry.name)}<small>${esc(d.label)} · ${fmtBytes(entry.size)}</small>`;
    if (d.kind === 'image' && (entry.url || entry.thumb)) {
      stage.innerHTML = `<img src="${esc(entry.url || entry.thumb)}" alt="${esc(entry.name)}" id="lbImage">`;
    } else if (entry.content) {
      stage.innerHTML = `<div class="lb-text"><pre>${esc(String(entry.content).slice(0, MAX_TEXT))}</pre></div>`;
    } else {
      stage.innerHTML = `<div class="lb-text"><div style="display:flex;flex-direction:column;align-items:center;gap:14px;color:var(--muted);font-size:12px;padding:20px">${icon(d.icon, { size: 42 })}<b style="color:var(--text);font-size:14px">${esc(entry.name)}</b><span>No inline preview for this format — metadata only.</span></div></div>`;
    }
    if (strip) {
      strip.innerHTML = lightboxState.list.map((e, i) => {
        const dd = describe(e.name);
        const content = e.thumb ? `<img src="${esc(e.thumb)}" alt="">` : icon(dd.icon, { size: 16 });
        return `<button class="lb-thumb ${i === lightboxState.index ? 'active' : ''}" data-lb-index="${i}" title="${esc(e.name)}">${content}</button>`;
      }).join('');
      strip.querySelectorAll('[data-lb-index]').forEach((b) => {
        b.addEventListener('click', () => {
          lightboxState.index = Number(b.dataset.lbIndex);
          renderLightbox(lightboxState.list[lightboxState.index]);
        });
      });
    }
  }

  function closeLightbox() {
    const lb = document.getElementById('lightbox');
    if (!lb) return;
    lb.hidden = true;
    document.body.style.overflow = '';
  }

  let zoomBound = false;
  function bindLightbox() {
    if (zoomBound) return;
    zoomBound = true;
    const lb = document.getElementById('lightbox');
    const zoomEl = () => document.getElementById('lbZoom');
    const setZoom = (value) => {
      lightboxState.zoom = NS.util.clamp(value, 0.25, 4);
      const img = document.getElementById('lbImage');
      if (img) img.style.transform = `scale(${lightboxState.zoom})`;
      const label = document.querySelector('#lbZoom');
      if (label) label.textContent = `${Math.round(lightboxState.zoom * 100)}%`;
    };
    document.getElementById('lbZoomIn')?.addEventListener('click', () => setZoom(lightboxState.zoom * 1.25));
    document.getElementById('lbZoomOut')?.addEventListener('click', () => setZoom(lightboxState.zoom / 1.25));
    document.getElementById('lbClose')?.addEventListener('click', closeLightbox);
    document.getElementById('lbDownload')?.addEventListener('click', () => {
      const e = lightboxState.entry;
      if (!e) return;
      if (e.url) { NS.util.downloadBlob(e.url, e.name); return; }
      if (e.content != null) {
        NS.util.downloadBlob(new Blob([String(e.content)], { type: 'text/plain' }), e.name.replace(/\.[^.]+$/, '') + '.txt');
        NS.toast?.('Saved extracted text', 'good');
        return;
      }
      NS.toast?.('This sample has no stored bytes to save', 'warn');
    });
    lb?.addEventListener('click', (ev) => {
      if (ev.target === lb) closeLightbox();
    });
    document.addEventListener('keydown', (ev) => {
      if (document.getElementById('lightbox')?.hidden !== false) return;
      if (ev.key === 'Escape') { ev.stopPropagation(); closeLightbox(); }
      if (ev.key === 'ArrowRight') {
        lightboxState.index = (lightboxState.index + 1) % lightboxState.list.length;
        renderLightbox(lightboxState.list[lightboxState.index]);
      }
      if (ev.key === 'ArrowLeft') {
        lightboxState.index = (lightboxState.index - 1 + lightboxState.list.length) % lightboxState.list.length;
        renderLightbox(lightboxState.list[lightboxState.index]);
      }
      if (ev.key === '+' || ev.key === '=') setZoom(lightboxState.zoom * 1.2);
      if (ev.key === '-') setZoom(lightboxState.zoom / 1.2);
      if (ev.key === '0') setZoom(1);
    }, true);
  }

  NS.preview = {
    render, mediaHTML, mediaFor: (e) => describe(e.name),
    openLightbox, closeLightbox, bindLightbox,
    highlightCode, mdToHtml, parseCSV, stopAudio,
    state: lightboxState,
  };
})();
