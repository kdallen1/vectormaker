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
    saveTimer = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), 300);
  }

  // ------------------------------------------------------------------ undo / redo
  // History holds snapshots of the design (everything except view settings like zoom).
  const HISTORY_LIMIT = 200;
  const snapshot = () => JSON.stringify({ ...state, view: undefined });
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
    state = normalize({ ...JSON.parse(committed), view: state.view });
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
      return { W, H, bg: state.stripes.bg, body: VM.renderStripes(state.stripes.items, H) };
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
<svg xmlns="http://www.w3.org/2000/svg" width="${dim(W)}" height="${dim(H)}" viewBox="0 0 ${VM.n(W)} ${VM.n(H)}">
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

  // Size the preview: zoom 1 fits the window, other values scale from there.
  function fitPreview() {
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
  $('#preview').addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
  }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.25);
    else if (e.key === '0') setZoom(1);
  });

  // Clicking a stripe in the single-tile preview highlights its row in the inventory.
  $('#preview').addEventListener('click', (e) => {
    const i = e.target.getAttribute?.('data-stripe');
    if (i == null) return;
    const row = document.querySelector(`.stripe[data-index="${i}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 900);
  });

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
    const move = (i, j) => { if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; changed({ panel: true }); };

    const list = h('ul', { class: 'stripe-list' }, items.map((st, i) =>
      h('li', { class: 'stripe', 'data-index': i },
        h('span', { class: 'idx' }, String(i + 1)),
        colorInput(st.color, (c) => { st.color = c; changed(); }),
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
        h('button', { class: 'icon', title: 'Move left', onclick: () => move(i, i - 1) }, '↑'),
        h('button', { class: 'icon', title: 'Move right', onclick: () => move(i, i + 1) }, '↓'),
        h('button', { class: 'icon', title: 'Duplicate (insert copy right after this stripe)', onclick: () => { items.splice(i + 1, 0, { ...st }); changed({ panel: true }); } }, '⧉'),
        h('button', { class: 'icon', title: 'Copy to end (append a copy after the last stripe)', onclick: () => { items.push({ ...st }); changed({ panel: true }); } }, '⇥'),
        h('button', { class: 'icon', title: 'Remove', onclick: () => { items.splice(i, 1); changed({ panel: true }); } }, '✕'),
      )));

    const total = h('div', { class: 'hint' });
    const updateTotal = () => {
      const px = VM.stripesTotalPx(items);
      total.textContent = `${items.length} stripe${items.length === 1 ? '' : 's'}, total width ${VM.fmtUnit(px, state.unit)}`;
    };
    updateTotal();

    const addStripe = () => {
      const last = items[items.length - 1];
      items.push(last ? { ...last } : { color: '#1f3557', width: 0.25, unit: state.unit === 'px' ? 'in' : state.unit });
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
        h('button', { title: 'Append the stripes in reverse order for a symmetric repeat', onclick: () => {
          items.push(...items.slice(0, -1).reverse().map((x) => ({ ...x })));
          changed({ panel: true });
        } }, 'Mirror'),
        h('button', { onclick: () => { if (confirm('Remove all stripes?')) { items.length = 0; changed({ panel: true }); } } }, 'Clear'),
      ),
      h('p', { class: 'hint' }, 'Mirror appends the stripes in reverse order, skipping the last one so the center stripe is not doubled. Click a stripe in the preview to find it in this list.'),
    ];
  }

  function paramField(def, params) {
    const set = (v) => { params[def.key] = v; changed(); };
    const label = h('span', { class: 'label' }, def.label);
    if (def.type === 'select') {
      return h('div', { class: 'field' }, label,
        h('select', { onchange: (e) => set(e.target.value) }, def.options.map((o) => h('option', { value: o, selected: o === params[def.key] }, o))));
    }
    if (def.type === 'bool') {
      return h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: !!params[def.key], onchange: (e) => set(e.target.checked) }), def.label);
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

    return [
      ...canvasSection({ widthEditable: true }),
      h('h3', {}, 'Pattern'),
      h('select', { onchange: (e) => { g.type = e.target.value; changed({ panel: true }); } },
        Object.entries(VM.GENERATORS).map(([k, x]) => h('option', { value: k, selected: k === g.type }, x.name))),
      h('p', { class: 'blurb' }, gen.blurb),
      gen.params.map((def) => paramField(def, params)),
      h('div', { class: 'row' }, h('button', { onclick: () => { g.params[g.type] = VM.defaultParams(gen); changed({ panel: true }); } }, 'Reset pattern settings')),

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
    b.addEventListener('click', () => { state.mode = b.dataset.mode; changed({ panel: true }); }));
  $('#project-name').addEventListener('input', (e) => { state.name = e.target.value; changed(); });
  $('#repeat').addEventListener('change', (e) => { state.view.repeat = +e.target.value; changed(); });
  $('#outline').addEventListener('change', (e) => { state.view.outline = e.target.checked; changed(); });

  $('#btn-export').addEventListener('click', () => {
    const tile = buildTile();
    if (!(tile.W > 0 && tile.H > 0)) return alert('The canvas is empty: nothing to export.');
    const suffix = state.mode === 'stripes' ? 'stripes' : state.gen.type;
    download(`${slug()}-${suffix}.svg`, exportSvg(tile), 'image/svg+xml');
  });
  $('#btn-save').addEventListener('click', () => download(`${slug()}.vectormaker.json`, JSON.stringify(state, null, 2), 'application/json'));
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
