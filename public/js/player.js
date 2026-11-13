/* =========================================================================
   NOVA SEARCH — player.js
   A real media engine for the preview surface. Video gets a full transport
   (scrub, seek, speed, volume, PiP, fullscreen); audio gets an artwork card
   with live spectrum, waveform seek bar and a queue that follows the result
   list so "next track" feels like a player, not a preview pane.

   Everything is delegated: one document-level listener drives whichever
   player is mounted, so re-rendering the preview never leaks handlers.
   ========================================================================= */
(function () {
  'use strict';
  const NS = window.Nova;
  const { esc } = NS.util;
  const icon = NS.icon;

  const players = new Map(); // key -> {root, media, kind, entry, raf}
  let current = null;

  /* ------------------------------ helpers -------------------------------- */
  const fmt = (sec) => {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60) % 60;
    const h = Math.floor(sec / 3600);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  };

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // Some embedded/headless engines implement <video> but throw in load().
  // Probe once so a preview never breaks the whole render pass.
  const CAN_LOAD = (() => {
    // jsdom explicitly declares media loading "not implemented" and reports it
    // through its virtual console, so detect it instead of provoking the error.
    if (navigator.userAgent.includes('jsdom')) return false;
    try {
      const probe = document.createElement('audio');
      probe.load();
      return true;
    } catch { return false; }
  })();
  const safeLoad = (media) => { if (CAN_LOAD) { try { media.load(); } catch {} } };
  const fmtBytesShort = (n) => {
    if (!n) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  };

  /* ----------------------------- spectrum -------------------------------- */
  // One AudioContext + analyser per document; wired lazily on first play so
  // autoplay policies never complain.
  let actx = null;
  let analyser = null;
  let sourceMap = new WeakMap();

  function ensureAnalyser(media) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume();
      if (!analyser) {
        analyser = actx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.82;
        analyser.connect(actx.destination);
      }
      if (!sourceMap.has(media)) {
        const src = actx.createMediaElementSource(media);
        src.connect(analyser);
        sourceMap.set(media, src);
      }
      return analyser;
    } catch { return null; }
  }

  function drawSpectrum(canvas, media, fallbackSeed) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 64;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.scale(dpr, dpr);
    const bars = 56;
    const gap = 2;
    const bw = Math.max(2, (w - gap * (bars - 1)) / bars);
    const seed = fallbackSeed || 1;
    const an = ensureAnalyser(media);
    const data = an ? new Uint8Array(an.frequencyBinCount) : null;
    let raf = 0;

    const paint = (time) => {
      ctx.clearRect(0, 0, w, h);
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, 'rgba(139,92,246,.95)');
      grad.addColorStop(.55, 'rgba(167,139,250,.85)');
      grad.addColorStop(1, 'rgba(34,211,238,.9)');
      ctx.fillStyle = grad;
      ctx.shadowColor = 'rgba(139,92,246,.45)';
      ctx.shadowBlur = 10;
      if (an) an.getByteFrequencyData(data);
      for (let i = 0; i < bars; i++) {
        let v;
        if (an) {
          // log-ish sampling so bass doesn't own the whole bar field
          const idx = Math.min(data.length - 1, Math.floor(Math.pow(i / bars, 1.6) * (data.length * .7)));
          v = data[idx] / 255;
        } else {
          v = (Math.sin(time / 260 + i * .55 + seed) * .5 + .5) * .55 + .18;
        }
        const barH = Math.max(2, v * (h - 4));
        const x = i * (bw + gap);
        const r = Math.min(bw / 2, 2.5);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, h - barH, bw, barH, r);
        else ctx.rect(x, h - barH, bw, barH);
        ctx.fill();
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }

  /* ------------------------------ markup --------------------------------- */
  function videoMarkup(entry, key, opts = {}) {
    const m = entry.meta || {};
    const src = entry.url || '';
    const hd = m.height ? `${m.height}p` : '';
    const badge = [hd, m.fps ? `${m.fps} fps` : '', m.codec || '', m.duration ? fmt(m.duration) : '']
      .filter(Boolean).join(' · ');
    return `<div class="np np-video-shell" data-player="video" data-key="${key}" ${opts.compact ? 'data-compact="1"' : ''}>
      <div class="np-stage">
        <div class="np-video${opts.floating ? ' floating' : ''}">
          ${src ? `<video data-media src="${esc(src)}" playsinline preload="metadata" ${entry.thumb ? `poster="${esc(entry.thumb)}"` : ''}></video>` : `
            <div class="np-poster">${entry.thumb ? `<img src="${esc(entry.thumb)}" alt="">` : ''}
              <span class="np-play-badge">${icon('video', { size: 28 })}</span></div>`}
          ${src ? '<button class="np-bigplay" data-act="toggle" aria-label="Play or pause">' + icon('play', { size: 30 }) + '</button>' : ''}
          ${badge ? `<span class="np-badge">${esc(badge)}</span>` : ''}
        </div>
        <div class="np-scrim"></div>
        <div class="np-transport">
          <div class="np-track" data-act="seek" role="slider" aria-label="Seek" tabindex="0">
            <div class="np-buffer" data-buffer></div>
            <div class="np-fill" data-fill></div>
            <div class="np-knob" data-knob></div>
          </div>
          <div class="np-controls">
            <button class="np-btn np-play" data-act="toggle" title="Play / pause (Space)" aria-label="Play or pause">${icon('play', { size: 18 })}</button>
            <span class="np-time"><b data-cur>0:00</b><i>/</i><span data-dur>${fmt(m.duration || 0)}</span></span>
            <span class="np-spacer"></span>
            <div class="np-volgroup">
              <button class="np-btn" data-act="mute" title="Mute (M)" aria-label="Mute">${icon('volume', { size: 17 })}</button>
              <input class="np-vol" data-act="vol" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">
            </div>
            <button class="np-chip" data-act="speed" title="Playback speed">1×</button>
            <button class="np-btn" data-act="pip" title="Picture in picture" aria-label="Picture in picture">${icon('pip', { size: 17 })}</button>
            <button class="np-btn" data-act="full" title="Fullscreen (F)" aria-label="Fullscreen">${icon('expand', { size: 17 })}</button>
            ${opts.onOpen ? `<button class="np-btn" data-act="open" title="Open full size" aria-label="Open full size">${icon('maximize', { size: 17 })}</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }

  function audioMarkup(entry, key, opts = {}) {
    const m = entry.meta || {};
    const src = entry.url || '';
    const art = entry.thumb ? `<img src="${esc(entry.thumb)}" alt="">`
      : `<span class="np-glyph">${esc(NS.util.initials(m.artist || entry.name))}</span>`;
    const seed = NS.util.hashString(entry.name);
    return `<div class="np np-audio${opts.floating ? ' floating' : ''}" data-player="audio" data-key="${key}">
      <div class="np-art" style="--seed:${seed}">${art}
        <span class="np-art-ring"></span>
        <button class="np-art-play" data-act="toggle" aria-label="Play or pause">${icon('play', { size: 18 })}</button>
      </div>
      <div class="np-now">
        <b>${esc(NS.util.trimExt(entry.name))}</b>
        <small>${esc(m.artist ? (m.artist + (m.album ? ' · ' + m.album : '')) : (entry.root || NS.util.parentFolder(entry) || 'Local file'))}${m.artist ? '' : ` · ${esc((entry.ext || '').toUpperCase())}`}</small>
      </div>
      <div class="np-track big" data-act="seek" role="slider" aria-label="Seek" tabindex="0">
        <div class="np-buffer" data-buffer></div>
        <div class="np-fill" data-fill></div>
        <div class="np-knob" data-knob></div>
      </div>
      <div class="np-times"><b data-cur>0:00</b><span data-dur>${fmt(m.duration || 0)}</span></div>
      <canvas class="np-spectrum" data-spectrum></canvas>
      <div class="np-bar np-transport">
        <button class="np-btn" data-act="prev" title="Previous track">${icon('skipBack', { size: 15 })}</button>
        <button class="np-btn np-play" data-act="toggle" title="Play / pause">${icon('play', { size: 17 })}</button>
        <button class="np-btn" data-act="next" title="Next track">${icon('skipFwd', { size: 15 })}</button>
        <span class="np-spacer"></span>
        <button class="np-chip" data-act="speed" title="Playback speed">1×</button>
        <button class="np-btn" data-act="loop" title="Repeat">${icon('repeat', { size: 15 })}</button>
        <button class="np-btn" data-act="mute" title="Mute">${icon('volume', { size: 15 })}</button>
        <input class="np-vol" data-act="vol" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">
      </div>
      ${m.sampleRate ? `<div class="np-foot"><span class="np-rate">${esc(m.sampleRate)}</span><span class="np-format">${esc((entry.ext || '').toUpperCase())} · ${esc(fmtBytesShort(entry.size))}</span></div>` : ''}
      ${src ? `<audio data-media src="${esc(src)}" preload="metadata"></audio>`
        : `<audio data-media preload="none"></audio><div class="np-hint">${icon('info', { size: 12 })} No stored audio for this sample — index a real folder to play it.</div>`}
    </div>`;
  }

  /* ------------------------------ mounting -------------------------------- */
  function mount(root, entry, opts = {}) {
    if (!root) return null;
    const kind = root.dataset.player;
    const key = root.dataset.key || (entry && entry.id) || 'k' + players.size;
    const media = root.querySelector('[data-media]');
    const state = { root, media, kind, entry, cleanup: null, opts };
    players.set(key, state);
    if (opts.queue && opts.queue.length) state.queue = opts.queue;
    wire(root, state);
    return state;
  }

  /* Fullscreen that actually works: request on the player shell so the
     controls come with the picture, fall back to the stage, then to a CSS
     "theater" mode when the Fullscreen API is unavailable (iframes, some
     Linux webviews). Keeps the icon in sync either way. */
  function toggleFullscreen(root) {
    const shell = root.querySelector('.np-stage') || root;
    const lb = root.closest('.lightbox');
    const paint = () => {
      const on = !!document.fullscreenElement
        || shell.classList.contains('theater')
        || (lb && lb.classList.contains('immersive'));
      root.querySelectorAll('[data-act="full"]').forEach((b) => {
        b.classList.toggle('on', on);
        b.innerHTML = icon(on ? 'shrink' : 'expand', { size: 17 });
        b.title = on ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
      });
    };
    if (document.fullscreenElement) {
      document.exitFullscreen?.().finally(paint);
      shell.classList.remove('theater');
      if (lb) lb.classList.remove('immersive');
      return;
    }
    const target = lb || shell;
    target.requestFullscreen?.()
      .then(paint)
      .catch(() => {
        target.classList.add('immersive');
        shell.classList.add('theater');
        NS.ui.toast('Immersive view — F or Esc to exit', 'info', 'expand');
        paint();
      });
  }

  /* A readable, actionable failure card instead of a one-line warning. */
  function showFailure(root, s) {
    if (!root || root.querySelector('.np-fail')) return;
    const media = s && s.media;
    const code = (media && media.error && media.error.code) || 0;
    const ext = ((s && s.entry && s.entry.ext) || '').toUpperCase();
    const REASONS = {
      3: 'The file is damaged or only partly copied.',
      4: 'This codec is not built into the app.',
    };
    const why = REASONS[code] || 'The browser engine could not decode it.';
    const fail = document.createElement('div');
    fail.className = 'np-fail';
    fail.innerHTML = `
      <div class="np-fail-head">${icon('info', { size: 15 })}<b>Can't play this ${esc(ext || 'file')} here</b></div>
      <p>${esc(why)} Nova keeps the index and metadata intact — the file itself is unchanged.</p>
      <div class="np-fail-actions">
        ${s && s.opts && s.opts.onOpen ? `<button class="np-fail-btn primary" data-act="open">${icon('play', { size: 13 })} Open in the system player</button>` : ''}
        <button class="np-fail-btn" data-act="reveal">${icon('folder', { size: 13 })} Show in folder</button>
        <button class="np-fail-btn" data-act="convert">${icon('info', { size: 13 })} Why?</button>
      </div>`;
    root.appendChild(fail);
    fail.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'open' && s.opts && s.opts.onOpen) s.opts.onOpen();
      else if (act.dataset.act === 'reveal') {
        const e = s.entry;
        if (window.nova?.reveal && e?.path) window.nova.reveal(e.path);
        else NS.ui.toast('Reveal works in the desktop app', 'info', 'reveal');
      }
      else if (act.dataset.act === 'convert') {
        NS.ui.toast('MKV/WMV/HEVC need system codecs. Play them in VLC or use “Open”.', 'info', 'info', 7000);
      }
    });
  }

  function wire(root, s) {
    const { media, kind } = s;

    const fill = root.querySelector('[data-fill]');
    const knob = root.querySelector('[data-knob]');
    const buffer = root.querySelector('[data-buffer]');
    const curEl = root.querySelector('[data-cur]');
    const durEl = root.querySelector('[data-dur]');
    const track = root.querySelector('.np-track');
    const playBtns = root.querySelectorAll('[data-act="toggle"]');

    const paintProgress = () => {
      if (!media) return;
      const d = (Number.isFinite(media.duration) && media.duration > 0) ? media.duration
        : (s.entry && s.entry.meta && s.entry.meta.duration) || 0;
      const p = d ? Math.min(1, (media.currentTime || 0) / d) : 0;
      if (fill) fill.style.width = `${p * 100}%`;
      if (knob) knob.style.left = `${p * 100}%`;
      if (curEl) curEl.textContent = fmt(media.currentTime);
      if (durEl && Number.isFinite(media.duration)) durEl.textContent = fmt(media.duration);
      try {
        if (buffer && media.buffered.length) {
          buffer.style.width = `${Math.min(100, (media.buffered.end(media.buffered.length - 1) / (media.duration || 1)) * 100)}%`;
        }
      } catch {}
    };

    const syncPlay = () => {
      const playing = media && !media.paused && !media.ended;
      root.classList.toggle('playing', !!playing);
      playBtns.forEach((b) => { b.innerHTML = playing ? icon('pause', { size: b.classList.contains('np-play') ? 15 : 18 }) : icon('play', { size: b.classList.contains('np-play') ? 15 : 18 }); });
      const big = root.querySelector('.np-bigplay');
      if (big) big.classList.toggle('gone', !!playing);
      if (playing && kind === 'audio') startSpectrum();
    };

    let stopSpectrum = null;
    const startSpectrum = () => {
      const canvas = root.querySelector('[data-spectrum]');
      if (!canvas || stopSpectrum) return;
      stopSpectrum = drawSpectrum(canvas, media, NS.util.hashString(s.entry ? s.entry.name : 'nova'));
      s.cleanup = () => { if (stopSpectrum) { stopSpectrum(); stopSpectrum = null; } };
    };

    let raf = 0;
    const tick = () => { paintProgress(); raf = requestAnimationFrame(tick); };
    if (media) {
      media.addEventListener('timeupdate', paintProgress);
      media.addEventListener('progress', paintProgress);
      media.addEventListener('loadedmetadata', () => {
        paintProgress();
        // The decoded file is authoritative: adopt its real duration, size and
        // dimensions so the metadata panel never reports made-up numbers.
        const real = {};
        if (Number.isFinite(media.duration) && media.duration > 0) real.duration = Math.round(media.duration);
        if (media.videoWidth && media.videoHeight) { real.width = media.videoWidth; real.height = media.videoHeight; }
        if (s.entry && s.entry.meta && Object.keys(real).length) {
          Object.assign(s.entry.meta, real);
          const badge = root.querySelector('.np-badge');
          if (badge && kind === 'video') {
            const m = s.entry.meta;
            badge.textContent = [m.height ? `${m.height}p` : '', m.fps ? `${m.fps} fps` : '',
              m.duration ? fmt(m.duration) : ''].filter(Boolean).join(' · ');
          }
          if (s.opts && s.opts.onMeta) s.opts.onMeta(s.entry);
        }
        if (durEl && Number.isFinite(media.duration)) durEl.textContent = fmt(media.duration);
      });
      media.addEventListener('play', () => { pauseOthers(s); syncPlay(); });
      media.addEventListener('pause', syncPlay);
      media.addEventListener('ended', () => {
        syncPlay();
        if (s.opts && s.opts.onEnded) s.opts.onEnded(s);
      });
      // Distinguish a real decode failure from the transient error every
      // <video> fires while its src is being swapped (including on unmount).
      media.addEventListener('error', () => {
        const err = media.error;
        if (!media.getAttribute('src')) return;
        // 1 = MEDIA_ERR_ABORTED, 2 = NETWORK: usually a cancelled stream, not a codec.
        if (err && (err.code === 1 || err.code === 2) && media.readyState < 2) return;
        // Nothing decoded yet and the element was just torn down: ignore.
        if (media.readyState === 0 && !err) return;
        showFailure(root, s);
      });
      // A stalled network read (common for big MKV over a slow disk) should
      // retry instead of declaring the file unplayable.
      let stalls = 0;
      media.addEventListener('stalled', () => { stalls++; if (stalls <= 2) safeLoad(media); });
      media.addEventListener('canplay', () => { stalls = 0; root.querySelector('.np-fail')?.remove(); });
      // Keep the fullscreen affordance truthful whichever way the user exits.
      const onFsChange = () => {
        if (!document.fullscreenElement) {
          root.querySelector('.np-stage')?.classList.remove('theater');
          root.querySelector('.lightbox')?.classList.remove('immersive');
        }
        const on = !!document.fullscreenElement;
        root.querySelectorAll('[data-act="full"]').forEach((b) => {
          b.classList.toggle('on', on);
          b.innerHTML = icon(on ? 'shrink' : 'expand', { size: 17 });
        });
      };
      document.addEventListener('fullscreenchange', onFsChange);
      paintProgress();
      raf = requestAnimationFrame(tick);
      const oldCleanup = s.cleanup;
      s.cleanup = () => {
        cancelAnimationFrame(raf);
        document.removeEventListener('fullscreenchange', onFsChange);
        if (oldCleanup) oldCleanup();
      };
    }

    const seekTo = (clientX) => {
      if (!track || !media) return;
      const r = track.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const d = (Number.isFinite(media.duration) && media.duration > 0) ? media.duration
        : (s.entry && s.entry.meta && s.entry.meta.duration) || 0;
      if (d) { try { media.currentTime = p * d; } catch {} }
      if (fill) fill.style.width = `${p * 100}%`;
      if (knob) knob.style.left = `${p * 100}%`;
      if (curEl) curEl.textContent = fmt(p * d);
    };

    let scrubbing = false;
    track?.addEventListener('pointerdown', (ev) => { scrubbing = true; track.setPointerCapture?.(ev.pointerId); seekTo(ev.clientX); });
    track?.addEventListener('pointermove', (ev) => { if (scrubbing) seekTo(ev.clientX); });
    track?.addEventListener('pointerup', () => { scrubbing = false; });
    track?.addEventListener('keydown', (ev) => {
      if (!media) return;
      if (ev.key === 'ArrowRight') { ev.preventDefault(); media.currentTime = Math.min(media.duration || 0, media.currentTime + 5); }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); media.currentTime = Math.max(0, media.currentTime - 5); }
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); toggle(); }
    });

    function toggle() {
      if (!media || !media.src) {
        NS.ui.toast('No playable bytes stored for this sample — index a real folder', 'warn', 'info');
        return;
      }
      if (media.paused) {
        if (media.readyState === 0) safeLoad(media);
        ensureAnalyser(media);
        media.play().catch(() => NS.ui.toast('Playback blocked — press play again', 'warn', 'info'));
      } else safePause(media);
    }

    root.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]');
      if (!act) return;
      const name = act.dataset.act;
      if (name === 'toggle') {
        if (act.closest('.np-track') && act.tagName !== 'BUTTON') return;
        toggle();
      } else if (name === 'mute') {
        if (!media) return;
        media.muted = !media.muted;
        act.classList.toggle('on', media.muted);
        act.innerHTML = icon(media.muted ? 'volumeOff' : 'volume', { size: 15 });
      } else if (name === 'speed') {
        if (!media) return;
        const i = SPEEDS.findIndex((v) => Math.abs(v - media.playbackRate) < 0.01);
        const next = SPEEDS[(i + 1) % SPEEDS.length];
        media.playbackRate = next;
        root.querySelectorAll('[data-act="speed"]').forEach((b) => { b.textContent = `${next}×`; b.classList.toggle('on', next !== 1); });
        NS.ui.toast(`Playback speed ${next}×`, 'info', 'bolt');
      } else if (name === 'loop') {
        if (!media) return;
        media.loop = !media.loop;
        act.classList.toggle('on', media.loop);
        NS.ui.toast(media.loop ? 'Repeating this track' : 'Repeat off', 'info', 'repeat');
      } else if (name === 'pip') {
        if (media && document.pictureInPictureEnabled) {
          media.requestPictureInPicture?.().catch(() => NS.ui.toast('Picture-in-picture unavailable here', 'warn', 'info'));
        }
      } else if (name === 'full') {
        toggleFullscreen(root);
      } else if (name === 'open') {
        if (s.opts && s.opts.onOpen) s.opts.onOpen();
      } else if (name === 'prev') {
        if (s.opts && s.opts.onPrev) s.opts.onPrev();
      } else if (name === 'next') {
        if (s.opts && s.opts.onNext) s.opts.onNext();
      }
    });

    root.addEventListener('input', (ev) => {
      if (ev.target.dataset.act === 'vol' && media) {
        media.volume = Number(ev.target.value);
        media.muted = media.volume === 0;
      }
    });

    // Space toggles playback, F fullscreen, M mute. Handled locally so the
    // global "peek" shortcut does not fight the player.
    root.addEventListener('keydown', (ev) => {
      if (ev.target.closest('input, textarea')) return;
      if (ev.key === ' ') { ev.preventDefault(); toggle(); }
      else if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); if (kind === 'video') toggleFullscreen(root); }
      else if (ev.key === 'm' || ev.key === 'M') {
        if (!media) return;
        media.muted = !media.muted;
        const b = root.querySelector('[data-act="mute"]');
        if (b) { b.classList.toggle('on', media.muted); b.innerHTML = icon(media.muted ? 'volumeOff' : 'volume', { size: 17 }); }
      }
    }, true);
  }

  function safePause(media) {
    if (!media || navigator.userAgent.includes('jsdom')) return;
    try { if (!media.paused) media.pause(); } catch {}
  }

  function pauseOthers(active) {
    players.forEach((p) => {
      if (p !== active && p.kind === 'audio') safePause(p.media);
    });
    if (current && current !== active && current.kind === 'audio') safePause(current.media);
    current = active;
  }

  function unmount(key) {
    const s = players.get(key);
    if (!s) return;
    if (s.media) {
      safePause(s.media);
      try { s.media.removeAttribute('src'); } catch {}
      safeLoad(s.media);
    }
    if (s.cleanup) s.cleanup();
    players.delete(key);
  }

  function unmountAll(root) {
    players.forEach((s, key) => {
      if (!root || s.root === root || root.contains(s.root)) unmount(key);
    });
  }

  NS.player = { videoMarkup, audioMarkup, mount, unmount, unmountAll, fmt, SPEEDS };
})();
