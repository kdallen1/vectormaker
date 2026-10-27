// More generative patterns, inspired by the creative-coding scene (#genuary, tixy.land,
// tweetcarts, plotter art). Same contract as generators.js: each one declares `params` and
// `render(W, H, p, palette)`, and every output tiles seamlessly.
(function (VM) {
  const TAU = Math.PI * 2;
  const n = VM.n;
  const color = (pal, i) => pal.colors[VM.mod(i, pal.colors.length)];
  const pick = (rnd, pal) => pal.colors[Math.floor(rnd() * pal.colors.length)];
  const seedParam = { key: 'seed', label: 'Seed', type: 'seed', default: 1 };
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);

  // ---------------------------------------------------------------- Hitomezashi
  // Japanese sashiko stitching: each row and column gets one random bit that decides
  // whether its dashed line starts "on" or "off". The resulting regions can always be
  // 2-colored, which gives the striking filled version.
  const hitomezashi = {
    name: 'Hitomezashi stitching',
    blurb: 'Japanese sashiko stitch pattern. One random bit per row and column decides where each dashed line starts, and the enclosed regions can be filled in two colors. Rows and columns are rounded to even numbers so the repeat is exact.',
    params: [
      { key: 'cols', label: 'Columns', type: 'int', min: 2, max: 80, default: 24 },
      { key: 'rows', label: 'Rows', type: 'int', min: 2, max: 80, default: 24 },
      { key: 'bias', label: 'Bias (% of lines starting "on")', type: 'float', min: 0, max: 100, step: 1, default: 50 },
      { key: 'fill', label: 'Fill regions in two colors', type: 'bool', default: true },
      { key: 'stitches', label: 'Show stitches', type: 'bool', default: true },
      { key: 'stroke', label: 'Stitch weight (% of cell)', type: 'float', min: 2, max: 60, step: 1, default: 14 },
      seedParam,
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      const cols = even(p.cols), rows = even(p.rows);
      const cw = W / cols, ch = H / rows;
      const bits = (count) => {
        const b = Array.from({ length: count }, () => (rnd() * 100 < p.bias ? 1 : 0));
        // Keep the number of zero bits even so the 2-coloring also agrees across the seam.
        if (b.filter((x) => x === 0).length % 2) { const i = Math.floor(rnd() * count); b[i] ^= 1; }
        return b;
      };
      const vb = bits(cols), hb = bits(rows);
      const vSeg = (i, j) => (j + vb[i]) % 2 === 0; // vertical line x=i*cw, between rows j and j+1
      const hSeg = (i, j) => (i + hb[j]) % 2 === 0; // horizontal line y=j*ch, between cols i and i+1
      let out = '';
      if (p.fill) {
        // Flip color each time we cross a stitch: along row 0, then down each column.
        const c = [];
        for (let j = 0; j < rows; j++) {
          c.push([]);
          for (let i = 0; i < cols; i++) {
            if (j === 0) c[j][i] = i === 0 ? 0 : c[j][i - 1] ^ (vSeg(i, 0) ? 1 : 0);
            else c[j][i] = c[j - 1][i] ^ (hSeg(i, j) ? 1 : 0);
          }
        }
        let d = '';
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            if (!c[j][i]) continue;
            let k = i; while (k + 1 < cols && c[j][k + 1]) k++;
            d += `M${n(i * cw)} ${n(j * ch)}H${n((k + 1) * cw)}V${n((j + 1) * ch)}H${n(i * cw)}Z`;
            i = k;
          }
        }
        if (d) out += `<path d="${d}" fill="${color(pal, 1)}"/>`;
      }
      if (p.stitches) {
        const sw = (Math.min(cw, ch) * p.stroke) / 100;
        const attrs = `fill="none" stroke="${color(pal, 0)}" stroke-width="${n(sw)}" stroke-linecap="square"`;
        for (let i = 0; i < cols; i++) {
          let d = '';
          for (let j = 0; j < rows; j++) if (vSeg(i, j)) d += `M${n(i * cw)} ${n(j * ch)}V${n((j + 1) * ch)}`;
          if (d) out += VM.wrap(W, H, { x0: i * cw - sw, y0: -sw, x1: i * cw + sw, y1: H + sw }, `<path d="${d}" ${attrs}/>`);
        }
        for (let j = 0; j < rows; j++) {
          let d = '';
          for (let i = 0; i < cols; i++) if (hSeg(i, j)) d += `M${n(i * cw)} ${n(j * ch)}H${n((i + 1) * cw)}`;
          if (d) out += VM.wrap(W, H, { x0: -sw, y0: j * ch - sw, x1: W + sw, y1: j * ch + sw }, `<path d="${d}" ${attrs}/>`);
        }
      }
      return out;
    },
  };

  // ---------------------------------------------------------------- Flow field
  // Evenly spaced streamlines through a tileable noise angle field (after Jobard & Lefer).
  const flow = {
    name: 'Flow field',
    blurb: 'Evenly spaced streamlines that follow a swirling noise field, the signature look of plotter and gen-art Twitter.',
    params: [
      { key: 'scale', label: 'Noise scale', type: 'int', min: 1, max: 8, default: 2 },
      { key: 'octaves', label: 'Noise detail (octaves)', type: 'int', min: 1, max: 5, default: 2 },
      { key: 'curl', label: 'Turbulence', type: 'float', min: 0.1, max: 6, step: 0.1, default: 1.5 },
      { key: 'spacing', label: 'Line spacing (% of tile)', type: 'float', min: 0.5, max: 10, step: 0.1, default: 2 },
      { key: 'length', label: 'Max line length (% of tile)', type: 'float', min: 2, max: 200, step: 1, default: 60 },
      { key: 'minLength', label: 'Min line length (% of tile)', type: 'float', min: 0, max: 30, step: 0.5, default: 3 },
      { key: 'stroke', label: 'Line weight (px)', type: 'float', min: 0.25, max: 20, step: 0.25, default: 2 },
      { key: 'colorBy', label: 'Color lines', type: 'select', options: ['by region', 'randomly', 'by direction'], default: 'by region' },
      seedParam,
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      const field = VM.noise(p.seed, W, H, p.scale, p.octaves);
      const S = Math.min(W, H);
      const sep = Math.max(1, (S * p.spacing) / 100);
      const step = sep * 0.3;
      const stopDist = sep * 0.55;
      const maxSteps = Math.ceil((S * p.length) / 100 / step);
      const angle = (x, y) => field(x, y) * Math.PI * p.curl;

      // Toroidal spatial hash of points already placed.
      const gx = Math.max(1, Math.floor(W / sep)), gy = Math.max(1, Math.floor(H / sep));
      const grid = Array.from({ length: gx * gy }, () => []);
      const cellOf = (x, y) => [Math.floor((VM.mod(x, W) / W) * gx) % gx, Math.floor((VM.mod(y, H) / H) * gy) % gy];
      const near = (x, y, d) => {
        const [ci, cj] = cellOf(x, y);
        const d2 = d * d;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          for (const [px, py] of grid[VM.mod(cj + dj, gy) * gx + VM.mod(ci + di, gx)]) {
            if (VM.torusDist2(x, y, px, py, W, H) < d2) return true;
          }
        }
        return false;
      };
      const trace = (x, y, dir) => {
        const pts = [];
        for (let s = 0; s < maxSteps; s++) {
          const a = angle(x, y);
          x += dir * Math.cos(a) * step;
          y += dir * Math.sin(a) * step;
          if (near(x, y, stopDist)) break;
          pts.push([x, y]);
        }
        return pts;
      };

      // Candidate seeds: a shuffled, jittered grid at the line spacing.
      const seeds = [];
      for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) seeds.push([(i + rnd()) * (W / gx), (j + rnd()) * (H / gy)]);
      for (let i = seeds.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [seeds[i], seeds[k]] = [seeds[k], seeds[i]]; }

      const minPts = Math.max(2, Math.ceil((S * p.minLength) / 100 / step));
      let out = '';
      for (const [sx, sy] of seeds) {
        if (near(sx, sy, sep)) continue;
        const pts = [...trace(sx, sy, -1).reverse(), [sx, sy], ...trace(sx, sy, 1)];
        if (pts.length < minPts) continue;
        for (const [x, y] of pts) { const [ci, cj] = cellOf(x, y); grid[cj * gx + ci].push([x, y]); }
        let c;
        if (p.colorBy === 'randomly') c = pick(rnd, pal);
        else if (p.colorBy === 'by direction') {
          const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1];
          const a = VM.mod(Math.atan2(y1 - y0, x1 - x0), Math.PI);
          c = color(pal, Math.floor((a / Math.PI) * pal.colors.length));
        } else {
          const t = Math.min(0.999, Math.max(0, (field(sx * 1.0001 + 7, sy) + 1) / 2));
          c = color(pal, Math.floor(t * pal.colors.length));
        }
        out += VM.wrap(W, H, VM.boxOf(pts, p.stroke),
          `<path d="${VM.polyPath(pts)}" fill="none" stroke="${c}" stroke-width="${n(p.stroke)}" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
      return out;
    },
  };

  // ---------------------------------------------------------------- Circle packing
  const packing = {
    name: 'Circle packing',
    blurb: 'Random circles grown until they touch their neighbors, drawn as targets, colored bands, or outlines. Packing wraps around the tile edges.',
    params: [
      { key: 'style', label: 'Style', type: 'select', options: ['targets', 'bands', 'solid', 'outlines'], default: 'targets' },
      { key: 'maxR', label: 'Largest circle (% of tile)', type: 'float', min: 1, max: 40, step: 0.5, default: 14 },
      { key: 'minR', label: 'Smallest circle (% of tile)', type: 'float', min: 0.2, max: 20, step: 0.1, default: 1 },
      { key: 'gap', label: 'Gap (px)', type: 'float', min: 0, max: 40, step: 0.5, default: 4 },
      { key: 'rings', label: 'Rings per circle', type: 'int', min: 1, max: 12, default: 4 },
      { key: 'attempts', label: 'Fill attempts', type: 'int', min: 100, max: 20000, default: 5000 },
      { key: 'stroke', label: 'Outline weight (px)', type: 'float', min: 0.25, max: 10, step: 0.25, default: 1.5 },
      seedParam,
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      const S = Math.min(W, H);
      const maxR = (S * p.maxR) / 100, minR = Math.min(maxR, (S * p.minR) / 100);
      const circles = [];
      for (let a = 0; a < p.attempts; a++) {
        const x = rnd() * W, y = rnd() * H;
        let r = maxR;
        for (const c of circles) {
          r = Math.min(r, Math.sqrt(VM.torusDist2(x, y, c.x, c.y, W, H)) - c.r - p.gap);
          if (r < minR) break;
        }
        if (r >= minR) circles.push({ x, y, r, c: Math.floor(rnd() * pal.colors.length) });
      }
      let out = '';
      for (const { x, y, r, c } of circles) {
        let svg = '';
        const rings = p.style === 'solid' ? 1 : p.rings;
        for (let k = 0; k < rings; k++) {
          const rr = r * (1 - k / rings);
          if (p.style === 'outlines') {
            svg += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(Math.max(0, rr - p.stroke / 2))}" fill="none" stroke="${color(pal, c + k)}" stroke-width="${n(p.stroke)}"/>`;
          } else {
            const fill = p.style === 'targets' ? (k % 2 ? pal.bg : color(pal, c)) : color(pal, c + k);
            svg += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(rr)}" fill="${fill}"/>`;
          }
        }
        out += VM.wrap(W, H, { x0: x - r, y0: y - r, x1: x + r, y1: y + r }, svg);
      }
      return out;
    },
  };

  // ---------------------------------------------------------------- Voronoi
  // Cells are computed on the torus by clipping against the 9 periodic copies of every site.
  const voronoi = {
    name: 'Voronoi cells',
    blurb: 'Each point claims the area closest to it, like stained glass, cracked earth, or river pebbles. Relaxation evens out the cell sizes.',
    params: [
      { key: 'cells', label: 'Cells', type: 'int', min: 3, max: 400, default: 60 },
      { key: 'relax', label: 'Relaxation passes', type: 'int', min: 0, max: 10, default: 2 },
      { key: 'gap', label: 'Gap between cells (px)', type: 'float', min: 0, max: 40, step: 0.5, default: 6 },
      { key: 'round', label: 'Corner rounding (px)', type: 'float', min: 0, max: 40, step: 0.5, default: 6 },
      { key: 'dots', label: 'Dot at each center', type: 'bool', default: false },
      seedParam,
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      let sites = Array.from({ length: p.cells }, () => [rnd() * W, rnd() * H]);
      const colors = sites.map(() => pick(rnd, pal));

      // Typical cell size; neighbors farther than a few of these rarely matter.
      const typical = Math.sqrt((W * H) / sites.length);
      const cellPoly = (i, inset, radius = 4 * typical) => {
        const [sx, sy] = sites[i];
        const R = W + H;
        let poly = [[sx - R, sy - R], [sx + R, sy - R], [sx + R, sy + R], [sx - R, sy + R]];
        let reach = R * Math.SQRT2;
        // Nearest neighbors first so the polygon shrinks quickly and we can skip far sites.
        const others = [];
        const r2 = radius * radius;
        for (let j = 0; j < sites.length; j++) {
          for (const dy of [-H, 0, H]) for (const dx of [-W, 0, W]) {
            if (j === i && dx === 0 && dy === 0) continue;
            const tx = sites[j][0] + dx, ty = sites[j][1] + dy;
            const d2 = (tx - sx) ** 2 + (ty - sy) ** 2;
            if (d2 <= r2) others.push([tx, ty, d2]);
          }
        }
        others.sort((a, b) => a[2] - b[2]);
        for (const [tx, ty, d2] of others) {
          const d = Math.sqrt(d2);
          if (d / 2 - inset > reach) break;
          if (d === 0) continue;
          const nx = (tx - sx) / d, ny = (ty - sy) / d;
          const c = d / 2 - inset; // keep points with (p - s)·n <= c
          poly = clip(poly, (q) => (q[0] - sx) * nx + (q[1] - sy) * ny - c);
          if (poly.length < 3) return [];
          reach = Math.max(...poly.map(([x, y]) => Math.hypot(x - sx, y - sy)));
        }
        // Sites beyond the search radius could still cut a very large cell; retry wider.
        if ((reach + inset) * 2 > radius && radius < 2 * (W + H)) return cellPoly(i, inset, radius * 2);
        return poly;
      };

      for (let it = 0; it < p.relax; it++) {
        sites = sites.map((s, i) => {
          const poly = cellPoly(i, 0);
          if (poly.length < 3) return s;
          const [cx, cy] = centroid(poly);
          return [VM.mod(cx, W), VM.mod(cy, H)];
        });
      }

      let out = '';
      const r = p.round;
      for (let i = 0; i < sites.length; i++) {
        const poly = cellPoly(i, p.gap / 2 + r);
        if (poly.length < 3) continue;
        const stroke = r > 0 ? ` stroke="${colors[i]}" stroke-width="${n(2 * r)}" stroke-linejoin="round"` : '';
        let svg = `<path d="${VM.polyPath(poly, true)}" fill="${colors[i]}"${stroke}/>`;
        if (p.dots) {
          const others = pal.colors.filter((c) => c !== colors[i]);
          const dotR = Math.sqrt((W * H) / sites.length) * 0.08;
          svg += `<circle cx="${n(sites[i][0])}" cy="${n(sites[i][1])}" r="${n(dotR)}" fill="${others.length ? others[i % others.length] : pal.bg}"/>`;
        }
        out += VM.wrap(W, H, VM.boxOf(poly, r), svg);
      }
      return out;
    },
  };

  // Sutherland–Hodgman against one half-plane; keeps points where f(q) <= 0.
  function clip(poly, f) {
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const fa = f(a), fb = f(b);
      if (fa <= 0) out.push(a);
      if ((fa <= 0) !== (fb <= 0)) {
        const t = fa / (fa - fb);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    return out;
  }

  function centroid(poly) {
    let a = 0, cx = 0, cy = 0;
    for (let k = 0; k < poly.length; k++) {
      const [x0, y0] = poly[k], [x1, y1] = poly[(k + 1) % poly.length];
      const cr = x0 * y1 - x1 * y0;
      a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
    }
    return a ? [cx / (3 * a), cy / (3 * a)] : poly[0];
  }

  // ---------------------------------------------------------------- Halftone field
  // tixy.land-style: a grid of shapes whose size (and angle) is driven by a periodic function.
  const halftone = {
    name: 'Halftone field',
    blurb: 'A grid of dots or shapes whose size and angle follow a math function (ripples, rings, egg crate, noise), in the spirit of tixy.land.',
    params: [
      { key: 'fn', label: 'Function', type: 'select', options: ['ripples', 'rings', 'egg crate', 'diagonal waves', 'noise'], default: 'rings' },
      { key: 'freq', label: 'Frequency', type: 'int', min: 1, max: 12, default: 2 },
      { key: 'shape', label: 'Shape', type: 'select', options: ['circle', 'square', 'diamond', 'ring', 'dash'], default: 'circle' },
      { key: 'cols', label: 'Columns', type: 'int', min: 2, max: 120, default: 32 },
      { key: 'rows', label: 'Rows', type: 'int', min: 2, max: 120, default: 32 },
      { key: 'offset', label: 'Offset alternate rows (use even rows)', type: 'bool', default: false },
      { key: 'minSize', label: 'Smallest size (% of cell)', type: 'float', min: 0, max: 150, step: 1, default: 5 },
      { key: 'maxSize', label: 'Largest size (% of cell)', type: 'float', min: 0, max: 150, step: 1, default: 95 },
      { key: 'rotate', label: 'Rotate with value', type: 'bool', default: false },
      { key: 'colorBy', label: 'Color by value', type: 'bool', default: false },
      { key: 'stroke', label: 'Line weight for ring / dash (% of cell)', type: 'float', min: 1, max: 50, step: 1, default: 12 },
      seedParam,
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      const f = p.freq;
      let fn;
      if (p.fn === 'ripples') {
        const waves = Array.from({ length: 3 }, () => {
          let kx = 0, ky = 0;
          while (!kx && !ky) { kx = rnd.int(-f, f); ky = rnd.int(-f, f); }
          return { kx, ky, ph: rnd() * TAU };
        });
        fn = (u, v) => waves.reduce((s, w) => s + Math.cos(TAU * (w.kx * u + w.ky * v) + w.ph), 0);
      } else if (p.fn === 'rings') {
        // A smooth, periodic stand-in for "distance from the corner".
        fn = (u, v) => Math.cos(TAU * f * Math.hypot(Math.sin(Math.PI * u), Math.sin(Math.PI * v)));
      } else if (p.fn === 'egg crate') {
        fn = (u, v) => Math.cos(TAU * f * u) * Math.cos(TAU * f * v);
      } else if (p.fn === 'diagonal waves') {
        fn = (u, v) => Math.sin(TAU * f * (u + v)) + 0.5 * Math.sin(TAU * f * (u - v) * 2);
      } else {
        const noise = VM.noise(p.seed, W, H, f, 3);
        fn = (u, v) => noise(u * W, v * H);
      }
      const cw = W / p.cols, ch = H / p.rows;
      const cells = [];
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < p.rows; j++) {
        for (let i = 0; i < p.cols; i++) {
          const x = (i + 0.5 + (p.offset && j % 2 ? 0.5 : 0)) * cw, y = (j + 0.5) * ch;
          const val = fn(x / W, y / H);
          lo = Math.min(lo, val); hi = Math.max(hi, val);
          cells.push([x, y, val]);
        }
      }
      const cs = Math.min(cw, ch);
      const sw = (cs * p.stroke) / 100;
      let out = '';
      for (const [x, y, val] of cells) {
        const t = hi > lo ? (val - lo) / (hi - lo) : 0.5;
        const size = (cs * (p.minSize + (p.maxSize - p.minSize) * t)) / 100;
        if (size <= 0.01) continue;
        const c = p.colorBy ? color(pal, Math.min(pal.colors.length - 1, Math.floor(t * pal.colors.length))) : pal.colors[0];
        const rot = p.rotate ? t * 180 : 0;
        const tf = rot ? ` transform="rotate(${n(rot)} ${n(x)} ${n(y)})"` : '';
        const h = size / 2;
        let svg;
        if (p.shape === 'circle') svg = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(h)}" fill="${c}"/>`;
        else if (p.shape === 'ring') svg = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(Math.max(0, h - sw / 2))}" fill="none" stroke="${c}" stroke-width="${n(Math.min(sw, h))}"/>`;
        else if (p.shape === 'square') svg = `<rect x="${n(x - h)}" y="${n(y - h)}" width="${n(size)}" height="${n(size)}" fill="${c}"${tf}/>`;
        else if (p.shape === 'diamond') svg = `<path d="M${n(x)} ${n(y - h)}L${n(x + h)} ${n(y)}L${n(x)} ${n(y + h)}L${n(x - h)} ${n(y)}Z" fill="${c}"${tf}/>`;
        else {
          const a = ((p.rotate ? t * 180 : 45) * Math.PI) / 180;
          const dx = Math.cos(a) * h, dy = Math.sin(a) * h;
          svg = `<path d="M${n(x - dx)} ${n(y - dy)}L${n(x + dx)} ${n(y + dy)}" stroke="${c}" stroke-width="${n(sw)}" stroke-linecap="round"/>`;
        }
        const r = h * Math.SQRT2 + sw;
        out += VM.wrap(W, H, { x0: x - r, y0: y - r, x1: x + r, y1: y + r }, svg);
      }
      return out;
    },
  };

  // ---------------------------------------------------------------- Recursive subdivision
  const subdivision = {
    name: 'Recursive subdivision',
    blurb: 'The tile is split into smaller and smaller rectangles, Mondrian/Bauhaus style, each optionally decorated with circles, quarter-circles, half-moons, or stripes.',
    params: [
      { key: 'depth', label: 'Max depth', type: 'int', min: 1, max: 10, default: 5 },
      { key: 'chance', label: 'Split chance (%)', type: 'float', min: 0, max: 100, step: 1, default: 75 },
      { key: 'variety', label: 'Split position variety (%)', type: 'float', min: 0, max: 90, step: 1, default: 50 },
      { key: 'minSize', label: 'Smallest block (% of tile)', type: 'float', min: 1, max: 50, step: 0.5, default: 6 },
      { key: 'gap', label: 'Gap (px)', type: 'float', min: 0, max: 40, step: 0.5, default: 6 },
      { key: 'radius', label: 'Corner rounding (px)', type: 'float', min: 0, max: 60, step: 0.5, default: 0 },
      { key: 'decorate', label: 'Decorate blocks', type: 'bool', default: true },
      { key: 'empty', label: 'Empty blocks (%)', type: 'float', min: 0, max: 90, step: 1, default: 10 },
      seedParam,
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      const S = Math.min(W, H);
      const minS = (S * p.minSize) / 100;
      const leaves = [];
      const split = (x, y, w, h, depth) => {
        const canV = w >= 2 * minS, canH = h >= 2 * minS;
        if (depth >= p.depth || (!canV && !canH) || (depth > 0 && rnd() * 100 >= p.chance)) { leaves.push([x, y, w, h]); return; }
        const vertical = canV && (!canH || rnd() < w / (w + h));
        const len = vertical ? w : h;
        let t = 0.5 + (rnd() - 0.5) * (p.variety / 100);
        t = Math.min(1 - minS / len, Math.max(minS / len, t));
        if (vertical) { split(x, y, w * t, h, depth + 1); split(x + w * t, y, w * (1 - t), h, depth + 1); }
        else { split(x, y, w, h * t, depth + 1); split(x, y + h * t, w, h * (1 - t), depth + 1); }
      };
      split(0, 0, W, H, 0);

      let out = '';
      const g = p.gap / 2;
      for (const [lx, ly, lw, lh] of leaves) {
        // Inset by half the gap on every side, so the gap is also correct across the seam.
        const x0 = lx + g, y0 = ly + g, w = lw - 2 * g, h = lh - 2 * g;
        if (w <= 0 || h <= 0) continue;
        if (rnd() * 100 < p.empty) continue;
        const rad = Math.min(p.radius, w / 2, h / 2);
        const base = pick(rnd, pal);
        out += `<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(h)}"${rad ? ` rx="${n(rad)}"` : ''} fill="${base}"/>`;
        if (!p.decorate) continue;
        const others = [pal.bg, ...pal.colors].filter((c) => c !== base);
        const deco = others.length ? others[Math.floor(rnd() * others.length)] : pal.bg;
        const kind = rnd.pick(['none', 'circle', 'quarter', 'half', 'stripes', 'stripes']);
        const m = Math.min(w, h);
        if (kind === 'circle') {
          out += `<circle cx="${n(x0 + w / 2)}" cy="${n(y0 + h / 2)}" r="${n(m * 0.35)}" fill="${deco}"/>`;
        } else if (kind === 'quarter') {
          const sx = rnd() < 0.5 ? 1 : -1, sy = rnd() < 0.5 ? 1 : -1;
          const cx = sx > 0 ? x0 : x0 + w, cy = sy > 0 ? y0 : y0 + h;
          const sweep = sx * sy > 0 ? 1 : 0;
          let d = `M${n(cx + sx * m)} ${n(cy)}A${n(m)} ${n(m)} 0 0 ${sweep} ${n(cx)} ${n(cy + sy * m)}`;
          // Follow the block's own rounded corner so the quarter-circle doesn't poke out.
          d += rad ? `L${n(cx)} ${n(cy + sy * rad)}A${n(rad)} ${n(rad)} 0 0 ${sweep} ${n(cx + sx * rad)} ${n(cy)}Z` : `L${n(cx)} ${n(cy)}Z`;
          out += `<path d="${d}" fill="${deco}"/>`;
        } else if (kind === 'half') {
          const edge = rnd.int(0, 3);
          const along = edge < 2 ? w : h, across = edge < 2 ? h : w;
          const r = Math.max(0, Math.min(along / 2 - rad, across));
          const cx = x0 + w / 2, cy = y0 + h / 2;
          const d = [
            `M${n(cx - r)} ${n(y0 + h)}A${n(r)} ${n(r)} 0 0 1 ${n(cx + r)} ${n(y0 + h)}Z`, // bottom
            `M${n(cx + r)} ${n(y0)}A${n(r)} ${n(r)} 0 0 1 ${n(cx - r)} ${n(y0)}Z`, // top
            `M${n(x0)} ${n(cy - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x0)} ${n(cy + r)}Z`, // left
            `M${n(x0 + w)} ${n(cy + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x0 + w)} ${n(cy - r)}Z`, // right
          ][edge];
          if (r > 0) out += `<path d="${d}" fill="${deco}"/>`;
        } else if (kind === 'stripes') {
          const k = rnd.int(3, 7);
          const horizontal = rnd() < 0.5;
          const pad = rad;
          let d = '';
          for (let s = 0; s < k; s++) {
            if (horizontal) {
              const bh = (h - 2 * pad) / (2 * k - 1);
              d += `M${n(x0 + pad)} ${n(y0 + pad + 2 * s * bh)}h${n(w - 2 * pad)}v${n(bh)}h${n(-(w - 2 * pad))}Z`;
            } else {
              const bw = (w - 2 * pad) / (2 * k - 1);
              d += `M${n(x0 + pad + 2 * s * bw)} ${n(y0 + pad)}h${n(bw)}v${n(h - 2 * pad)}h${n(-bw)}Z`;
            }
          }
          out += `<path d="${d}" fill="${deco}"/>`;
        }
      }
      return out;
    },
  };

  // ---------------------------------------------------------------- Ridgelines
  // "Unknown Pleasures": stacked noise profiles, each hiding the ones behind it.
  const ridgelines = {
    name: 'Ridgelines',
    blurb: 'Stacked mountain-range profiles, each hiding the ones behind it, like the Joy Division "Unknown Pleasures" cover.',
    params: [
      { key: 'lines', label: 'Lines', type: 'int', min: 4, max: 150, default: 40 },
      { key: 'amp', label: 'Peak height (× line spacing)', type: 'float', min: 0, max: 20, step: 0.1, default: 6 },
      { key: 'scale', label: 'Noise scale', type: 'int', min: 1, max: 10, default: 3 },
      { key: 'octaves', label: 'Noise detail (octaves)', type: 'int', min: 1, max: 5, default: 3 },
      { key: 'peaky', label: 'Peakiness', type: 'float', min: 1, max: 8, step: 0.1, default: 2.5 },
      { key: 'style', label: 'Style', type: 'select', options: ['lines', 'filled ridges'], default: 'lines' },
      { key: 'stroke', label: 'Line weight (px)', type: 'float', min: 0.25, max: 12, step: 0.25, default: 1.5 },
      { key: 'cycle', label: 'Cycle colors per line', type: 'bool', default: false },
      seedParam,
    ],
    render(W, H, p, pal) {
      const noise = VM.noise(p.seed, W, H, p.scale, p.octaves);
      const s = H / p.lines;
      const A = s * p.amp;
      // Enough samples for the finest noise octave, without bloating the file.
      const samples = Math.min(600, Math.max(60, Math.round(W / 8), 16 * p.scale * 2 ** (p.octaves - 1)));
      // Sampling the 2D noise at each line's own height keeps the stack periodic vertically.
      const vals = [];
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < p.lines; k++) {
        vals.push([]);
        for (let i = 0; i <= samples; i++) {
          const v = noise((i / samples) * W, (k + 0.5) * s);
          vals[k].push(v); lo = Math.min(lo, v); hi = Math.max(hi, v);
        }
      }
      const pieces = [];
      for (let k = 0; k < p.lines; k++) {
        const base = (k + 0.5) * s;
        // Stretch to 0..1 so the tallest peak reaches the full height, then sharpen.
        const pts = vals[k].map((v, i) => [(i / samples) * W, base - A * ((v - lo) / (hi - lo || 1)) ** p.peaky]);
        const box = VM.boxOf(pts, p.stroke);
        box.y1 = Math.max(box.y1, base + p.stroke);
        for (const [dx, dy] of VM.wrapOffsets(W, H, box)) pieces.push({ k, base, pts, dx, dy });
      }
      // Paint from the top of the tile down so nearer (lower) lines cover farther ones.
      pieces.sort((a, b) => a.base + a.dy - (b.base + b.dy));
      let out = '';
      for (const { k, base, pts, dx, dy } of pieces) {
        const lineColor = p.cycle ? color(pal, k) : pal.colors[0];
        const curve = VM.polyPath(pts);
        const area = curve + `L${n(W)} ${n(base + p.stroke)}L0 ${n(base + p.stroke)}Z`;
        let svg;
        if (p.style === 'filled ridges') {
          svg = `<path d="${area}" fill="${lineColor}"/><path d="${curve}" fill="none" stroke="${pal.bg}" stroke-width="${n(p.stroke)}" stroke-linejoin="round"/>`;
        } else {
          svg = `<path d="${area}" fill="${pal.bg}"/><path d="${curve}" fill="none" stroke="${lineColor}" stroke-width="${n(p.stroke)}" stroke-linejoin="round"/>`;
        }
        out += dx || dy ? `<g transform="translate(${n(dx)} ${n(dy)})">${svg}</g>` : svg;
      }
      return out;
    },
  };

  Object.assign(VM.GENERATORS, { hitomezashi, flow, packing, voronoi, halftone, subdivision, ridgelines });
})(window.VM);
