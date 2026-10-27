// Generative pattern library. Every generator draws into a W x H tile and guarantees the
// tile repeats seamlessly: periodic functions use integer frequencies over the tile, grids
// divide the tile exactly, and anything crossing an edge is redrawn on the opposite edge.
//
// Each generator declares `params` (used to build the UI automatically) and a
// `render(W, H, p, palette)` returning SVG markup. palette = { bg, colors: [...] }.
(function (VM) {
  const TAU = Math.PI * 2;
  const color = (palette, i) => palette.colors[((i % palette.colors.length) + palette.colors.length) % palette.colors.length];
  const seedParam = { key: 'seed', label: 'Seed', type: 'seed', default: 1 };

  // ---------------------------------------------------------------- Truchet tiles
  const truchet = {
    name: 'Truchet tiles',
    blurb: 'A grid of randomly rotated tiles whose lines meet at every edge, forming endless mazes and loops.',
    params: [
      { key: 'style', label: 'Style', type: 'select', options: ['arcs', 'diagonals', 'triangles', 'arcs + dots'], default: 'arcs' },
      { key: 'cols', label: 'Columns', type: 'int', min: 1, max: 60, default: 8 },
      { key: 'rows', label: 'Rows', type: 'int', min: 1, max: 60, default: 8 },
      { key: 'stroke', label: 'Line weight (% of cell)', type: 'float', min: 1, max: 60, step: 1, default: 12 },
      { key: 'multicolor', label: 'Color each tile randomly', type: 'bool', default: false },
      seedParam,
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      const cw = W / p.cols, ch = H / p.rows;
      const sw = (Math.min(cw, ch) * p.stroke) / 100;
      const rx = cw / 2, ry = ch / 2;
      const n = VM.n;
      let out = '';
      for (let j = 0; j < p.rows; j++) {
        for (let i = 0; i < p.cols; i++) {
          const x = i * cw, y = j * ch;
          const flip = rnd() < 0.5;
          const c = p.multicolor ? pal.colors[Math.floor(rnd() * pal.colors.length)] : pal.colors[0];
          if (p.style === 'arcs' || p.style === 'arcs + dots') {
            // Two quarter-ellipse arcs centered on opposite corners; endpoints sit on edge midpoints.
            const d = flip
              ? `M${n(x + rx)} ${n(y)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y + ry)}` +
                `M${n(x + cw)} ${n(y + ry)}A${n(rx)} ${n(ry)} 0 0 0 ${n(x + rx)} ${n(y + ch)}`
              : `M${n(x + cw)} ${n(y + ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x + rx)} ${n(y)}` +
                `M${n(x)} ${n(y + ry)}A${n(rx)} ${n(ry)} 0 0 1 ${n(x + rx)} ${n(y + ch)}`;
            out += `<path d="${d}" fill="none" stroke="${c}" stroke-width="${n(sw)}"/>`;
            if (p.style === 'arcs + dots') {
              // Dots on cell corners; corner dots are shared by 4 cells so draw them wrapped once per cell.
              const r = sw * 0.9;
              out += VM.wrap(W, H, { x0: x - r, y0: y - r, x1: x + r, y1: y + r },
                `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${color(pal, 1)}"/>`);
            }
          } else if (p.style === 'diagonals') {
            const d = flip ? `M${n(x)} ${n(y)}L${n(x + cw)} ${n(y + ch)}` : `M${n(x + cw)} ${n(y)}L${n(x)} ${n(y + ch)}`;
            // Square caps extend past the corner; wrap so the overhang continues across tile edges.
            out += VM.wrap(W, H, { x0: x - sw, y0: y - sw, x1: x + cw + sw, y1: y + ch + sw },
              `<path d="${d}" stroke="${c}" stroke-width="${n(sw)}" stroke-linecap="square"/>`);
          } else {
            // triangles: fill one of four half-cell triangles
            const corners = [[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]];
            const k = Math.floor(rnd() * 4);
            const tri = [corners[k], corners[(k + 1) % 4], corners[(k + 2) % 4]];
            out += `<path d="${VM.polyPath(tri, true)}" fill="${c}"/>`;
          }
        }
      }
      return out;
    },
  };

  // ------------------------------------------------- Interference contours (topographic)
  // Sum of plane waves cos(2π(kx·u + ky·v) + φ) with integer kx, ky, so the field is exactly
  // periodic over the tile. Contour lines are traced with marching squares.
  const contours = {
    name: 'Contour lines (topographic)',
    blurb: 'Contour lines of a smooth landscape, for a topographic or moiré look. The landscape comes from interfering waves, tileable Perlin noise, or domain-warped noise (marbled swirls).',
    params: [
      { key: 'field', label: 'Landscape', type: 'select', options: ['waves', 'noise', 'warped noise'], default: 'waves' },
      { key: 'waves', label: 'Waves / noise octaves', type: 'int', min: 1, max: 8, default: 4 },
      { key: 'freq', label: 'Frequency / noise scale', type: 'int', min: 1, max: 8, default: 3 },
      { key: 'warp', label: 'Warp strength (warped noise)', type: 'float', min: 0, max: 3, step: 0.05, default: 0.8 },
      { key: 'levels', label: 'Contour levels', type: 'int', min: 1, max: 40, default: 10 },
      { key: 'stroke', label: 'Line weight (px)', type: 'float', min: 0.25, max: 20, step: 0.25, default: 2 },
      { key: 'res', label: 'Smoothness (grid cells)', type: 'int', min: 30, max: 400, default: 160 },
      seedParam,
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      const waves = [];
      for (let i = 0; i < p.waves; i++) {
        let kx = 0, ky = 0;
        while (kx === 0 && ky === 0) { kx = rnd.int(-p.freq, p.freq); ky = rnd.int(-p.freq, p.freq); }
        waves.push({ kx, ky, phase: rnd() * TAU, amp: rnd.range(0.5, 1) });
      }
      // All three landscapes are periodic over the tile; u, v are tile fractions.
      let sample;
      if (p.field === 'waves') {
        sample = (u, v) => { let f = 0; for (const w of waves) f += w.amp * Math.cos(TAU * (w.kx * u + w.ky * v) + w.phase); return f; };
      } else {
        const octaves = Math.min(p.waves, 6);
        const base = VM.noise(p.seed, W, H, p.freq, octaves);
        if (p.field === 'noise') {
          sample = (u, v) => base(u * W, v * H);
        } else {
          const qx = VM.noise(p.seed + 1, W, H, p.freq, octaves), qy = VM.noise(p.seed + 2, W, H, p.freq, octaves);
          const k = (p.warp * Math.min(W, H)) / p.freq;
          sample = (u, v) => { const x = u * W, y = v * H; return base(x + k * qx(x, y), y + k * qy(x, y)); };
        }
      }
      // Grid resolution on each axis, roughly square cells.
      const nx = Math.max(8, Math.round(p.res * (W >= H ? 1 : W / H)));
      const ny = Math.max(8, Math.round(p.res * (H >= W ? 1 : H / W)));
      const field = new Float64Array((nx + 1) * (ny + 1));
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          // Sample with wrapped indices so the last row/column equal the first exactly.
          const u = (i % nx) / nx, v = (j % ny) / ny;
          const f = sample(u, v);
          field[j * (nx + 1) + i] = f;
          if (f < lo) lo = f; if (f > hi) hi = f;
        }
      }
      let out = '';
      for (let l = 0; l < p.levels; l++) {
        const t = lo + ((l + 0.5) / p.levels) * (hi - lo);
        const lines = marchingSquares(field, nx, ny, t, W / nx, H / ny);
        if (!lines.length) continue;
        const d = lines.map((ln) => VM.polyPath(ln.pts, ln.closed)).join('');
        out += `<path d="${d}" fill="none" stroke="${color(pal, l)}" stroke-width="${VM.n(p.stroke)}" stroke-linejoin="round"/>`;
      }
      return out;
    },
  };

  // Marching squares, returning chained polylines. Edges on the tile border are kept
  // distinct (no wrap-around chaining) so lines end exactly at the border, where they
  // line up with their continuation in the next repeat.
  function marchingSquares(field, nx, ny, t, sx, sy) {
    const stride = nx + 1;
    const val = (i, j) => field[j * stride + i];
    const pts = new Map(); // edge key -> [x, y]
    const edgePoint = (key, x0, y0, v0, x1, y1, v1) => {
      if (!pts.has(key)) {
        const a = (t - v0) / (v1 - v0);
        pts.set(key, [(x0 + a * (x1 - x0)) * sx, (y0 + a * (y1 - y0)) * sy]);
      }
      return key;
    };
    // Segment table keyed by case index (tl=8, tr=4, br=2, bl=1). Edges: T R B L.
    const TABLE = {
      1: [['L', 'B']], 2: [['B', 'R']], 3: [['L', 'R']], 4: [['T', 'R']], 6: [['T', 'B']],
      7: [['L', 'T']], 8: [['L', 'T']], 9: [['T', 'B']], 11: [['T', 'R']], 12: [['L', 'R']],
      13: [['B', 'R']], 14: [['L', 'B']],
    };
    const segs = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1);
        const idx = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const E = {
          T: () => edgePoint(`h${i},${j}`, i, j, a, i + 1, j, b),
          B: () => edgePoint(`h${i},${j + 1}`, i, j + 1, d, i + 1, j + 1, c),
          L: () => edgePoint(`v${i},${j}`, i, j, a, i, j + 1, d),
          R: () => edgePoint(`v${i + 1},${j}`, i + 1, j, b, i + 1, j + 1, c),
        };
        let pairs = TABLE[idx];
        if (idx === 5 || idx === 10) {
          // Saddle: disambiguate using the cell-center average.
          const centerHigh = (a + b + c + d) / 4 > t;
          pairs = (idx === 5) === centerHigh ? [['L', 'T'], ['B', 'R']] : [['L', 'B'], ['T', 'R']];
        }
        for (const [e0, e1] of pairs) segs.push([E[e0](), E[e1]()]);
      }
    }
    // Chain segments sharing endpoints into polylines.
    const ends = new Map();
    segs.forEach(([k0, k1], s) => {
      (ends.get(k0) || ends.set(k0, []).get(k0)).push(s);
      (ends.get(k1) || ends.set(k1, []).get(k1)).push(s);
    });
    const used = new Uint8Array(segs.length);
    const walk = (key) => {
      const keys = [];
      for (;;) {
        const s = (ends.get(key) || []).find((s) => !used[s]);
        if (s === undefined) return keys;
        used[s] = 1;
        key = segs[s][0] === key ? segs[s][1] : segs[s][0];
        keys.push(key);
      }
    };
    const lines = [];
    for (let s = 0; s < segs.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const [k0, k1] = segs[s];
      const fwd = walk(k1);
      const back = walk(k0);
      const keys = [...back.reverse(), k0, k1, ...fwd];
      const closed = keys.length > 3 && keys[0] === keys[keys.length - 1];
      if (closed) keys.pop();
      lines.push({ pts: keys.map((k) => pts.get(k)), closed });
    }
    return lines;
  }

  // ------------------------------------------------------- Spirograph rosettes
  const CURVES = {
    // Hypotrochoid: the classic Spirograph curve.
    spirograph(p) {
      const R = p.a, r = p.b, d = p.c;
      const turns = r / VM.gcd(R, r);
      const N = Math.min(6000, 200 * turns + 200);
      const pts = [];
      for (let s = 0; s < N; s++) {
        const t = (s / N) * TAU * turns;
        pts.push([(R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t), (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)]);
      }
      return pts;
    },
    // Rose curve r = cos(k θ) with k = a / b.
    rose(p) {
      const n = p.a, d = p.b;
      const g = VM.gcd(n, d), nn = n / g, dd = d / g;
      const span = (nn * dd) % 2 ? Math.PI * dd : TAU * dd;
      const N = Math.min(6000, 300 * dd + 200);
      const pts = [];
      for (let s = 0; s < N; s++) {
        const th = (s / N) * span;
        const r = Math.cos((nn / dd) * th);
        pts.push([r * Math.cos(th), r * Math.sin(th)]);
      }
      return pts;
    },
    // Lissajous figure.
    lissajous(p) {
      const N = 1200;
      const pts = [];
      for (let s = 0; s < N; s++) {
        const t = (s / N) * TAU;
        pts.push([Math.sin(p.a * t + (p.c * Math.PI) / 8), Math.sin(p.b * t)]);
      }
      return pts;
    },
  };

  const rosettes = {
    name: 'Spirograph rosettes',
    blurb: 'Spirograph, rose, and Lissajous curves on a repeating grid, for medallion-style motifs. Use an even row count for brick, even column count for half-drop.',
    params: [
      { key: 'curve', label: 'Curve', type: 'select', options: ['spirograph', 'rose', 'lissajous'], default: 'spirograph' },
      { key: 'a', label: 'A (outer ring / petals / x-freq)', type: 'int', min: 1, max: 24, default: 7 },
      { key: 'b', label: 'B (inner ring / divisor / y-freq)', type: 'int', min: 1, max: 24, default: 3 },
      { key: 'c', label: 'C (pen offset / – / phase)', type: 'int', min: 0, max: 24, default: 5 },
      { key: 'layout', label: 'Layout', type: 'select', options: ['grid', 'half-drop', 'brick'], default: 'half-drop' },
      { key: 'cols', label: 'Columns', type: 'int', min: 1, max: 20, default: 4 },
      { key: 'rows', label: 'Rows', type: 'int', min: 1, max: 20, default: 4 },
      { key: 'size', label: 'Motif size (% of cell)', type: 'float', min: 10, max: 200, step: 1, default: 85 },
      { key: 'layers', label: 'Nested layers', type: 'int', min: 1, max: 6, default: 2 },
      { key: 'twist', label: 'Layer twist (°)', type: 'float', min: 0, max: 180, step: 1, default: 15 },
      { key: 'stroke', label: 'Line weight (px)', type: 'float', min: 0.25, max: 20, step: 0.25, default: 1.5 },
    ],
    render(W, H, p, pal) {
      const raw = CURVES[p.curve](p);
      // Normalize the motif into a unit circle.
      let maxR = 0;
      for (const [x, y] of raw) maxR = Math.max(maxR, Math.hypot(x, y));
      const unit = raw.map(([x, y]) => [x / (maxR || 1), y / (maxR || 1)]);

      const cw = W / p.cols, ch = H / p.rows;
      const radius = (Math.min(cw, ch) / 2) * (p.size / 100);
      const centers = [];
      for (let j = 0; j < p.rows; j++) {
        for (let i = 0; i < p.cols; i++) {
          let x = (i + 0.5) * cw, y = (j + 0.5) * ch;
          // Offsets of half a cell keep the layout periodic over the tile; the wrap below
          // takes care of motifs pushed over the edge.
          if (p.layout === 'brick' && j % 2) x += cw / 2;
          if (p.layout === 'half-drop' && i % 2) y += ch / 2;
          centers.push([x, y]);
        }
      }
      let out = '';
      for (let L = 0; L < p.layers; L++) {
        const scale = radius * (1 - L / (p.layers + 0.5));
        const rot = (L * p.twist * Math.PI) / 180;
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const shape = unit.map(([x, y]) => [(x * cos - y * sin) * scale, (x * sin + y * cos) * scale]);
        const pad = p.stroke;
        for (const [cx, cy] of centers) {
          const pts = shape.map(([x, y]) => [x + cx, y + cy]);
          out += VM.wrap(W, H, VM.boxOf(pts, pad),
            `<path d="${VM.polyPath(pts, true)}" fill="none" stroke="${color(pal, L)}" stroke-width="${VM.n(p.stroke)}" stroke-linejoin="round"/>`);
        }
      }
      return out;
    },
  };

  // ---------------------------------------------------------------- Wave bands
  const WAVE_SHAPES = {
    sine: (t) => Math.sin(TAU * t),
    zigzag: (t) => 1 - 4 * Math.abs((((t + 0.25) % 1) + 1) % 1 - 0.5),
    scallop: (t) => 1 - 2 * Math.abs(Math.sin(Math.PI * t)),
    square: (t) => Math.tanh(6 * Math.sin(TAU * t)),
  };

  const waves = {
    name: 'Wave bands',
    blurb: 'Filled bands bounded by periodic waves: sine, zigzag/chevron, scallop, or soft square.',
    params: [
      { key: 'shape', label: 'Wave shape', type: 'select', options: Object.keys(WAVE_SHAPES), default: 'zigzag' },
      { key: 'direction', label: 'Bands run', type: 'select', options: ['horizontal', 'vertical'], default: 'horizontal' },
      { key: 'bands', label: 'Bands per tile', type: 'int', min: 1, max: 60, default: 6 },
      { key: 'freq', label: 'Waves across tile', type: 'int', min: 1, max: 40, default: 4 },
      { key: 'amp', label: 'Amplitude (% of band)', type: 'float', min: 0, max: 300, step: 1, default: 60 },
      { key: 'drift', label: 'Phase drift (waves per tile)', type: 'int', min: -10, max: 10, default: 0 },
    ],
    render(W, H, p, pal) {
      const vertical = p.direction === 'vertical';
      // Work in (along, across) coordinates, then swap for vertical bands.
      const L = vertical ? H : W, A = vertical ? W : H;
      const f = WAVE_SHAPES[p.shape];
      const bandH = A / p.bands;
      const amp = (bandH * p.amp) / 200;
      const samples = Math.max(64, 48 * p.freq);
      // Boundary k sits at k*bandH and is shifted by k*drift/bands of a wave, so boundary
      // `bands` equals boundary 0 moved down one tile: the seam matches.
      const curve = (k) => {
        const off = (k * p.drift) / p.bands;
        let us; // positions along the tile, 0..1
        if (p.shape === 'zigzag') {
          // Sample exactly at the zigzag corners (every quarter wave) so points stay sharp.
          us = [0, 1];
          for (let m = Math.ceil(4 * off); m <= Math.floor(4 * (p.freq + off)); m++) {
            const u = (m / 4 - off) / p.freq;
            if (u > 0 && u < 1) us.push(u);
          }
          us.sort((a, b) => a - b);
        } else {
          us = Array.from({ length: samples + 1 }, (_, s) => s / samples);
        }
        return us.map((u) => [u * L, k * bandH + amp * f(u * p.freq + off)]);
      };
      const tf = vertical ? ([x, y]) => [y, x] : (pt) => pt;
      let out = '';
      for (let k = 0; k < p.bands; k++) {
        const pts = [...curve(k), ...curve(k + 1).reverse()].map(tf);
        out += VM.wrap(W, H, VM.boxOf(pts), `<path d="${VM.polyPath(pts, true)}" fill="${color(pal, k)}"/>`);
      }
      return out;
    },
  };

  // ---------------------------------------------------------------- Scattered motifs
  const MOTIFS = {
    star: (r, n) => starPts(r, r * 0.42, n),
    sparkle: (r) => starPts(r, r * 0.18, 4),
    diamond: (r) => [[0, -r], [r * 0.6, 0], [0, r], [-r * 0.6, 0]],
    dot: null,
  };
  function starPts(R, r, n) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n - Math.PI / 2;
      const rad = i % 2 ? r : R;
      pts.push([rad * Math.cos(a), rad * Math.sin(a)]);
    }
    return pts;
  }

  const scatter = {
    name: 'Scattered motifs',
    blurb: 'Stars, sparkles, diamonds, or dots spread evenly (Poisson-disk on a torus) so the spacing holds across seams.',
    params: [
      { key: 'motif', label: 'Motif', type: 'select', options: Object.keys(MOTIFS), default: 'star' },
      { key: 'points', label: 'Star points', type: 'int', min: 3, max: 12, default: 5 },
      { key: 'spacing', label: 'Min spacing (% of tile)', type: 'float', min: 2, max: 50, step: 0.5, default: 12 },
      { key: 'size', label: 'Size (% of spacing)', type: 'float', min: 5, max: 100, step: 1, default: 35 },
      { key: 'jitter', label: 'Size variation (%)', type: 'float', min: 0, max: 90, step: 1, default: 25 },
      { key: 'rotate', label: 'Random rotation', type: 'bool', default: true },
      seedParam,
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      const minD = (Math.min(W, H) * p.spacing) / 100;
      // Dart throwing with toroidal distance: points near opposite edges respect spacing too.
      // A toroidal grid with cells >= minD means only the 3x3 neighborhood needs checking.
      const gx = Math.max(1, Math.floor(W / minD)), gy = Math.max(1, Math.floor(H / minD));
      const grid = Array.from({ length: gx * gy }, () => []);
      const pts = [];
      let misses = 0;
      while (misses < 3000 && pts.length < 5000) {
        const x = rnd() * W, y = rnd() * H;
        const ci = Math.min(gx - 1, Math.floor((x / W) * gx)), cj = Math.min(gy - 1, Math.floor((y / H) * gy));
        let ok = true;
        for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1 && ok; di++) {
          for (const [px, py] of grid[VM.mod(cj + dj, gy) * gx + VM.mod(ci + di, gx)]) {
            if (VM.torusDist2(x, y, px, py, W, H) < minD * minD) { ok = false; break; }
          }
        }
        if (ok) { pts.push([x, y]); grid[cj * gx + ci].push([x, y]); misses = 0; } else misses++;
      }
      let out = '';
      for (const [cx, cy] of pts) {
        const r = (minD * p.size) / 100 * (1 - (p.jitter / 100) * rnd());
        const c = pal.colors[Math.floor(rnd() * pal.colors.length)];
        const rot = p.rotate ? rnd() * TAU : 0;
        const box = { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
        if (p.motif === 'dot') {
          out += VM.wrap(W, H, box, `<circle cx="${VM.n(cx)}" cy="${VM.n(cy)}" r="${VM.n(r)}" fill="${c}"/>`);
          continue;
        }
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const shape = MOTIFS[p.motif](r, p.points).map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
        out += VM.wrap(W, H, box, `<path d="${VM.polyPath(shape, true)}" fill="${c}"/>`);
      }
      return out;
    },
  };

  VM.GENERATORS = { truchet, contours, rosettes, waves, scatter };

  VM.defaultParams = (gen) => Object.fromEntries(gen.params.map((p) => [p.key, p.default]));
})(window.VM);
