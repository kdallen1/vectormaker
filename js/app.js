// App state, control panel, live preview, and file import/export.
(function (VM) {
  const STORAGE_KEY = 'leftys-vectormaker-project';

  const PALETTES = {
    'Rodeo': { bg: '#f3ead8', colors: ['#a8322a', '#1f3557', '#d9a441'] },
    'Desert': { bg: '#efe0c6', colors: ['#c0653b', '#7d8f69', '#3d2b22', '#e3b778'] },
    'Turquoise & silver': { bg: '#1c2a33', colors: ['#3fb3a8', '#c9d1d3', '#8fd6cc'] },
    'Pearl snap': { bg: '#fbf7ef', colors: ['#2b2420', '#b9a68a'] },
    'Bandana': { bg: '#9e1b1b', colors: ['#ffffff', '#111111'] },
    'Indigo': { bg: '#18233f', colors: ['#e8e1d0', '#6f86b8'] },
    'Camo: woodland': { bg: '#a39a6e', colors: ['#4f5d33', '#6b4a2b', '#1f1f1a'] },
    'Camo: tiger stripe': { bg: '#8c8a5c', colors: ['#4b5530', '#5e4630', '#1d1d18'] },
    'Camo: desert': { bg: '#d9c7a5', colors: ['#b79c74', '#8c6f4c', '#f4ede0', '#3d3128'] },
    'Camo: flecktarn': { bg: '#8a8c66', colors: ['#5f6b45', '#2f3a24', '#6b4b33', '#1d1d18'] },
    'Camo: urban': { bg: '#c9c9c4', colors: ['#8e8e8a', '#5a5b58', '#232323'] },
    'Camo: snow': { bg: '#f4f5f4', colors: ['#d3d8dc', '#9aa3aa', '#5b636a'] },
    'Camo: blaze orange': { bg: '#ff6a13', colors: ['#c9480a', '#5a2a0e', '#1b1b1b'] },
    'Camo: pink': { bg: '#f7c6d9', colors: ['#e48bb0', '#b04e7e', '#5e2a45'] },
  };

  const defaultState = () => ({
    version: 1,
    name: 'Untitled pattern',
    mode: 'stripes',
    unit: 'in',
    canvas: { width: 8, height: 8 }, // in `unit`
    stripes: {
      fitWidth: true,
      bg: '#ffffff',
      items: [
        { color: '#1f3557', width: 0.5, unit: 'in' },
        { color: '#f3ead8', width: 0.25, unit: 'in' },
        { color: '#a8322a', width: 0.125, unit: 'in' },
        { color: '#f3ead8', width: 0.25, unit: 'in' },
      ],
    },
    gen: {
      type: 'truchet',
      params: Object.fromEntries(Object.entries(VM.GENERATORS).map(([k, g]) => [k, VM.defaultParams(g)])),
      palette: structuredClone(PALETTES['Rodeo']),
    },
    view: { repeat: 3, outline: true, zoom: 1 },
    // Imported SVG art used by pattern stripes, keyed by id. Kept out of undo history.
    assets: {},
    // Set while a pattern stripe is open in Generative mode: { index, gen, canvas }.
    editSession: null,
  });

  // Fill in anything missing from an older or hand-edited project file.
  function normalize(s) {
    const d = defaultState();
    const out = { ...d, ...s, canvas: { ...d.canvas, ...s.canvas }, stripes: { ...d.stripes, ...s.stripes },
      gen: { ...d.gen, ...s.gen }, view: { ...d.view, ...s.view } };
    out.gen.params = { ...d.gen.params };
    for (const k of Object.keys(VM.GENERATORS)) out.gen.params[k] = { ...d.gen.params[k], ...(s.gen?.params?.[k] || {}) };
    out.gen.palette = { ...d.gen.palette, ...(s.gen?.palette || {}) };
    if (!VM.GENERATORS[out.gen.type]) out.gen.type = d.gen.type;
    if (!VM.UNITS.includes(out.unit)) out.unit = d.unit;
    out.assets = s.assets || {};
    return out;
  }

  let state;
  try { state = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); } catch { state = defaultState(); }

  // ------------------------------------------------------------------ helpers
  const $ = (sel) => document.querySelector(sel);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };
  const unitSelect = (value, onchange) =>
    h('select', { onchange: (e) => onchange(e.target.value) }, VM.UNITS.map((u) => h('option', { value: u, selected: u === value }, u)));
  const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

  // A color picker paired with an editable hex box.
  function colorInput(value, onchange) {
    const picker = h('input', { type: 'color', value });
    const hex = h('input', { type: 'text', class: 'hex', value, spellcheck: false });
    picker.addEventListener('input', () => { hex.value = picker.value; onchange(picker.value); });
    hex.addEventListener('input', () => {
      let v = hex.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) { picker.value = v; onchange(v.toLowerCase()); }
    });
    return [picker, hex];
  }

  let saveTimer, frame;
  function changed({ panel = false } = {}) {
    if (panel) renderPanel();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderPreview);
    saveSoon();
    // Structural edits (add/remove/reorder, switching pattern) get their own undo step
    // right away; continuous edits (sliders, typing) are grouped until a short pause.
    if (panel) commitHistory(); else scheduleCommit();
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
      catch {
        // Browser storage is ~5 MB; big imported SVGs can exceed it.
        if (!saveSoon.warned) { saveSoon.warned = true; alert('This project is too big for the browser\'s autosave. Use "Save project" to keep a copy.'); }
      }
    }, 300);
  }

  // ------------------------------------------------------------------ undo / redo
  // History holds snapshots of the design (everything except view settings like zoom).
  const HISTORY_LIMIT = 200;
  // Imported art (assets) is never edited, only added, so it stays out of the snapshots.
  const snapshot = () => JSON.stringify({ ...state, view: undefined, assets: undefined });
  let committed = snapshot();
  const undoStack = [], redoStack = [];
  let commitTimer;

  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitHistory, 500);
  }
  function commitHistory() {
    clearTimeout(commitTimer);
    const now = snapshot();
    if (now === committed) return;
    undoStack.push(committed);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    committed = now;
    updateHistoryButtons();
  }
  function restore(from, to) {
    commitHistory(); // fold in any edit still waiting for its pause
    if (!from.length) return;
    to.push(committed);
    committed = from.pop();
    state = normalize({ ...JSON.parse(committed), view: state.view, assets: state.assets });
    renderPanel();
    cancelAnimationFrame(frame);
    renderPreview();
    saveSoon();
    updateHistoryButtons();
  }
  const undo = () => restore(undoStack, redoStack);
  const redo = () => restore(redoStack, undoStack);
  function updateHistoryButtons() {
    $('#btn-undo').disabled = !undoStack.length;
    $('#btn-redo').disabled = !redoStack.length;
  }

  // ⌘Z / Ctrl+Z undo; ⌘⇧Z, Ctrl+Shift+Z, or Ctrl+Y redo. This takes over undo inside
  // input boxes too, so it behaves the same wherever the cursor is.
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey)) { e.preventDefault(); redo(); }
  });

  // ------------------------------------------------------------------ tile
  // Returns { W, H, bg, body } in px for the current mode.
  function buildTile() {
    const H = VM.toPx(state.canvas.height, state.unit);
    if (state.mode === 'stripes') {
      const total = VM.stripesTotalPx(state.stripes.items);
      const W = state.stripes.fitWidth ? total : VM.toPx(state.canvas.width, state.unit);
      return { W, H, bg: state.stripes.bg, body: VM.renderStripes(state.stripes.items, H, state.assets) };
    }
    const W = VM.toPx(state.canvas.width, state.unit);
    const gen = VM.GENERATORS[state.gen.type];
    const pal = state.gen.palette.colors.length ? state.gen.palette : { ...state.gen.palette, colors: ['#000000'] };
    return { W, H, bg: pal.bg, body: W > 0 && H > 0 ? gen.render(W, H, state.gen.params[state.gen.type], pal) : '' };
  }

  function exportSvg(tile) {
    const { W, H, bg, body } = tile;
    const u = state.unit;
    const dim = (px) => VM.n(VM.fromPx(px, u)) + u;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${dim(W)}" height="${dim(H)}" viewBox="0 0 ${VM.n(W)} ${VM.n(H)}">
<title>${VM.esc(state.name)}</title>
<defs><clipPath id="tile"><rect width="${VM.n(W)}" height="${VM.n(H)}"/></clipPath></defs>
<g clip-path="url(#tile)">
<rect width="${VM.n(W)}" height="${VM.n(H)}" fill="${VM.esc(bg)}"/>
${body}
</g>
</svg>
`;
  }

  // ------------------------------------------------------------------ preview
  let lastTile = null;
  function renderPreview() {
    const tile = (lastTile = buildTile());
    const { W, H } = tile;
    const box = $('#preview');
    const u = state.unit;
    if (!(W > 0 && H > 0)) {
      $('#size-readout').textContent = '';
      box.innerHTML = `<div class="empty">${state.mode === 'stripes' ? 'Add a stripe to get started.' : 'Set a canvas width and height above zero.'}</div>`;
      return;
    }
    $('#size-readout').textContent =
      `Tile: ${VM.fmtUnit(W, u)} × ${VM.fmtUnit(H, u)}` + (u === 'px' ? '' : `  (${Math.round(W)} × ${Math.round(H)} px @ 96/in)`);

    const n = state.view.repeat;
    const content = `<rect width="${VM.n(W)}" height="${VM.n(H)}" fill="${VM.esc(tile.bg)}"/>${tile.body}`;
    box.classList.toggle('infinite', n === 0);
    if (n === 0) {
      // Infinite: the pattern fills the whole view; panning just moves the viewBox.
      // The outline marks a single tile (at the origin), which pans along with the pattern.
      const outline = state.view.outline
        ? `<rect class="pv-outline" width="${VM.n(W)}" height="${VM.n(H)}" fill="none" stroke="#ff2d7a"/>`
        : '';
      box.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><defs><pattern id="pv-pat" width="${VM.n(W)}" height="${VM.n(H)}" patternUnits="userSpaceOnUse">${content}</pattern></defs>` +
        `<rect class="pv-cover" fill="url(#pv-pat)"/>${outline}</svg>`;
      box.scrollTop = box.scrollLeft = 0;
      updateInfiniteView();
      return;
    }
    let inner;
    if (n === 1) {
      inner = `<defs><clipPath id="pv-clip"><rect width="${VM.n(W)}" height="${VM.n(H)}"/></clipPath></defs><g clip-path="url(#pv-clip)">${content}</g>`;
    } else {
      inner = `<defs><pattern id="pv-pat" width="${VM.n(W)}" height="${VM.n(H)}" patternUnits="userSpaceOnUse">${content}</pattern></defs>` +
        `<rect width="${VM.n(W * n)}" height="${VM.n(H * n)}" fill="url(#pv-pat)"/>`;
    }
    if (state.view.outline && n > 1) {
      const o = Math.floor(n / 2);
      inner += `<rect x="${VM.n(W * o)}" y="${VM.n(H * o)}" width="${VM.n(W)}" height="${VM.n(H)}" fill="none" stroke="#ff2d7a" stroke-width="2" stroke-dasharray="8 6" vector-effect="non-scaling-stroke"/>`;
    }
    box.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VM.n(W * n)} ${VM.n(H * n)}">${inner}</svg>`;
    fitPreview();
  }

  // ---- infinite preview
  // Top-left of the view in tile coordinates. `centered` is cleared to re-center the
  // outlined tile the next time the infinite view is drawn.
  const pan = { x: 0, y: 0, centered: false };
  const isInfinite = () => state.view.repeat === 0 && lastTile && lastTile.W > 0 && lastTile.H > 0;
  // Screen px per tile px. At 100% zoom about three tiles span the shorter side of the view.
  function infiniteScale() {
    const box = $('#preview');
    return state.view.zoom * Math.min(box.clientWidth / (3 * lastTile.W), box.clientHeight / (3 * lastTile.H));
  }
  function updateInfiniteView() {
    const box = $('#preview');
    const svg = box.querySelector('svg');
    $('#zoom-fit').textContent = Math.round(state.view.zoom * 100) + '%';
    if (!svg || !isInfinite()) return;
    const s = infiniteScale();
    if (!pan.centered) {
      pan.x = lastTile.W / 2 - box.clientWidth / s / 2;
      pan.y = lastTile.H / 2 - box.clientHeight / s / 2;
      pan.centered = true;
    }
    const vb = [pan.x, pan.y, box.clientWidth / s, box.clientHeight / s].map(VM.n);
    svg.setAttribute('viewBox', vb.join(' '));
    for (const r of svg.querySelectorAll('.pv-cover')) {
      r.setAttribute('x', vb[0]); r.setAttribute('y', vb[1]); r.setAttribute('width', vb[2]); r.setAttribute('height', vb[3]);
    }
    // Keep the outline's line weight and dashes constant on screen at any zoom.
    const line = svg.querySelector('.pv-outline');
    if (line) {
      line.setAttribute('stroke-width', VM.n(2 / s));
      line.setAttribute('stroke-dasharray', `${VM.n(8 / s)} ${VM.n(6 / s)}`);
    }
  }

  // Drag to pan (infinite mode only).
  $('#preview').addEventListener('pointerdown', (e) => {
    if (!isInfinite() || e.button !== 0) return;
    e.preventDefault();
    const box = $('#preview');
    let lx = e.clientX, ly = e.clientY;
    box.classList.add('panning');
    const move = (ev) => {
      const s = infiniteScale();
      pan.x -= (ev.clientX - lx) / s; pan.y -= (ev.clientY - ly) / s;
      lx = ev.clientX; ly = ev.clientY;
      updateInfiniteView();
    };
    const up = () => {
      box.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  // Size the preview: zoom 1 fits the window, other values scale from there.
  function fitPreview() {
    if (isInfinite()) return updateInfiniteView();
    const box = $('#preview');
    const svg = box.querySelector('svg');
    $('#zoom-fit').textContent = Math.round(state.view.zoom * 100) + '%';
    if (!svg || !lastTile) return;
    const aspect = lastTile.W / lastTile.H;
    const availW = box.clientWidth - 48, availH = box.clientHeight - 48;
    const w = Math.max(1, Math.min(availW, availH * aspect)) * state.view.zoom;
    svg.style.width = w + 'px';
    svg.style.height = w / aspect + 'px';
  }
  window.addEventListener('resize', fitPreview);

  const ZOOM_MIN = 0.1, ZOOM_MAX = 40;
  // Zoom keeping the point under (clientX, clientY), or the view center, in place.
  function setZoom(z, clientX, clientY) {
    const box = $('#preview');
    const svg = box.querySelector('svg');
    z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    if (!svg) { state.view.zoom = z; fitPreview(); return; }
    if (isInfinite()) {
      // Keep the tile point under the anchor fixed while the scale changes.
      const rect = box.getBoundingClientRect();
      const ax = (clientX ?? rect.left + rect.width / 2) - rect.left, ay = (clientY ?? rect.top + rect.height / 2) - rect.top;
      const s0 = infiniteScale();
      const wx = pan.x + ax / s0, wy = pan.y + ay / s0;
      state.view.zoom = z;
      const s1 = infiniteScale();
      pan.x = wx - ax / s1; pan.y = wy - ay / s1;
      updateInfiniteView();
      saveSoon();
      return;
    }
    const rect = box.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const cx = clientX ?? rect.left + rect.width / 2;
    const cy = clientY ?? rect.top + rect.height / 2;
    // Position of the anchor as a fraction of the drawing.
    const fx = (cx - svgRect.left) / svgRect.width, fy = (cy - svgRect.top) / svgRect.height;
    state.view.zoom = z;
    fitPreview();
    const after = svg.getBoundingClientRect();
    box.scrollLeft += after.left + fx * after.width - cx;
    box.scrollTop += after.top + fy * after.height - cy;
    saveSoon();
  }
  const zoomBy = (factor, x, y) => setZoom(state.view.zoom * factor, x, y);

  $('#zoom-in').addEventListener('click', () => zoomBy(1.25));
  $('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.25));
  $('#zoom-fit').addEventListener('click', () => setZoom(1));
  // ⌘/Ctrl + scroll wheel, and trackpad pinch (which arrives as ctrl + wheel).
  // In infinite mode, plain scrolling (two-finger trackpad swipe) pans.
  $('#preview').addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    } else if (isInfinite()) {
      e.preventDefault();
      const s = infiniteScale();
      pan.x += e.deltaX / s; pan.y += e.deltaY / s;
      updateInfiniteView();
    }
  }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.25);
    else if (e.key === '0') setZoom(1);
  });

  // Clicking a stripe in the single-tile preview highlights its row in the inventory.
  $('#preview').addEventListener('click', (e) => {
    const i = e.target.closest?.('[data-stripe]')?.getAttribute('data-stripe');
    if (i != null) flashStripe(i);
  });
  function flashStripe(i) {
    const row = document.querySelector(`.stripe[data-index="${i}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 900);
  }

  // ------------------------------------------------------------------ panel
  function canvasSection({ widthEditable }) {
    const unitChange = (u) => {
      // Keep the physical size the same when switching units.
      for (const k of ['width', 'height']) {
        const px = VM.toPx(state.canvas[k], state.unit);
        const v = VM.fromPx(px, u);
        state.canvas[k] = u === 'px' ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000;
      }
      state.unit = u;
      changed({ panel: true });
    };
    const dimInput = (key) => h('input', {
      type: 'number', min: 0, step: 'any', value: state.canvas[key],
      oninput: (e) => { state.canvas[key] = num(e.target.value); changed(); },
    });
    return [
      h('h3', {}, 'Canvas (one repeat)'),
      h('div', { class: 'row' },
        widthEditable ? [h('label', {}, 'W ', dimInput('width'))] : null,
        h('label', {}, 'H ', dimInput('height')),
        unitSelect(state.unit, unitChange)),
    ];
  }

  function stripesPanel() {
    const s = state.stripes;
    const items = s.items;
    const list = h('ul', { class: 'stripe-list' }, items.map((st, i) =>
      h('li', { class: 'stripe' + (st.kind === 'pattern' ? ' pattern' : ''), 'data-index': i },
        h('span', { class: 'grip', title: 'Drag to reorder' }, '⠿'),
        h('span', { class: 'idx' }, String(i + 1)),
        st.kind === 'pattern' ? patternBadge(st) : colorInput(st.color, (c) => { st.color = c; changed(); }),
        h('input', { type: 'number', min: 0, step: 'any', value: st.width, title: 'Stripe width',
          oninput: (e) => { st.width = num(e.target.value); changed(); updateTotal(); } }),
        unitSelect(st.unit, (u) => {
          // Convert so the stripe keeps its physical width.
          const v = VM.fromPx(VM.toPx(st.width, st.unit), u);
          st.width = u === 'px' ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000;
          st.unit = u;
          changed({ panel: true });
        }),
        h('span', { class: 'spacer' }),
        st.kind === 'pattern' ? null : h('button', { class: 'icon' + (st.gradient ? ' on' : ''), title: st.gradient ? 'Make solid' : 'Make gradient', onclick: () => {
          st.gradient = !st.gradient;
          if (st.gradient && !st.color2) {
            // Start with a neighbor's color (or white) so the fade is visible right away.
            const next = items[i + 1] || items[i - 1];
            st.color2 = next && next.color !== st.color ? next.color : '#ffffff';
          }
          // Fade & back repeats seamlessly top to bottom, so it's the safer default.
          st.shape = st.shape || 'peak';
          st.steps = st.steps ?? 0;
          changed({ panel: true });
        } }, '◐'),
        h('button', { class: 'icon', title: 'Duplicate (insert copy right after this stripe)', onclick: () => { items.splice(i + 1, 0, structuredClone(st)); changed({ panel: true }); } }, '⧉'),
        h('button', { class: 'icon', title: 'Copy to end (append a copy after the last stripe)', onclick: () => { items.push(structuredClone(st)); changed({ panel: true }); } }, '⇥'),
        h('button', { class: 'icon', title: 'Remove', onclick: () => { items.splice(i, 1); changed({ panel: true }); } }, '✕'),
        st.kind === 'pattern' ? patternLine(st, i) : null,
        st.kind !== 'pattern' && st.gradient ? h('div', { class: 'gradline' },
          h('span', { class: 'arrow', title: 'Color the stripe fades to, top to bottom' }, '↓ to'),
          colorInput(st.color2, (c) => { st.color2 = c; changed(); }),
          h('select', { title: 'Gradient shape', onchange: (e) => { st.shape = e.target.value; changed(); } },
            Object.entries(VM.GRADIENT_SHAPES).map(([k, label]) => h('option', { value: k, selected: k === st.shape }, label))),
          h('label', { title: '0 = smooth gradient. Any other number splits the stripe into that many solid horizontal bands.' }, 'steps ',
            h('input', { type: 'number', min: 0, max: 200, step: 1, value: st.steps || 0, class: 'steps',
              oninput: (e) => { st.steps = Math.max(0, Math.round(num(e.target.value))); changed(); } })),
          h('button', { class: 'icon', title: 'Swap start and end colors', onclick: () => { [st.color, st.color2] = [st.color2, st.color]; changed({ panel: true }); } }, '⇄'),
        ) : null,
        st.kind !== 'pattern' && st.gradient ? shiftControl(st) : null,
      )));

    enableStripeDrag(list, items);

    const total = h('div', { class: 'hint' });
    const updateTotal = () => {
      const px = VM.stripesTotalPx(items);
      total.textContent = `${items.length} stripe${items.length === 1 ? '' : 's'}, total width ${VM.fmtUnit(px, state.unit)}`;
    };
    updateTotal();

    const addStripe = () => {
      const last = items[items.length - 1];
      items.push(last && last.kind !== 'pattern' ? { ...last } : { color: '#1f3557', width: 0.25, unit: state.unit === 'px' ? 'in' : state.unit });
      changed({ panel: true });
      $('#panel').querySelector('.stripe:last-child input.hex')?.focus();
    };

    return [
      ...canvasSection({ widthEditable: !s.fitWidth }),
      h('label', { class: 'row' },
        h('input', { type: 'checkbox', checked: s.fitWidth, onchange: (e) => { s.fitWidth = e.target.checked; changed({ panel: true }); } }),
        'Canvas width = total stripe width (seamless repeat)'),
      !s.fitWidth ? h('div', { class: 'hint' }, 'Stripes past the canvas width are cut off; leftover space shows the background.') : null,
      h('div', { class: 'row' }, h('span', {}, 'Background'), colorInput(s.bg, (c) => { s.bg = c; changed(); })),

      h('h3', {}, 'Stripe inventory (left → right)'),
      list,
      total,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: addStripe }, '+ Add stripe'),
        h('button', { title: 'Add a stripe filled with the pattern currently set up in Generative mode', onclick: () => addPatternStripe(currentGenPattern()) }, '+ Pattern stripe'),
        h('button', { title: 'Import a saved project (.json) or an SVG file as a pattern stripe', onclick: () => $('#file-import').click() }, 'Import…'),
      ),
      h('div', { class: 'row' },
        h('button', { title: 'Append the stripes in reverse order for a symmetric repeat', onclick: () => {
          items.push(...items.slice(0, -1).reverse().map((x) => structuredClone(x)));
          changed({ panel: true });
        } }, 'Mirror'),
        h('button', { onclick: () => { if (confirm('Remove all stripes?')) { items.length = 0; changed({ panel: true }); } } }, 'Clear'),
      ),
      h('p', { class: 'hint' }, 'Drag rows by the ⠿ grip to reorder. ◐ makes a stripe fade top to bottom. "Fade & back" repeats seamlessly when tiles stack; a one-way "Fade ↓" shows a line where they meet. Mirror appends the stripes in reverse order, skipping the last one so the center stripe is not doubled. Click a stripe in the preview to find it in this list. Pattern stripes repeat their tile down the stripe; "+ Pattern stripe" uses whatever is set up in Generative mode, and Import… takes a saved project or any SVG.'),
    ];
  }

  // ---- pattern stripes
  const genName = (p) => (p.source === 'svg' ? state.assets[p.asset]?.name || 'Imported SVG' : VM.GENERATORS[p.type]?.name || p.type);

  // The pattern set up in Generative mode, as a stripe fill.
  function currentGenPattern() {
    const W = VM.toPx(state.canvas.width, state.unit), H = VM.toPx(state.canvas.height, state.unit);
    return { source: 'gen', type: state.gen.type, params: structuredClone(state.gen.params[state.gen.type]),
      palette: structuredClone(state.gen.palette), aspect: W > 0 && H > 0 ? W / H : 1, height: H > 0 ? H : 96 };
  }

  function addPatternStripe(pattern) {
    const items = state.stripes.items;
    const H = VM.toPx(state.canvas.height, state.unit);
    const unit = state.unit === 'px' ? 'in' : state.unit;
    items.push({ kind: 'pattern', pattern, repeats: Math.max(1, Math.round(H / pattern.height)), width: unit === 'cm' ? 2.5 : 1, unit, color: '#000000' });
    state.mode = 'stripes';
    changed({ panel: true });
    flashStripe(items.length - 1);
  }

  // Thumbnail + name shown in place of the color swatch.
  function patternBadge(st) {
    const H = VM.toPx(state.canvas.height, state.unit);
    const k = VM.patternRepeats(st, H);
    const th = H / k, tw = th * (st.pattern.aspect || 1);
    const thumb = h('span', { class: 'thumb' });
    thumb.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${VM.n(tw)} ${VM.n(th)}" preserveAspectRatio="xMidYMid slice">${VM.patternTile(st.pattern, state.assets, tw, th)}</svg>`;
    return [thumb, h('span', { class: 'pname', title: genName(st.pattern) }, genName(st.pattern))];
  }

  // Second line of a pattern stripe: repeats, tile size, reseed, edit.
  function patternLine(st, i) {
    const H = VM.toPx(state.canvas.height, state.unit);
    const k = VM.patternRepeats(st, H);
    const th = H / k, tw = th * (st.pattern.aspect || 1);
    const gen = st.pattern.source === 'gen' ? VM.GENERATORS[st.pattern.type] : null;
    const hasSeed = gen?.params.some((d) => d.key === 'seed');
    return h('div', { class: 'gradline' },
      h('label', { title: 'How many times the pattern tile repeats down the stripe. More repeats = smaller pattern.' }, 'repeats down ',
        h('input', { type: 'number', min: 1, max: 100, step: 1, value: k, class: 'steps',
          onchange: (e) => { st.repeats = Math.max(1, Math.round(num(e.target.value)) || 1); changed({ panel: true }); } })),
      h('span', { class: 'arrow', title: 'Size of one pattern tile' }, `tile ${VM.fmtUnit(tw, state.unit)} × ${VM.fmtUnit(th, state.unit)}`),
      h('span', { class: 'spacer' }),
      hasSeed ? h('button', { class: 'icon', title: 'New random seed', onclick: () => { st.pattern.params.seed = VM.randomSeed(); changed({ panel: true }); } }, '🎲') : null,
      gen ? h('button', { title: 'Open this pattern in Generative mode to change its settings', onclick: () => editPatternStripe(i) }, 'Edit') : null,
    );
  }

  // Open a pattern stripe in Generative mode. The canvas becomes the stripe's tile size;
  // everything Generative mode had before is stashed and restored afterwards.
  function editPatternStripe(i) {
    const st = state.stripes.items[i], p = st.pattern;
    const H = VM.toPx(state.canvas.height, state.unit);
    const k = VM.patternRepeats(st, H);
    const round = (v) => (state.unit === 'px' ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000);
    state.editSession = { index: i, gen: structuredClone(state.gen), canvas: { ...state.canvas } };
    state.gen.type = p.type;
    state.gen.params[p.type] = { ...VM.defaultParams(VM.GENERATORS[p.type]), ...structuredClone(p.params) };
    state.gen.palette = structuredClone(p.palette);
    state.canvas.height = round(VM.fromPx(H / k, state.unit));
    state.canvas.width = round(VM.fromPx((H / k) * (p.aspect || 1), state.unit));
    state.mode = 'generative';
    changed({ panel: true });
  }

  function finishPatternEdit(save) {
    const ses = state.editSession;
    if (!ses) return;
    const pattern = currentGenPattern();
    state.gen = ses.gen;
    state.canvas = ses.canvas;
    const st = state.stripes.items[ses.index];
    if (save && st?.kind === 'pattern') {
      st.pattern = pattern;
      st.repeats = Math.max(1, Math.round(VM.toPx(state.canvas.height, state.unit) / pattern.height));
    }
    state.editSession = null;
    state.mode = 'stripes';
    changed({ panel: true });
    flashStripe(ses.index);
  }

  // Import a saved project (its Generative pattern) or an SVG file as a pattern stripe.
  async function importPatternFile(file) {
    const text = await file.text();
    if (/\.svg$/i.test(file.name) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) {
      const art = parseSvgArt(text, file.name.replace(/\.svg$/i, ''));
      const id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      state.assets[id] = { name: art.name, viewBox: art.viewBox, markup: art.markup };
      addPatternStripe({ source: 'svg', asset: id, aspect: art.viewBox[2] / art.viewBox[3], height: art.heightPx });
    } else {
      const proj = normalize(JSON.parse(text));
      const W = VM.toPx(proj.canvas.width, proj.unit), H = VM.toPx(proj.canvas.height, proj.unit);
      if (!(W > 0 && H > 0)) throw new Error('that project has an empty canvas');
      addPatternStripe({ source: 'gen', type: proj.gen.type, params: proj.gen.params[proj.gen.type], palette: proj.gen.palette, aspect: W / H, height: H });
    }
  }

  // Pull the drawing out of an SVG file: its viewBox, physical height, and inner markup with
  // ids prefixed (so several imports can't collide) and anything scriptable removed.
  function parseSvgArt(text, name) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error("that file isn't a valid SVG");
    const len = (v) => {
      const m = /^\s*([\d.]+)\s*(px|in|cm|mm|pt)?\s*$/.exec(v || '');
      if (!m) return 0;
      return parseFloat(m[1]) * ({ px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72 }[m[2] || 'px']);
    };
    let vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || vb[2] <= 0 || vb[3] <= 0) {
      const w = len(root.getAttribute('width')), hh = len(root.getAttribute('height'));
      if (!(w > 0 && hh > 0)) throw new Error('the SVG has no size (viewBox or width/height)');
      vb = [0, 0, w, hh];
    }
    const heightPx = len(root.getAttribute('height')) || vb[3];
    root.querySelectorAll('script, foreignObject').forEach((el) => el.remove());
    const prefix = 'imp' + Math.floor(Math.random() * 1e6).toString(36) + '-';
    const all = [...root.querySelectorAll('*')];
    const ids = new Set(all.map((el) => el.id).filter(Boolean));
    for (const el of all) {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) { el.removeAttribute(attr.name); continue; }
        if (attr.name === 'id') { el.setAttribute('id', prefix + attr.value); continue; }
        let v = attr.value.replace(/url\(\s*#([^)\s]+)\s*\)/g, (m, id) => (ids.has(id) ? `url(#${prefix}${id})` : m));
        if (/href$/.test(attr.name) && v.startsWith('#') && ids.has(v.slice(1))) v = '#' + prefix + v.slice(1);
        if (v !== attr.value) el.setAttributeNS(attr.namespaceURI, attr.name, v);
      }
    }
    const ser = new XMLSerializer();
    const markup = [...root.childNodes].filter((nd) => nd.nodeType === 1 && nd.nodeName !== 'title').map((nd) => ser.serializeToString(nd)).join('');
    return { name, viewBox: vb, heightPx, markup };
  }

  // Slider + number for sliding a stripe's fade up or down (percent of tile height, wrapping).
  function shiftControl(st) {
    const value = st.shift || 0;
    const range = h('input', { type: 'range', min: 0, max: 100, step: 0.5, value: VM.mod(value, 100), title: 'Slide the fade down (wraps around, so it still tiles)' });
    const box = h('input', { type: 'number', step: 1, value, class: 'steps', title: 'Shift in % of tile height. Any value works; it wraps every 100%.' });
    range.addEventListener('input', () => { box.value = range.value; st.shift = num(range.value); changed(); });
    box.addEventListener('input', () => { st.shift = num(box.value); range.value = VM.mod(st.shift, 100); changed(); });
    return h('div', { class: 'gradline shiftline' }, h('span', { class: 'arrow' }, '↕ shift'), range, box, h('span', { class: 'arrow' }, '%'));
  }

  // Drag a stripe row (by its grip or any non-control part) to reorder. Other rows slide
  // out of the way, and the preview shows the new order live while dragging.
  function enableStripeDrag(list, items) {
    list.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.stripe');
      if (!row || e.button !== 0 || e.target.closest('input, select, button')) return;
      e.preventDefault();
      const rows = [...list.children];
      const from = rows.indexOf(row);
      const original = items.slice();
      const panel = $('#panel');
      const listTop = () => list.getBoundingClientRect().top;
      // Row geometry in list coordinates, captured before anything moves.
      const base = listTop();
      const geo = rows.map((r) => { const b = r.getBoundingClientRect(); return { top: b.top - base, mid: b.top - base + b.height / 2 }; });
      // Rows can differ in height (gradient rows are taller); others move by the dragged row's size.
      const pitch = row.getBoundingClientRect().height + parseFloat(getComputedStyle(row).marginBottom || 0);
      const startY = e.clientY - base;
      let to = from;

      row.classList.add('dragging');
      list.classList.add('drag-active');

      const onMove = (ev) => {
        // Auto-scroll when dragging near the top or bottom of the panel.
        const pb = panel.getBoundingClientRect();
        if (ev.clientY < pb.top + 40) panel.scrollTop -= 12;
        else if (ev.clientY > pb.bottom - 40) panel.scrollTop += 12;

        const dy = ev.clientY - listTop() - startY;
        row.style.transform = `translateY(${dy}px)`;
        const center = geo[from].mid + dy;
        let target = 0;
        geo.forEach((g, i) => { if (i !== from && g.mid < center) target++; });
        if (target === to) return;
        to = target;
        rows.forEach((r, i) => {
          if (i === from) return;
          const shift = from < to && i > from && i <= to ? -pitch : to < from && i >= to && i < from ? pitch : 0;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
        // Live preview of the tentative order.
        const order = original.slice();
        order.splice(to, 0, order.splice(from, 1)[0]);
        items.splice(0, items.length, ...order);
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(renderPreview);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        list.classList.remove('drag-active');
        row.classList.remove('dragging');
        rows.forEach((r) => { r.style.transform = ''; });
        // Re-render the panel (rows renumber) and record one undo step if the order changed.
        if (to !== from) changed({ panel: true });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  // Whether a param applies right now (params can declare `when: { otherKey: [values] }`).
  const paramVisible = (def, params) => !def.when || Object.entries(def.when).every(([k, vals]) => vals.includes(params[k]));

  function paramField(def, params) {
    const set = (v) => { params[def.key] = v; changed(); };
    const label = h('span', { class: 'label' }, def.label);
    if (def.type === 'select') {
      // Choices can load preset values for other params and change which params are shown,
      // so they re-render the panel.
      return h('div', { class: 'field' }, label,
        h('select', { onchange: (e) => {
          params[def.key] = e.target.value;
          if (def.presets?.[e.target.value]) Object.assign(params, def.presets[e.target.value]);
          changed({ panel: true });
        } }, def.options.map((o) => h('option', { value: o, selected: o === params[def.key] }, o))));
    }
    if (def.type === 'bool') {
      return h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: !!params[def.key], onchange: (e) => { params[def.key] = e.target.checked; changed({ panel: true }); } }), def.label);
    }
    if (def.type === 'seed') {
      const box = h('input', { type: 'number', step: 1, value: params[def.key], oninput: (e) => set(Math.round(num(e.target.value))) });
      return h('div', { class: 'field' }, label, h('div', { class: 'controls' }, box,
        h('button', { title: 'New random seed', onclick: () => { box.value = VM.randomSeed(); set(+box.value); } }, '🎲 Randomize')));
    }
    // int / float: slider + number box kept in sync
    const step = def.type === 'int' ? 1 : def.step || 0.1;
    const clamp = (v) => (def.type === 'int' ? Math.round(v) : v);
    const range = h('input', { type: 'range', min: def.min, max: def.max, step, value: params[def.key] });
    const box = h('input', { type: 'number', step, value: params[def.key] });
    range.addEventListener('input', () => { box.value = range.value; set(clamp(num(range.value))); });
    box.addEventListener('input', () => { range.value = box.value; set(clamp(num(box.value))); });
    return h('div', { class: 'field' }, label, h('div', { class: 'controls' }, range, box));
  }

  function generativePanel() {
    const g = state.gen;
    const gen = VM.GENERATORS[g.type];
    const params = g.params[g.type];
    const pal = g.palette;

    const swatches = h('div', { class: 'palette' },
      pal.colors.map((c, i) => h('div', { class: 'swatch' },
        h('input', { type: 'color', value: c, title: `Color ${i + 1}`, oninput: (e) => { pal.colors[i] = e.target.value; changed(); } }),
        pal.colors.length > 1 ? h('button', { class: 'remove', title: 'Remove color', onclick: () => { pal.colors.splice(i, 1); changed({ panel: true }); } }, '✕') : null)),
      h('button', { class: 'icon', title: 'Add color', onclick: () => { pal.colors.push(pal.colors[pal.colors.length - 1] || '#000000'); changed({ panel: true }); } }, '+'));

    const ses = state.editSession;
    return [
      ses ? h('div', { class: 'banner' },
        h('div', {}, h('strong', {}, `Editing the pattern in stripe ${ses.index + 1}.`), ' The canvas is set to that stripe\'s tile size.'),
        h('div', { class: 'row' },
          h('button', { class: 'primary', onclick: () => finishPatternEdit(true) }, 'Save to stripe'),
          h('button', { onclick: () => finishPatternEdit(false) }, 'Cancel'))) : null,
      ...canvasSection({ widthEditable: true }),
      h('h3', {}, 'Pattern'),
      h('select', { onchange: (e) => { g.type = e.target.value; changed({ panel: true }); } },
        Object.entries(VM.GENERATORS).map(([k, x]) => h('option', { value: k, selected: k === g.type }, x.name))),
      h('p', { class: 'blurb' }, gen.blurb),
      gen.params.filter((def) => paramVisible(def, params)).map((def) => paramField(def, params)),
      h('div', { class: 'row' },
        h('button', { onclick: () => { g.params[g.type] = VM.defaultParams(gen); changed({ panel: true }); } }, 'Reset pattern settings'),
        ses ? null : h('button', { title: 'Add this pattern to Stripes mode as a pattern stripe', onclick: () => addPatternStripe(currentGenPattern()) }, 'Use as stripe →')),

      h('h3', {}, 'Colors'),
      h('div', { class: 'row' }, h('span', {}, 'Background'), colorInput(pal.bg, (c) => { pal.bg = c; changed(); })),
      h('div', { class: 'row' }, h('span', {}, 'Ink'), swatches),
      h('div', { class: 'row' },
        h('select', { onchange: (e) => { if (e.target.value) { g.palette = structuredClone(PALETTES[e.target.value]); changed({ panel: true }); } } },
          h('option', { value: '' }, 'Load a palette…'),
          Object.keys(PALETTES).map((k) => h('option', { value: k }, k)))),
      h('p', { class: 'hint' }, 'Colors cycle by layer, level, or band. Most patterns use every ink color; Truchet uses the first unless "Color each tile randomly" is on.'),
    ];
  }

  function renderPanel() {
    const panel = $('#panel');
    const scroll = panel.scrollTop;
    panel.replaceChildren(...[state.mode === 'stripes' ? stripesPanel() : generativePanel()].flat(Infinity).filter(Boolean));
    panel.scrollTop = scroll;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    $('#project-name').value = state.name;
    $('#repeat').value = String(state.view.repeat);
    $('#outline').checked = state.view.outline;
  }

  // ------------------------------------------------------------------ top bar
  const slug = () => (state.name.trim() || 'pattern').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase();
  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.querySelectorAll('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      if (state.editSession && b.dataset.mode === 'stripes') return finishPatternEdit(true);
      state.mode = b.dataset.mode;
      changed({ panel: true });
    }));
  $('#project-name').addEventListener('input', (e) => { state.name = e.target.value; changed(); });
  $('#repeat').addEventListener('change', (e) => { state.view.repeat = +e.target.value; pan.centered = false; changed(); });
  $('#outline').addEventListener('change', (e) => { state.view.outline = e.target.checked; changed(); });

  $('#btn-export').addEventListener('click', () => {
    const tile = buildTile();
    if (!(tile.W > 0 && tile.H > 0)) return alert('The canvas is empty: nothing to export.');
    const suffix = state.mode === 'stripes' ? 'stripes' : state.gen.type;
    download(`${slug()}-${suffix}.svg`, exportSvg(tile), 'image/svg+xml');
  });
  $('#btn-save').addEventListener('click', () => {
    const used = new Set(state.stripes.items.map((s) => s.pattern?.asset).filter(Boolean));
    const assets = Object.fromEntries(Object.entries(state.assets).filter(([id]) => used.has(id)));
    download(`${slug()}.vectormaker.json`, JSON.stringify({ ...state, assets }, null, 2), 'application/json');
  });
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { await importPatternFile(file); } catch (err) { alert('Could not import that file: ' + err.message); }
  });
  $('#btn-open').addEventListener('click', () => $('#file-open').click());
  $('#file-open').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      state = normalize(JSON.parse(await file.text()));
      changed({ panel: true });
    } catch (err) {
      alert('Could not open that file: ' + err.message);
    }
  });
  $('#btn-new').addEventListener('click', () => {
    if (!confirm('Start a new project? Unsaved changes to the current one will be lost.')) return;
    state = defaultState();
    changed({ panel: true });
  });

  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);

  renderPanel();
  renderPreview();
  updateHistoryButtons();
})(window.VM);
