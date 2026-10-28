// Camouflage. Most camo is a stack of color layers, each covering the areas where a
// tileable noise field rises above a threshold. Styles differ in how the layers are drawn:
// smooth blobs, stretched stripes, snapped pixels, angular splinters, or scattered flecks.
//
// Blob outlines come from marching squares on a grid that extends a few cells past the
// tile, with the outer ring forced "low" so every outline closes into a loop. The grid is
// aligned to the tile's period, so the outlines inside the tile match the neighbor tiles
// exactly; whatever spills into the margin is clipped away.
(function (VM) {
  const n = VM.n;
  const seedParam = { key: 'seed', label: 'Seed', type: 'seed', default: 1 };
  const BLOBS = ['woodland', 'tiger stripe', 'splinter', 'flecktarn', 'chocolate chip'];

  // Recommended settings loaded whenever the style changes.
  const PRESETS = {
    'woodland': { scale: 3, detail: 3, stretch: 1.6, warp: 0.7, coverage: 40, smooth: 2, res: 120 },
    'tiger stripe': { scale: 2, detail: 4, stretch: 4, warp: 0.5, coverage: 26, smooth: 2, res: 200 },
    'digital': { scale: 3, detail: 4, stretch: 1.4, warp: 0.5, coverage: 38, pixel: 1 },
    'splinter': { scale: 3, detail: 2, stretch: 1.3, warp: 0, coverage: 38, smooth: 0, res: 9, rain: true },
    'flecktarn': { scale: 3, detail: 3, stretch: 1.2, warp: 0.4, coverage: 45, smooth: 2, res: 100, fleckSize: 2.2, density: 30 },
    'chocolate chip': { scale: 2, detail: 3, stretch: 1.4, warp: 0.7, coverage: 42, smooth: 2, res: 110, fleckSize: 2.6, density: 14 },
  };

  const camo = {
    name: 'Camouflage',
    blurb: 'Layered camo built from tileable noise. Each ink color is one layer, painted in order over the background, so reorder or add inks to change the look. Picking a style loads recommended settings.',
    params: [
      { key: 'style', label: 'Style', type: 'select', options: Object.keys(PRESETS), default: 'woodland', presets: PRESETS },
      { key: 'scale', label: 'Pattern scale (bigger = smaller blobs)', type: 'int', min: 1, max: 10, default: 3 },
      { key: 'detail', label: 'Edge detail (octaves)', type: 'int', min: 1, max: 6, default: 3 },
      { key: 'stretch', label: 'Horizontal stretch', type: 'float', min: 0.25, max: 8, step: 0.05, default: 1.6 },
      { key: 'warp', label: 'Organic warp', type: 'float', min: 0, max: 2, step: 0.05, default: 0.7 },
      { key: 'coverage', label: 'Coverage per layer (%)', type: 'float', min: 5, max: 90, step: 1, default: 40 },
      { key: 'smooth', label: 'Edge smoothing', type: 'int', min: 0, max: 4, default: 2, when: { style: BLOBS } },
      { key: 'res', label: 'Shape resolution', type: 'int', min: 8, max: 300, default: 120, when: { style: BLOBS } },
      { key: 'pixel', label: 'Pixel size (% of tile)', type: 'float', min: 0.25, max: 10, step: 0.05, default: 1.2, when: { style: ['digital'] } },
      { key: 'rain', label: 'Rain streaks (last ink)', type: 'bool', default: true, when: { style: ['splinter'] } },
      { key: 'fleckSize', label: 'Fleck / chip size (% of tile)', type: 'float', min: 0.3, max: 6, step: 0.05, default: 1.4, when: { style: ['flecktarn', 'chocolate chip'] } },
      { key: 'density', label: 'Fleck / chip density', type: 'float', min: 1, max: 100, step: 1, default: 60, when: { style: ['flecktarn', 'chocolate chip'] } },
      seedParam,
    ],
    render(W, H, p, pal) {
      const inks = pal.colors;
      const S = Math.min(W, H);
      // A layer's field: stretched, optionally domain-warped noise. Periodic over the tile.
      const field = (k) => {
        const base = VM.noise(p.seed * 31 + k, W, H, p.scale, p.detail, p.stretch);
        if (!p.warp) return base;
        const wx = VM.noise(p.seed * 31 + k + 101, W, H, p.scale, 2, p.stretch);
        const wy = VM.noise(p.seed * 31 + k + 202, W, H, p.scale, 2, p.stretch);
        const amt = (p.warp * S) / (4 * p.scale);
        return (x, y) => base(x + amt * wx(x, y), y + amt * wy(x, y));
      };

      if (p.style === 'digital') return digital(W, H, p, inks, field);

      // How many inks become blob layers; the rest are reserved for flecks, chips, or rain.
      let blobLayers = inks.length;
      if (p.style === 'splinter' && p.rain && inks.length > 1) blobLayers -= 1;
      if (p.style === 'flecktarn') blobLayers = Math.min(1, inks.length);
      if (p.style === 'chocolate chip') blobLayers = Math.max(1, inks.length - 2);

      let out = '';
      for (let k = 0; k < blobLayers; k++) out += blobLayer(W, H, field(k), p.coverage / 100, p.res, p.smooth, inks[k]);

      if (p.style === 'splinter' && p.rain && inks.length > 1) out += rain(W, H, p, inks[inks.length - 1]);
      if (p.style === 'flecktarn') {
        for (let k = 1; k < inks.length; k++) out += flecks(W, H, p, field(k), inks[k], k);
      }
      if (p.style === 'chocolate chip' && inks.length >= 2) {
        out += chips(W, H, p, inks[inks.length - 1], inks.length >= 3 ? inks[inks.length - 2] : pal.bg);
      }
      return out;
    },
  };

  // Value such that `frac` of the samples lie above it.
  function threshold(values, frac) {
    const sorted = Float64Array.from(values).sort();
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((1 - frac) * sorted.length)))];
  }

  // Closed-loop Chaikin corner cutting: rounds blob outlines.
  function chaikin(pts, passes) {
    for (let k = 0; k < passes; k++) {
      const next = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
      }
      pts = next;
    }
    return pts;
  }

  function blobLayer(W, H, f, coverage, res, smooth, fill) {
    const nx = Math.max(4, Math.round(res * (W >= H ? 1 : W / H)));
    const ny = Math.max(4, Math.round(res * (H >= W ? 1 : H / W)));
    const cx = W / nx, cy = H / ny;
    const pad = 4 + smooth; // margin cells, enough that smoothing never reaches inside the tile
    const gx = nx + 2 * pad, gy = ny + 2 * pad;
    const grid = new Float64Array((gx + 1) * (gy + 1));
    const inside = [];
    for (let j = 0; j <= gy; j++) {
      for (let i = 0; i <= gx; i++) {
        const v = f((i - pad) * cx, (j - pad) * cy);
        grid[j * (gx + 1) + i] = v;
        if (i >= pad && i < pad + nx && j >= pad && j < pad + ny) inside.push(v);
      }
    }
    const t = threshold(inside, coverage);
    // Force the outer ring low so every outline closes.
    for (let i = 0; i <= gx; i++) { grid[i] = t - 1e3; grid[gy * (gx + 1) + i] = t - 1e3; }
    for (let j = 0; j <= gy; j++) { grid[j * (gx + 1)] = t - 1e3; grid[j * (gx + 1) + gx] = t - 1e3; }
    const loops = VM.marchingSquares(grid, gx, gy, t, cx, cy);
    let d = '';
    for (const { pts } of loops) {
      if (pts.length < 3) continue;
      const shifted = pts.map(([x, y]) => [x - pad * cx, y - pad * cy]);
      d += VM.polyPath(smooth ? chaikin(shifted, smooth) : shifted, true);
    }
    return d ? `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>` : '';
  }

  // Pixel camo: each grid cell takes the color of the topmost layer present at its center.
  function digital(W, H, p, inks, field) {
    const S = Math.min(W, H);
    const cols = Math.max(2, Math.round(W / ((S * p.pixel) / 100)));
    const rows = Math.max(2, Math.round(H / ((S * p.pixel) / 100)));
    const pw = W / cols, ph = H / rows;
    const cell = new Int16Array(cols * rows).fill(-1);
    inks.forEach((_, k) => {
      const f = field(k);
      const vals = new Float64Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) vals[j * cols + i] = f((i + 0.5) * pw, (j + 0.5) * ph);
      const t = threshold(vals, p.coverage / 100);
      vals.forEach((v, idx) => { if (v > t) cell[idx] = k; });
    });
    let out = '';
    inks.forEach((ink, k) => {
      let d = '';
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (cell[j * cols + i] !== k) continue;
          let e = i; while (e + 1 < cols && cell[j * cols + e + 1] === k) e++;
          d += `M${n(i * pw)} ${n(j * ph)}H${n((e + 1) * pw)}V${n((j + 1) * ph)}H${n(i * pw)}Z`;
          i = e;
        }
      }
      if (d) out += `<path d="${d}" fill="${ink}"/>`;
    });
    return out;
  }

  // One path containing every shape plus shifted copies of any that cross the tile edge.
  // `toPath(points)` turns a shape's points into path data.
  function wrappedPath(W, H, shapes, toPath = (pts) => VM.polyPath(pts, true)) {
    let d = '';
    for (const pts of shapes) {
      for (const [dx, dy] of VM.wrapOffsets(W, H, VM.boxOf(pts))) {
        d += toPath(dx || dy ? pts.map(([x, y]) => [x + dx, y + dy]) : pts);
      }
    }
    return d;
  }

  // Smooth closed curve through the midpoints of a polygon's edges, using the corners as
  // quadratic control points. Compact output for thousands of small flecks.
  const r1 = (x) => Math.round(x * 10) / 10;
  function smoothClosed(pts) {
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const m0 = mid(pts[pts.length - 1], pts[0]);
    let d = `M${r1(m0[0])} ${r1(m0[1])}`;
    for (let i = 0; i < pts.length; i++) {
      const c = pts[i], m = mid(pts[i], pts[(i + 1) % pts.length]);
      d += `Q${r1(c[0])} ${r1(c[1])} ${r1(m[0])} ${r1(m[1])}`;
    }
    return d + 'Z';
  }

  // Control points of an irregular, slightly lumpy blob centered at (x, y).
  function lump(rnd, x, y, r, stretch) {
    const m = 7;
    const pts = [];
    const rot = rnd() * Math.PI * 2;
    for (let i = 0; i < m; i++) {
      const a = rot + (i / m) * Math.PI * 2;
      const rr = r * (0.6 + 0.6 * rnd());
      pts.push([x + Math.cos(a) * rr * stretch, y + Math.sin(a) * rr]);
    }
    return pts;
  }

  // Flecktarn: small flecks scattered more densely where this layer's field is high.
  function flecks(W, H, p, f, ink, k) {
    const rnd = VM.rng(p.seed * 97 + k);
    const S = Math.min(W, H);
    const r = (S * p.fleckSize) / 200;
    const tries = Math.min(12000, Math.round(((W * H) / (r * r)) * (p.density / 100) * 0.35));
    const st = Math.min(2, Math.sqrt(p.stretch));
    const polys = [];
    for (let i = 0; i < tries; i++) {
      const x = rnd() * W, y = rnd() * H;
      // Keep flecks mostly where the field is high, so they gather into clusters.
      const v = (f(x, y) + 1) / 2;
      if (rnd() > Math.pow(Math.max(0, v), 3) * 2.2) continue;
      polys.push(lump(rnd, x, y, r * (0.7 + 0.6 * rnd()), st));
    }
    const d = wrappedPath(W, H, polys, smoothClosed);
    return d ? `<path d="${d}" fill="${ink}"/>` : '';
  }

  // Chocolate chip: dark "rocks" with a light "shadow" chip offset beside each one.
  function chips(W, H, p, dark, light) {
    const rnd = VM.rng(p.seed * 131 + 7);
    const S = Math.min(W, H);
    const r = (S * p.fleckSize) / 200;
    const count = Math.min(6000, Math.round(((W * H) / (S * S)) * p.density * 3));
    const rocks = [], shadows = [];
    for (let i = 0; i < count; i++) {
      const x = rnd() * W, y = rnd() * H, rr = r * (0.6 + 0.8 * rnd());
      shadows.push(lump(rnd, x + rr * 0.45, y - rr * 0.35, rr, 1.1));
      rocks.push(lump(rnd, x, y, rr * 0.85, 1.1));
    }
    return `<path d="${wrappedPath(W, H, shadows, smoothClosed)}" fill="${light}"/><path d="${wrappedPath(W, H, rocks, smoothClosed)}" fill="${dark}"/>`;
  }

  // Splittertarn "rain": short, slightly slanted dashes in loose columns.
  function rain(W, H, p, ink) {
    const rnd = VM.rng(p.seed * 53 + 3);
    const S = Math.min(W, H);
    const cols = Math.max(4, Math.round(W / (S * 0.012)));
    const dx = W / cols;
    const len = S * 0.035, sw = Math.max(0.5, dx * 0.22);
    const slant = 0.18;
    const polys = [];
    for (let i = 0; i < cols; i++) {
      const count = Math.round((H / len) * 0.45);
      for (let k = 0; k < count; k++) {
        const x = (i + 0.5) * dx + (rnd() - 0.5) * dx * 0.3, y = rnd() * H, l = len * (0.5 + rnd());
        // Thin parallelogram so the export is all fills (cuts and prints cleanly).
        polys.push([[x, y], [x + sw, y], [x + sw + slant * l, y + l], [x + slant * l, y + l]]);
      }
    }
    return `<path d="${wrappedPath(W, H, polys)}" fill="${ink}"/>`;
  }

  VM.GENERATORS.camo = camo;
})(window.VM);
