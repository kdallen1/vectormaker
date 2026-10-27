// Shared helpers: units, number formatting, seeded RNG, and seamless-wrap drawing.
window.VM = window.VM || {};

(function (VM) {
  // SVG user units are CSS pixels: 96 per inch by spec.
  VM.PX_PER = { px: 1, in: 96, cm: 96 / 2.54 };
  VM.UNITS = ['px', 'in', 'cm'];

  VM.toPx = (value, unit) => value * VM.PX_PER[unit];
  VM.fromPx = (px, unit) => px / VM.PX_PER[unit];

  // Compact number output for SVG coordinates.
  VM.n = (x) => {
    const r = Math.round(x * 1000) / 1000;
    return Object.is(r, -0) ? '0' : String(r);
  };

  VM.fmtUnit = (px, unit) => {
    const v = VM.fromPx(px, unit);
    return (unit === 'px' ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000) + ' ' + unit;
  };

  VM.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // mulberry32: small, fast, deterministic PRNG so a seed always reproduces a pattern.
  VM.rng = (seed) => {
    let a = (seed >>> 0) || 1;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    return next;
  };

  VM.randomSeed = () => Math.floor(Math.random() * 1e6);

  // Path from a list of [x, y] points.
  VM.polyPath = (pts, closed) => {
    let d = 'M' + VM.n(pts[0][0]) + ' ' + VM.n(pts[0][1]);
    for (let i = 1; i < pts.length; i++) d += 'L' + VM.n(pts[i][0]) + ' ' + VM.n(pts[i][1]);
    return closed ? d + 'Z' : d;
  };

  // Offsets [dx, dy] (multiples of W and H) at which a shape with bounding box `box`
  // overlaps the W x H tile. Handles shapes bigger than the tile or far outside it.
  VM.wrapOffsets = (W, H, box) => {
    const out = [];
    const kx0 = Math.floor(-box.x1 / W) + 1, kx1 = Math.ceil(1 - box.x0 / W) - 1;
    const ky0 = Math.floor(-box.y1 / H) + 1, ky1 = Math.ceil(1 - box.y0 / H) - 1;
    for (let ky = ky0; ky <= ky1; ky++) for (let kx = kx0; kx <= kx1; kx++) out.push([kx * W, ky * H]);
    return out;
  };

  // Draw an element plus whatever copies are needed so that anything hanging off one
  // edge of the W x H tile reappears on the opposite edge. This is what makes
  // arbitrary placements tile seamlessly. `svg` is the element markup at its
  // natural position; `box` is its bounding box {x0, y0, x1, y1}.
  VM.wrap = (W, H, box, svg) => {
    let out = '';
    for (const [dx, dy] of VM.wrapOffsets(W, H, box)) {
      out += dx === 0 && dy === 0 ? svg : `<g transform="translate(${VM.n(dx)} ${VM.n(dy)})">${svg}</g>`;
    }
    return out;
  };

  const mod = (a, m) => ((a % m) + m) % m;
  VM.mod = mod;

  // Shortest distance between two points on the torus formed by the tile.
  VM.torusDist2 = (ax, ay, bx, by, W, H) => {
    let dx = Math.abs(ax - bx) % W, dy = Math.abs(ay - by) % H;
    dx = Math.min(dx, W - dx); dy = Math.min(dy, H - dy);
    return dx * dx + dy * dy;
  };

  // Tileable fractal Perlin noise over a W x H tile. `scale` is roughly how many noise
  // "blobs" span the shorter side; each octave doubles it. The gradient lattice wraps
  // around the tile, so f(x, y) = f(x + W, y) = f(x, y + H) exactly.
  // Returns f(x, y) in pixel coordinates with values roughly in [-1, 1].
  VM.noise = (seed, W, H, scale = 2, octaves = 3) => {
    const rnd = VM.rng(seed * 7919 + 17);
    const S = Math.min(W, H);
    const layers = [];
    for (let o = 0; o < octaves; o++) {
      const f = scale * 2 ** o;
      const px = Math.max(1, Math.round((f * W) / S)), py = Math.max(1, Math.round((f * H) / S));
      const g = new Float64Array(px * py * 2);
      for (let i = 0; i < px * py; i++) { const a = rnd() * Math.PI * 2; g[2 * i] = Math.cos(a); g[2 * i + 1] = Math.sin(a); }
      layers.push({ px, py, g, amp: 0.5 ** o });
    }
    const norm = layers.reduce((s, l) => s + l.amp, 0);
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const perlin = ({ px, py, g }, x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const i0 = mod(xi, px), i1 = mod(xi + 1, px), j0 = mod(yi, py), j1 = mod(yi + 1, py);
      const dot = (i, j, dx, dy) => { const k = 2 * (j * px + i); return g[k] * dx + g[k + 1] * dy; };
      const u = fade(xf), v = fade(yf);
      const a = dot(i0, j0, xf, yf) + u * (dot(i1, j0, xf - 1, yf) - dot(i0, j0, xf, yf));
      const b = dot(i0, j1, xf, yf - 1) + u * (dot(i1, j1, xf - 1, yf - 1) - dot(i0, j1, xf, yf - 1));
      return a + v * (b - a);
    };
    return (x, y) => {
      const u = mod(x, W) / W, v = mod(y, H) / H;
      let sum = 0;
      for (const l of layers) sum += l.amp * perlin(l, u * l.px, v * l.py);
      return (sum / norm) * 1.6;
    };
  };

  VM.boxOf = (pts, pad = 0) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };

  VM.gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
})(window.VM);
