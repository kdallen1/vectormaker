// Vertical stripes: each stripe is a full-height box placed flush against the previous one.
// A stripe can be solid, a top-to-bottom gradient (smooth or split into solid steps), or
// filled with a repeating pattern: a generative pattern or imported SVG art.
(function (VM) {
  VM.stripeWidthPx = (s) => Math.max(0, VM.toPx(Number(s.width) || 0, s.unit));

  VM.stripesTotalPx = (stripes) => stripes.reduce((sum, s) => sum + VM.stripeWidthPx(s), 0);

  // Gradient shapes, top to bottom: 'fade' goes color -> color2 (a hard edge where tiles
  // stack vertically); 'peak' goes color -> color2 -> color, which repeats seamlessly.
  VM.GRADIENT_SHAPES = { fade: 'Fade ↓', peak: 'Fade & back' };

  const hexToRgb = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const v = m ? parseInt(m[1], 16) : 0;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const rgbToHex = (rgb) => '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
  // Straight sRGB mix, which is also how SVG viewers blend smooth gradients, so stepped
  // and smooth versions of the same stripe line up.
  VM.mixColor = (a, b, t) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
  };

  // How a gradient stripe is drawn. Steps, dither, halftone, and lines are all solid-color
  // shapes (good for screen printing); smooth is a true SVG gradient.
  VM.GRADIENT_LOOKS = { smooth: 'Smooth', steps: 'Steps', dither: 'Dither', halftone: 'Halftone', lines: 'Lines' };
  VM.DITHER_METHODS = { bayer: 'Bayer', noise: 'Noise', diffusion: 'Diffusion' };
  VM.gradientLook = (s) => s.look || (Number(s.steps) > 0 ? 'steps' : 'smooth');

  const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

  // Pieces for the textured looks. Each piece is [y0, y1, fill, x0, x1, dot]: a box from y0 to
  // y1 covering the fraction x0..x1 of the stripe's width. With `dot`, an ellipse sits in the
  // box instead, scaled so its area is dot² × π of the box. `tAt(y)` is the fade amount.
  function texturePieces(s, look, w, H, tAt, color, seedBase) {
    const out = [];
    if (look === 'dither') {
      const px = Math.max(0.5, Number(s.pixel) || 3);
      const L = Math.max(2, Math.round(Number(s.levels) || 2));
      const method = s.dither || 'bayer';
      // Bayer repeats every 4 rows, so the row count is a multiple of 4 to wrap cleanly.
      let rows = Math.max(1, Math.round(H / px));
      if (method === 'bayer') rows = Math.max(4, Math.round(rows / 4) * 4);
      const cols = Math.max(1, Math.round(w / px)), ch = H / rows;
      const rnd = VM.rng(seedBase);
      let err = new Float64Array(cols + 2), next = new Float64Array(cols + 2);
      for (let r = 0; r < rows; r++) {
        const v0 = tAt((r + 0.5) * ch) * (L - 1);
        let runStart = 0, runLevel = -1;
        for (let c = 0; c <= cols; c++) {
          let lvl = -2;
          if (c < cols) {
            if (method === 'diffusion') {
              // Floyd–Steinberg: push each pixel's rounding error onto its unvisited neighbors.
              const v = v0 + err[c + 1];
              lvl = Math.max(0, Math.min(L - 1, Math.round(v)));
              const e = v - lvl;
              err[c + 2] += (e * 7) / 16; next[c] += (e * 3) / 16; next[c + 1] += (e * 5) / 16; next[c + 2] += e / 16;
            } else {
              const base = Math.floor(v0), fr = v0 - base;
              const thr = method === 'noise' ? rnd() : (BAYER4[r % 4][c % 4] + 0.5) / 16;
              lvl = Math.max(0, Math.min(L - 1, base + (fr > thr ? 1 : 0)));
            }
          }
          if (lvl !== runLevel) {
            if (runLevel >= 0) out.push([r * ch, (r + 1) * ch, color(runLevel / (L - 1)), runStart / cols, c / cols]);
            runStart = c; runLevel = lvl;
          }
        }
        if (method === 'diffusion') { err = next; next = new Float64Array(cols + 2); }
      }
    } else if (look === 'halftone') {
      // Dots of the end color grow on the start color; past halfway the roles swap, so each
      // cell's coverage matches the fade exactly and the ends are pure color.
      const cell = Math.max(1, Number(s.cell) || 6);
      const rows = Math.max(1, Math.round(H / cell)), cols = Math.max(1, Math.round(w / cell)), ch = H / rows;
      for (let r = 0; r < rows; r++) {
        const t = tAt((r + 0.5) * ch), a = t <= 0.5 ? t : 1 - t;
        out.push([r * ch, (r + 1) * ch, color(t <= 0.5 ? 0 : 1), 0, 1]);
        if (a > 0.002) for (let c = 0; c < cols; c++) out.push([r * ch, (r + 1) * ch, color(t <= 0.5 ? 1 : 0), c / cols, (c + 1) / cols, Math.sqrt(a / Math.PI)]);
      }
    } else if (look === 'lines') {
      // One line per row, its thickness following the fade.
      const sp = Math.max(1, Number(s.spacing) || 4);
      const rows = Math.max(1, Math.round(H / sp)), ch = H / rows;
      for (let r = 0; r < rows; r++) {
        const t = tAt((r + 0.5) * ch), th = t * ch, y0 = r * ch, gap = (ch - th) / 2;
        if (gap > 1e-6) out.push([y0, y0 + gap, color(0), 0, 1]);
        if (th > 1e-6) out.push([y0 + gap, y0 + gap + th, color(1), 0, 1]);
        if (gap > 1e-6) out.push([y0 + gap + th, y0 + ch, color(0), 0, 1]);
      }
    }
    return out;
  }

  // Fade amount (0 = color, 1 = color2) at u, a position within one repeat (0..1).
  const fadeAt = (peak, u) => (peak ? 1 - Math.abs(2 * u - 1) : u);

  // Gradient stops (offset 0..1 down the stripe, t) for a fade shifted down by `off` of
  // the tile height and wrapped. Built from explicit stops, including a doubled stop for
  // the hard edge of a one-way fade, rather than spreadMethod="repeat", which Illustrator
  // ignores.
  function shiftedStops(peak, off) {
    off = VM.mod(off, 1);
    const u = (v) => VM.mod(v - off, 1);
    const stops = [[0, fadeAt(peak, u(0))]];
    if (peak) {
      // Corners of the triangle wave: the start color at `off`, the end color half a repeat later.
      const corners = [[off, 0], [VM.mod(off + 0.5, 1), 1]].filter(([p]) => p > 0).sort((a, b) => a[0] - b[0]);
      stops.push(...corners);
    } else if (off > 0) {
      stops.push([off, 1], [off, 0]); // hard edge where the fade restarts
    }
    // Value just above the bottom edge (u → 1 when the fade ends exactly there).
    stops.push([1, fadeAt(peak, u(1) || 1)]);
    return stops;
  }

  // ---- pattern fills
  // A pattern stripe holds `pattern`:
  //   { source: 'gen', type, params, palette, aspect, height }  a generative pattern
  //   { source: 'svg', asset, aspect, height }                  imported SVG, art in assets[asset]
  // `aspect` is tile width / height; `height` is the tile height (px) it was designed at.
  // `repeats` is how many tiles fit down the stripe, so the stripe always repeats seamlessly.
  VM.patternRepeats = (s, H) => Math.max(1, Math.round(Number(s.repeats) || Math.round(H / (s.pattern?.height || H)) || 1));

  // Generative renders are cached so dragging other controls doesn't regenerate them.
  const tileCache = new Map();
  // Markup for one pattern tile in the box [0, w] x [0, h] (content may spill outside;
  // callers clip it).
  VM.patternTile = (pattern, assets, w, h) => {
    if (!pattern) return '';
    if (pattern.source === 'svg') {
      const art = assets?.[pattern.asset];
      if (!art) return `<rect width="${VM.n(w)}" height="${VM.n(h)}" fill="#cccccc"/>`;
      return `<svg x="0" y="0" width="${VM.n(w)}" height="${VM.n(h)}" viewBox="${art.viewBox.map(VM.n).join(' ')}" preserveAspectRatio="none" overflow="hidden">${art.markup}</svg>`;
    }
    const gen = VM.GENERATORS?.[pattern.type];
    if (!gen) return '';
    const key = JSON.stringify([pattern.type, pattern.params, pattern.palette, VM.n(w), VM.n(h)]);
    if (!tileCache.has(key)) {
      if (tileCache.size > 60) tileCache.delete(tileCache.keys().next().value);
      const pal = pattern.palette.colors?.length ? pattern.palette : { ...pattern.palette, colors: ['#000000'] };
      tileCache.set(key, `<rect width="${VM.n(w)}" height="${VM.n(h)}" fill="${VM.esc(pal.bg)}"/>` +
        gen.render(w, h, { ...VM.defaultParams(gen), ...pattern.params }, pal));
    }
    return tileCache.get(key);
  };

  // ---- effects
  // Effects reshape solid and gradient stripes (pattern stripes are left as they are).
  // Each declares params like a generator, so the panel can build its controls.
  VM.STRIPE_EFFECTS = {
    glitch: {
      name: 'Glitch slices',
      blurb: 'Random horizontal slices where the stripes jump sideways and/or swap colors. Shifts wrap around the tile, so it still repeats.',
      params: [
        { key: 'slices', label: 'Slices', type: 'int', min: 1, max: 40, default: 6 },
        { key: 'minH', label: 'Thinnest slice (% of height)', type: 'float', min: 0.2, max: 50, step: 0.1, default: 1 },
        { key: 'maxH', label: 'Thickest slice (% of height)', type: 'float', min: 0.2, max: 60, step: 0.1, default: 8 },
        { key: 'shift', label: 'Max sideways jump (% of width)', type: 'float', min: 0, max: 100, step: 1, default: 25 },
        { key: 'recolor', label: 'Swap colors inside slices', type: 'bool', default: false },
        { key: 'seed', label: 'Seed', type: 'seed', default: 1 },
      ],
    },
    ikat: {
      name: 'Ikat edges',
      blurb: 'Feathered, jagged stripe edges like hand-dyed ikat cloth. Narrow stripes can break up into dashes.',
      params: [
        { key: 'amount', label: 'Bleed (px each way)', type: 'float', min: 0.5, max: 60, step: 0.5, default: 5 },
        { key: 'row', label: 'Row height (px)', type: 'float', min: 1, max: 100, step: 0.5, default: 6 },
        { key: 'smooth', label: 'Smoothness (%)', type: 'float', min: 0, max: 100, step: 1, default: 50 },
        { key: 'seed', label: 'Seed', type: 'seed', default: 1 },
      ],
    },
    plaid: {
      name: 'Plaid (cross the stripes)',
      blurb: 'Lays the same stripes horizontally across the vertical ones. The tile becomes square (height = stripe total) so the plaid repeats.',
      params: [
        { key: 'opacity', label: 'Crossing strength (%)', type: 'float', min: 5, max: 100, step: 1, default: 50 },
        { key: 'repeats', label: 'Crossings per tile height', type: 'int', min: 1, max: 6, default: 1 },
      ],
    },
  };
  VM.defaultStripeEffects = () => Object.fromEntries(Object.entries(VM.STRIPE_EFFECTS).map(([k, e]) =>
    [k, { on: false, ...Object.fromEntries(e.params.map((d) => [d.key, d.default])) }]));

  // Tile height when plaid is on: the stripe sequence must fit down the tile exactly.
  VM.plaidHeight = (stripes, fx) => (fx?.plaid?.on ? VM.stripesTotalPx(stripes) * Math.max(1, fx.plaid.repeats || 1) : null);

  // Join row pieces of the same stripe and fill, stacked directly on top of each other, into
  // one stair-stepped outline. Ragged (ikat) or glitched stripes then come out as a few
  // clean shapes instead of many slivers, with no hairline seams between rows.
  function chainRows(rects) {
    const n = VM.n;
    const groups = new Map();
    for (const r of rects) { const k = r.j + '|' + r.fill; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
    const out = [];
    for (const list of groups.values()) {
      list.sort((a, b) => a.y0 - b.y0 || a.x - b.x);
      // Only outlines that end exactly at the current row can grow; older ones are finished.
      const chains = [];
      let active = [], growing = [];
      for (let li = 0; li < list.length; li++) {
        const r = list[li];
        // Continue an outline whose last piece ends where this one starts and overlaps it sideways.
        const k = active.findIndex((ch) => { const l = ch.at(-1); return Math.abs(l.y1 - r.y0) < 1e-6 && r.x < l.x + l.w - 1e-6 && r.x + r.w > l.x + 1e-6; });
        let ch;
        if (k >= 0) { ch = active[k]; active.splice(k, 1); ch.push(r); } else { ch = [r]; chains.push(ch); }
        growing.push(ch);
        // Row finished: what grew this row is what can grow next row.
        if (list[li + 1]?.y0 !== r.y0) { active = growing; growing = []; }
      }
      for (const ch of chains) {
        const { j, fill } = ch[0];
        if (ch.length === 1) {
          const r = ch[0];
          out.push(`<rect data-stripe="${j}" x="${n(r.x)}" y="${n(r.y0)}" width="${n(r.w)}" height="${n(r.y1 - r.y0)}" fill="${fill}"/>`);
          continue;
        }
        // Right side going down, then left side coming back up.
        const pts = [];
        for (const r of ch) pts.push([r.x + r.w, r.y0], [r.x + r.w, r.y1]);
        for (let i = ch.length - 1; i >= 0; i--) pts.push([ch[i].x, ch[i].y1], [ch[i].x, ch[i].y0]);
        // Drop repeated points and points in the middle of straight runs.
        const clean = [];
        for (const p of pts) {
          const l = clean.at(-1);
          if (l && Math.abs(l[0] - p[0]) < 1e-9 && Math.abs(l[1] - p[1]) < 1e-9) continue;
          const l2 = clean.at(-2);
          if (l && l2 && ((Math.abs(l2[0] - l[0]) < 1e-9 && Math.abs(l[0] - p[0]) < 1e-9) || (Math.abs(l2[1] - l[1]) < 1e-9 && Math.abs(l[1] - p[1]) < 1e-9))) clean[clean.length - 1] = p;
          else clean.push(p);
        }
        out.push(`<path data-stripe="${j}" d="${VM.polyPath(clean, true)}" fill="${fill}"/>`);
      }
    }
    return out;
  }

  // Returns the SVG body for a tile of width W and height H. Stripes past maxW are trimmed
  // (no clipping mask); any space left over shows the background.
  // `assets` holds imported SVG art referenced by pattern stripes; `fx` holds effects.
  VM.renderStripes = (stripes, H, assets, maxW = Infinity, fx = {}) => {
    const n = VM.n;
    const total = VM.stripesTotalPx(stripes);
    const Wt = Number.isFinite(maxW) ? maxW : total; // tile width (shifts wrap around this)
    let defs = '';
    const segs = [];
    { let x = 0; stripes.forEach((s, i) => { const w = VM.stripeWidthPx(s); segs.push({ i, s, x0: x, x1: x + w }); x += w; }); }

    // Each solid/gradient stripe's fill as vertical pieces: [[y0, y1, fill], ...] covering 0..H.
    const pieces = segs.map(({ i, s, x0, x1 }) => {
      if (s.kind === 'pattern') return null;
      const c1 = VM.esc(s.color), c2 = VM.esc(s.color2 || s.color);
      const mix = (t) => VM.mixColor(s.color, s.color2 || s.color, t);
      const peak = s.shape === 'peak';
      const steps = Math.max(0, Math.round(Number(s.steps) || 0));
      const off = VM.mod((Number(s.shift) || 0) / 100, 1);
      if (!s.gradient) return [[0, H, c1]];
      const look = VM.gradientLook(s);
      if (look === 'dither' || look === 'halftone' || look === 'lines') {
        const tAt = (y) => fadeAt(peak, VM.mod(y / H - off, 1));
        // Exact end colors at 0 and 1, so pure areas stay the colors you picked.
        const color = (t) => (t <= 0 ? c1 : t >= 1 ? c2 : mix(t));
        return texturePieces(s, look, x1 - x0, H, tAt, color, (Number(s.seed) || 1) * 1009 + i);
      }
      if (look === 'steps' && steps > 0) {
        // Solid horizontal bands, top to bottom. Fade & back samples one full up-and-down
        // cycle per tile, so the bottom band leads straight into the next tile's top band
        // (no doubled band at the seam); an even step count lands exactly on the end color.
        // The shift slides every band down, wrapping; a band crossing the bottom edge is split.
        const out = [];
        for (let k = 0; k < steps; k++) {
          const t = steps === 1 ? 0 : peak ? 1 - Math.abs((2 * k) / steps - 1) : k / (steps - 1);
          const top = VM.mod(off + k / steps, 1), bottom = top + 1 / steps;
          out.push([top * H, Math.min(1, bottom) * H, mix(t)]);
          if (bottom > 1 + 1e-9) out.push([0, (bottom - 1) * H, mix(t)]);
        }
        return out.sort((a, b) => a[0] - b[0]);
      }
      // Smooth gradients use tile coordinates (userSpaceOnUse), so any slice or ragged
      // edge of the stripe still shows the right colors for its height.
      const id = `stripe-grad-${i}`;
      const stops = shiftedStops(peak, off).map(([o, t]) => `<stop offset="${n(o)}" stop-color="${t === 0 ? c1 : t === 1 ? c2 : mix(t)}"/>`).join('');
      defs += `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${n(H)}">${stops}</linearGradient>`;
      return [[0, H, `url(#${id})`]];
    });
    const solidColor = (j) => { const s = segs[j].s; return s.gradient ? VM.mixColor(s.color, s.color2 || s.color, 0.5) : s.color; };

    // Rows: horizontal strips within which every stripe is one straight-sided rectangle.
    const g = fx.glitch?.on ? fx.glitch : null;
    const ik = fx.ikat?.on && fx.ikat.amount > 0 ? fx.ikat : null;
    const cuts = new Set([0, H]);
    const slices = [];
    if (g) {
      const rnd = VM.rng(g.seed);
      const lo = Math.min(g.minH, g.maxH), hi = Math.max(g.minH, g.maxH);
      for (let k = 0; k < g.slices; k++) {
        const y = rnd() * H, h = (H * (lo + rnd() * (hi - lo))) / 100;
        const shift = (rnd() * 2 - 1) * (g.shift / 100) * Wt;
        const recolor = g.recolor ? (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2)) : 0;
        // A slice running off the bottom continues at the top.
        for (const [a, b] of y + h > H ? [[y, H], [0, y + h - H]] : [[y, y + h]]) { slices.push({ a, b, shift, recolor }); cuts.add(a); cuts.add(b); }
      }
    }
    let ikRows = 1, ikNoise = null;
    if (ik) {
      ikRows = Math.max(1, Math.round(H / ik.row));
      for (let r = 1; r < ikRows; r++) cuts.add((r * H) / ikRows);
      ikNoise = VM.noise(ik.seed, Math.max(1, Wt), H, Math.max(2, Math.round(ikRows / 6)), 2);
    }
    const ys = [...cuts].filter((y) => y >= 0 && y <= H).sort((a, b) => a - b);

    const plain = segs.map((sg) => sg.s.kind !== 'pattern');
    const nS = segs.length;
    const seamless = total >= Wt - 1e-6; // last stripe edge is the tile edge (wraps to x = 0)
    // Per-boundary, per-row random in [-1, 1] (seeded), for the jagged part of ikat.
    const hash = (j, r) => { const v = Math.sin((j + 1) * 127.1 + (r + 1) * 311.7 + (ik?.seed || 0) * 74.7) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; };

    const open = new Map(); // merge identical rects that continue straight down
    const rects = [], dots = [];
    const emit = (j, x, w, y0, y1, fill) => {
      if (w <= 1e-6 || y1 - y0 <= 1e-9) return;
      const key = `${j}|${n(x)}|${n(w)}|${fill}`;
      const prev = open.get(key);
      if (prev && Math.abs(prev.y1 - y0) < 1e-6) { prev.y1 = y1; return; }
      const r = { j, x, w, y0, y1, fill };
      open.set(key, r); rects.push(r);
    };

    for (let ri = 0; ri + 1 < ys.length; ri++) {
      const y0 = ys[ri], y1 = ys[ri + 1], mid = (y0 + y1) / 2;
      let shift = 0, recolor = 0;
      for (const sl of slices) if (mid > sl.a && mid < sl.b) { shift += sl.shift; recolor += sl.recolor; }
      // Stripe edges for this row, nudged for ikat and kept in order.
      const r = Math.min(ikRows - 1, Math.floor((mid / H) * ikRows));
      const edges = [];
      for (let j = 0; j <= nS; j++) {
        let x = Math.min(j < nS ? segs[j].x0 : total, Wt);
        // Nudge every edge except one trimmed at the tile's right side. When the stripes
        // fill the tile, the last edge reuses edge 0's nudge so the ragged edge wraps.
        if (ik && (x < Wt - 1e-9 || (seamless && j === nS))) {
          const jj = seamless && j === nS ? 0 : j;
          const bx = jj < nS ? segs[jj].x0 : total;
          const yc = ((r + 0.5) * H) / ikRows, wv = ik.smooth / 100;
          x += ik.amount * (wv * ikNoise(bx * 7.3, yc) + (1 - wv) * hash(jj, r));
        }
        edges.push(j > 0 ? Math.max(x, edges[j - 1]) : x);
      }
      // Keep every edge within one tile width of the first, so a strong bleed can't push
      // stripes past the point where the repeat wraps around (which would overlap).
      const cap = edges[0] + Wt;
      for (let j = 1; j <= nS; j++) edges[j] = Math.min(edges[j], cap);
      for (let j = 0; j < nS; j++) {
        if (!plain[j]) continue;
        // Recolored slices borrow a neighboring stripe's fill (skipping pattern stripes).
        let src = j;
        if (recolor) { src = VM.mod(j + recolor, nS); if (!plain[src]) src = j; }
        let a = edges[j], b = edges[j + 1];
        if (b <= a) continue;
        a += shift; b += shift;
        for (const [ya, yb, fill, fa = 0, fb = 1, dot = 0] of pieces[src]) {
          const t0 = Math.max(y0, ya), t1 = Math.min(y1, yb);
          if (t1 <= t0) continue;
          // The piece's share of this row's (shifted, nudged) span.
          const pa = a + fa * (b - a), pb = a + fb * (b - a);
          if (dot) {
            // Halftone dot: drawn once, from the row holding its center.
            const cy = (ya + yb) / 2;
            if (cy < y0 || cy >= y1) continue;
            const rx = (pb - pa) * dot, ry = (yb - ya) * dot;
            dots.push(`<ellipse data-stripe="${segs[j].i}" cx="${n(VM.mod((pa + pb) / 2, Wt))}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}"/>`);
            continue;
          }
          // Wrap the span around the tile width.
          const k0 = Math.floor(pa / Wt), k1 = Math.floor((pb - 1e-9) / Wt);
          for (let k = k0; k <= k1; k++) {
            const xa = Math.max(pa, k * Wt) - k * Wt, xb = Math.min(pb, (k + 1) * Wt) - k * Wt;
            emit(segs[j].i, xa, xb - xa, t0, t1, fill);
          }
        }
      }
    }
    let body = chainRows(rects).join('') + dots.join('');

    // Pattern stripes: draw the tile once, then place clipped copies across the stripe and
    // k times down it.
    for (const { i, s, x0, x1 } of segs) {
      if (s.kind !== 'pattern') continue;
      const x = x0, w = Math.min(x1, Wt) - x0;
      if (w <= 0) continue;
      const k = VM.patternRepeats(s, H);
      const th = H / k, tw = th * (s.pattern?.aspect || 1);
      defs += `<g id="stripe-pat-${i}">${VM.patternTile(s.pattern, assets, tw, th)}</g>` +
        // Each copy's clip overlaps its neighbors by a hair. The pattern repeats exactly, so
        // the overlap shows identical content and just hides anti-aliasing seams.
        `<clipPath id="stripe-pat-tile-${i}"><rect x="-0.25" y="-0.25" width="${n(tw + 0.5)}" height="${n(th + 0.5)}"/></clipPath>` +
        `<clipPath id="stripe-pat-clip-${i}"><rect x="${n(x)}" y="0" width="${n(w)}" height="${n(H)}"/></clipPath>`;
      let copies = '';
      for (let c = 0; c * tw < w - 1e-6; c++) {
        for (let r = 0; r < k; r++) {
          copies += `<g transform="translate(${n(x + c * tw)} ${n(r * th)})" clip-path="url(#stripe-pat-tile-${i})"><use xlink:href="#stripe-pat-${i}"/></g>`;
        }
      }
      // A solid strip of the pattern's background behind the copies hides the hairline
      // anti-aliasing gaps that viewers draw where clipped copies meet.
      const under = s.pattern?.source === 'gen' && s.pattern.palette?.bg
        ? `<rect x="${n(x)}" y="0" width="${n(w)}" height="${n(H)}" fill="${VM.esc(s.pattern.palette.bg)}"/>` : '';
      body += `<g data-stripe="${i}" clip-path="url(#stripe-pat-clip-${i})">${under}${copies}</g>`;
    }

    // Plaid: the same sequence laid horizontally on top, partly see-through.
    if (fx.plaid?.on && total > 0) {
      const reps = Math.max(1, Math.round(H / total));
      const op = n(Math.min(1, Math.max(0, fx.plaid.opacity / 100)));
      for (let rep = 0; rep < reps; rep++) {
        segs.forEach(({ s, x0, x1 }, j) => {
          if (!plain[j] || x1 <= x0) return;
          body += `<rect x="0" y="${n(rep * total + x0)}" width="${n(Wt)}" height="${n(x1 - x0)}" fill="${VM.esc(solidColor(j))}" opacity="${op}"/>`;
        });
      }
    }
    return (defs ? `<defs>${defs}</defs>` : '') + body;
  };
})(window.VM);
