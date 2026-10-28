// "Inspire from a picture": read a photo's palette and visual character, then suggest
// generative patterns (with tuned settings) that feel like it.
(function (VM) {
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * clamp01(t);

  // ---- color: sRGB <-> CIELAB (D65). Lab distances roughly match perceived differences.
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const unlin = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  function rgbToLab(r, g, b) {
    const R = lin(r), G = lin(g), B = lin(b);
    const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
    const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function labToHex([L, a, b]) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const inv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
    const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
    const R = 3.2406 * x - 1.5372 * y - 0.4986 * z;
    const G = -0.9689 * x + 1.8758 * y + 0.0415 * z;
    const B = 0.0557 * x - 0.204 * y + 1.057 * z;
    return '#' + [R, G, B].map((c) => Math.round(Math.max(0, Math.min(255, unlin(c)))).toString(16).padStart(2, '0')).join('');
  }
  const dE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

  // k-means (k-means++ seeding) over Lab pixels. Returns clusters sorted by size.
  function kmeans(px, k, rnd) {
    const n = px.length / 3;
    const pt = (i) => [px[3 * i], px[3 * i + 1], px[3 * i + 2]];
    const centers = [pt(Math.floor(rnd() * n))];
    const d2 = new Float64Array(n).fill(Infinity);
    while (centers.length < k) {
      let sum = 0;
      const c = centers[centers.length - 1];
      for (let i = 0; i < n; i++) { d2[i] = Math.min(d2[i], dE(pt(i), c) ** 2); sum += d2[i]; }
      let r = rnd() * sum, i = 0;
      while (i < n - 1 && (r -= d2[i]) > 0) i++;
      centers.push(pt(i));
    }
    const assign = new Int32Array(n);
    for (let it = 0; it < 14; it++) {
      const acc = centers.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < n; i++) {
        const p = pt(i);
        let best = 0, bd = Infinity;
        centers.forEach((c, j) => { const d = dE(p, c); if (d < bd) { bd = d; best = j; } });
        assign[i] = best;
        const a = acc[best]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++;
      }
      acc.forEach((a, j) => { if (a[3]) centers[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    }
    const counts = centers.map(() => 0);
    for (let i = 0; i < n; i++) counts[assign[i]]++;
    return centers.map((lab, j) => ({ lab, weight: counts[j] / n })).filter((c) => c.weight > 0).sort((a, b) => b.weight - a.weight);
  }

  // ---- analysis. `img` is ImageData-like { width, height, data } (RGBA bytes).
  VM.analyzeImage = (img) => {
    const { width: w, height: h, data } = img;
    const lab = new Float64Array(w * h * 3);
    let rgSum = 0, ybSum = 0, rg2 = 0, yb2 = 0;
    for (let i = 0; i < w * h; i++) {
      const r = data[4 * i], g = data[4 * i + 1], b = data[4 * i + 2];
      const L = rgbToLab(r, g, b);
      lab[3 * i] = L[0]; lab[3 * i + 1] = L[1]; lab[3 * i + 2] = L[2];
      const rg = r - g, yb = 0.5 * (r + g) - b;
      rgSum += rg; ybSum += yb; rg2 += rg * rg; yb2 += yb * yb;
    }
    const N = w * h;

    // Palette: cluster, then merge near-duplicates (less than ~12 ΔE apart).
    const raw = kmeans(lab, 7, VM.rng(12345));
    const palette = [];
    for (const c of raw) {
      const twin = palette.find((p) => dE(p.lab, c.lab) < 12);
      if (twin) {
        const t = c.weight / (twin.weight + c.weight);
        twin.lab = twin.lab.map((v, i) => v + (c.lab[i] - v) * t);
        twin.weight += c.weight;
      } else palette.push({ ...c });
    }
    palette.sort((a, b) => b.weight - a.weight);

    // Gradients (Sobel on lightness) and the structure tensor, globally and per block.
    const Lum = (x, y) => lab[3 * (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x)))];
    let magSum = 0, Jxx = 0, Jyy = 0, Jxy = 0, hE = 0, vE = 0, totE = 0, Lsum = 0, L2 = 0;
    // Blocks for local line-likeness: big enough that a single blob's edge doesn't count
    // as a "line", small enough that stripes running in several directions still do.
    const B = Math.max(12, Math.round(Math.min(w, h) / 4)), bw = Math.ceil(w / B), bh = Math.ceil(h / B);
    const blocks = Array.from({ length: bw * bh }, () => [0, 0, 0]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = (Lum(x + 1, y - 1) + 2 * Lum(x + 1, y) + Lum(x + 1, y + 1)) - (Lum(x - 1, y - 1) + 2 * Lum(x - 1, y) + Lum(x - 1, y + 1));
        const gy = (Lum(x - 1, y + 1) + 2 * Lum(x, y + 1) + Lum(x + 1, y + 1)) - (Lum(x - 1, y - 1) + 2 * Lum(x, y - 1) + Lum(x + 1, y - 1));
        const e = gx * gx + gy * gy;
        magSum += Math.sqrt(e) / 8;
        Jxx += gx * gx; Jyy += gy * gy; Jxy += gx * gy;
        const blk = blocks[Math.floor(y / B) * bw + Math.floor(x / B)];
        blk[0] += gx * gx; blk[1] += gy * gy; blk[2] += gx * gy;
        // Edge energy running square to the frame (within 10°), split by orientation.
        if (e > 0) {
          const a = Math.abs(Math.atan2(gy, gx)); // 0 or π: vertical edge; π/2: horizontal edge
          if (a < 0.175 || a > Math.PI - 0.175) vE += e;
          else if (Math.abs(a - Math.PI / 2) < 0.175) hE += e;
          totE += e;
        }
        const L = Lum(x, y); Lsum += L; L2 += L * L;
      }
    }
    const coh = (xx, yy, xy) => (xx + yy > 0 ? Math.sqrt((xx - yy) ** 2 + 4 * xy * xy) / (xx + yy) : 0);
    // Linearity: are local textures line-like (grain, stripes) or blob-like?
    let linNum = 0, linDen = 0;
    for (const [xx, yy, xy] of blocks) { const e = xx + yy; linNum += coh(xx, yy, xy) * e; linDen += e; }
    // Dominant line direction: perpendicular to the dominant gradient direction.
    const lineAngle = (0.5 * Math.atan2(2 * Jxy, Jxx - Jyy) + Math.PI / 2 + Math.PI) % Math.PI;
    const horiz = Math.abs(Math.cos(lineAngle)); // 1 = horizontal lines, 0 = vertical
    const meanL = Lsum / N;
    const sdRg = Math.sqrt(Math.max(0, rg2 / N - (rgSum / N) ** 2)), sdYb = Math.sqrt(Math.max(0, yb2 / N - (ybSum / N) ** 2));
    const colorfulness = Math.hypot(sdRg, sdYb) + 0.3 * Math.hypot(rgSum / N, ybSum / N);
    // Earthy: browns, olives, khakis, and muted greens (hue 30–150°, modest chroma).
    const earthy = palette.reduce((s, p) => {
      const hue = (Math.atan2(p.lab[2], p.lab[1]) * 180 / Math.PI + 360) % 360, chroma = Math.hypot(p.lab[1], p.lab[2]);
      return s + (hue > 30 && hue < 150 && chroma > 7 && chroma < 55 ? p.weight : 0) + (chroma <= 7 && p.lab[0] < 30 ? p.weight * 0.3 : 0);
    }, 0);

    const features = {
      busy: clamp01((magSum / N - 1.5) / 12),
      linearity: clamp01(((linDen ? linNum / linDen : 0) - 0.15) / 0.55),
      directional: clamp01((coh(Jxx, Jyy, Jxy) - 0.05) / 0.5),
      horizontal: horiz > 0.7, vertical: horiz < 0.3,
      // Geometric = lots of straight edges in BOTH axes (grids, plaids, blocks). One axis
      // alone is just direction, which 'directional' already captures.
      geometric: clamp01(((totE ? (2 * Math.min(hE, vE)) / totE : 0) - 0.25) / 0.55),
      colorful: clamp01(colorfulness / 90),
      contrast: clamp01(Math.sqrt(Math.max(0, L2 / N - meanL * meanL)) / 30),
      earthy: clamp01(earthy * 1.3),
      light: meanL > 60,
    };
    return { palette: palette.map((p) => ({ hex: labToHex(p.lab), lab: p.lab, weight: p.weight })), features, describe: describe(features) };
  };

  function describe(f) {
    const words = [];
    words.push(f.colorful > 0.55 ? 'colorful' : f.colorful < 0.2 ? 'muted' : 'balanced color');
    if (f.earthy > 0.5) words.push('earthy');
    words.push(f.geometric > 0.55 ? 'geometric' : 'organic');
    if (f.linearity > 0.55) words.push('line-like');
    else if (f.linearity < 0.3) words.push('blotchy');
    if (f.directional > 0.4) words.push(f.horizontal ? 'horizontal flow' : f.vertical ? 'vertical flow' : 'diagonal flow');
    else words.push('no single direction');
    words.push(f.busy > 0.6 ? 'fine detail' : f.busy < 0.25 ? 'broad shapes' : 'medium detail');
    words.push(f.contrast > 0.6 ? 'high contrast' : f.contrast < 0.3 ? 'soft contrast' : 'moderate contrast');
    return words;
  }

  // ---- suggestions
  // Palette for a pattern: background = most common color; inks by coverage ('area' for
  // layered/filled looks) or by contrast with the background ('contrast' for line work).
  function paletteFor(a, order) {
    const [bg, ...rest] = a.palette;
    let inks = rest.slice(0, 5);
    if (order === 'contrast') inks = inks.slice().sort((p, q) => dE(q.lab, bg.lab) - dE(p.lab, bg.lab));
    // Make sure there's at least one ink that stands out from the background.
    if (!inks.length || dE(inks[0].lab, bg.lab) < 15) {
      const L = bg.lab[0] > 50 ? Math.max(5, bg.lab[0] - 45) : Math.min(95, bg.lab[0] + 45);
      inks.unshift({ hex: labToHex([L, bg.lab[1], bg.lab[2]]), lab: [L, bg.lab[1], bg.lab[2]] });
    }
    return { bg: bg.hex, colors: inks.slice(0, 4).map((p) => p.hex) };
  }

  VM.inspirePalette = paletteFor;

  // Each idea: how well it fits (score) and settings tuned to the picture.
  const IDEAS = [
    { label: 'Woodland camo', type: 'camo', order: 'area',
      score: (f) => 0.5 * f.earthy + 0.35 * (1 - f.geometric) + 0.3 * (1 - f.linearity) + 0.15 * (1 - f.colorful),
      params: (f, dir) => ({ style: 'woodland', scale: Math.round(lerp(2, 5, f.busy)), detail: 3, stretch: dir.stretch(1.3, 2.5), warp: 0.7, coverage: 40, smooth: 2, res: 120 }) },
    { label: 'Tiger stripe camo', type: 'camo', order: 'area',
      score: (f) => 0.45 * f.earthy + 0.4 * f.linearity + 0.3 * f.directional - 0.2 * f.contrast,
      params: (f, dir) => ({ style: 'tiger stripe', scale: Math.round(lerp(2, 4, f.busy)), detail: 4, stretch: dir.stretch(3, 6), warp: 0.5, coverage: 26, smooth: 2, res: 200 }) },
    { label: 'Digital camo', type: 'camo', order: 'area',
      score: (f) => 0.65 * f.geometric + 0.3 * f.earthy + 0.2 * f.busy,
      params: (f, dir) => ({ style: 'digital', scale: Math.round(lerp(2, 5, f.busy)), detail: 4, stretch: dir.stretch(1.2, 2), warp: 0.5, coverage: 38, pixel: +lerp(2, 0.7, f.busy).toFixed(2) }) },
    { label: 'Flecktarn', type: 'camo', order: 'area',
      score: (f) => 0.55 * f.busy + 0.3 * f.earthy + 0.2 * (1 - f.linearity),
      params: (f) => ({ style: 'flecktarn', scale: 3, detail: 3, stretch: 1.2, warp: 0.4, coverage: 45, smooth: 2, res: 100, fleckSize: +lerp(3, 1.5, f.busy).toFixed(2), density: Math.round(lerp(20, 45, f.busy)) }) },
    { label: 'Flow field', type: 'flow', order: 'contrast',
      score: (f) => 0.6 * f.linearity + 0.3 * (1 - f.geometric) + 0.15 * (1 - f.directional),
      params: (f) => ({ scale: Math.round(lerp(1, 4, f.busy)), octaves: 2, curl: +lerp(3, 0.8, f.directional).toFixed(1), spacing: +lerp(3, 1.2, f.busy).toFixed(1), length: 60, minLength: 3, stroke: +lerp(3, 1.5, f.busy).toFixed(2), colorBy: 'by region' }) },
    { label: 'Marbled contours', type: 'contours', order: 'contrast',
      score: (f) => 0.4 * f.linearity + 0.3 * (1 - f.geometric) + 0.2 * (1 - f.busy) + 0.1 * f.contrast,
      params: (f) => ({ field: 'warped noise', waves: 4, freq: Math.round(lerp(1, 4, f.busy)), warp: +lerp(0.5, 1.2, 1 - f.directional).toFixed(2), levels: Math.round(lerp(6, 18, f.busy)), stroke: 2, res: 160 }) },
    { label: 'Wave bands', type: 'waves', order: 'area',
      score: (f) => 0.6 * f.directional + 0.2 * f.geometric + 0.2 * f.linearity + 0.25 * f.contrast,
      params: (f) => ({ shape: f.geometric > 0.5 ? 'zigzag' : 'sine', direction: f.vertical ? 'vertical' : 'horizontal', bands: Math.round(lerp(4, 14, f.busy)) || 4, freq: Math.round(lerp(2, 8, f.busy)), amp: 60, drift: 0 }) },
    { label: 'Ridgelines', type: 'ridgelines', order: 'contrast',
      score: (f) => 0.4 * f.directional * (f.horizontal ? 1 : 0.4) + 0.3 * f.linearity + 0.25 * f.contrast,
      params: (f) => ({ lines: Math.round(lerp(25, 60, f.busy)), amp: 6, scale: 3, octaves: 3, peaky: 2.5, style: f.colorful > 0.4 ? 'filled ridges' : 'lines', stroke: 1.5, cycle: f.colorful > 0.4 }) },
    { label: 'Voronoi cells', type: 'voronoi', order: 'area',
      score: (f) => 0.4 * (1 - f.linearity) + 0.3 * f.colorful + 0.2 * (1 - Math.abs(f.busy - 0.5) * 2) - 0.25 * f.geometric,
      params: (f) => ({ cells: Math.round(lerp(25, 180, f.busy)), relax: 2, gap: +lerp(8, 3, f.busy).toFixed(1), round: +lerp(8, 3, f.busy).toFixed(1), dots: false }) },
    { label: 'Circle packing', type: 'packing', order: 'area',
      score: (f) => 0.45 * f.colorful + 0.3 * (1 - f.linearity) + 0.35 * (1 - f.geometric) - 0.1,
      params: (f) => ({ style: f.contrast > 0.5 ? 'targets' : 'bands', maxR: +lerp(20, 8, f.busy).toFixed(1), minR: 1, gap: 4, rings: 4, attempts: 5000, stroke: 1.5 }) },
    { label: 'Bauhaus blocks', type: 'subdivision', order: 'area',
      score: (f) => 0.6 * f.geometric + 0.3 * f.colorful + 0.2 * (1 - f.busy),
      params: (f) => ({ depth: Math.round(lerp(4, 7, f.busy)), chance: 75, variety: 50, minSize: +lerp(8, 3, f.busy).toFixed(1), gap: 6, radius: f.geometric > 0.7 ? 0 : 6, decorate: true, empty: 10 }) },
    { label: 'Sashiko stitching', type: 'hitomezashi', order: 'contrast',
      score: (f) => 0.75 * f.geometric + 0.3 * f.busy + 0.1 * (1 - f.colorful),
      params: (f) => ({ cols: Math.round(lerp(12, 40, f.busy)), rows: Math.round(lerp(12, 40, f.busy)), bias: 50, fill: true, stitches: true, stroke: 14 }) },
    { label: 'Halftone', type: 'halftone', order: 'contrast',
      score: (f) => 0.4 * f.contrast + 0.25 * f.geometric + 0.3 * (1 - f.colorful),
      params: (f) => ({ fn: f.directional > 0.4 ? 'diagonal waves' : 'noise', freq: Math.round(lerp(1, 4, f.busy)), shape: f.geometric > 0.5 ? 'square' : 'circle', cols: Math.round(lerp(20, 48, f.busy)), rows: Math.round(lerp(20, 48, f.busy)), offset: false, minSize: 5, maxSize: 95, rotate: false, colorBy: f.colorful > 0.4, stroke: 12 }) },
    { label: 'Truchet maze', type: 'truchet', order: 'contrast',
      score: (f) => 0.3 * f.geometric + 0.3 * f.linearity + 0.2 * f.busy,
      params: (f) => ({ style: f.geometric > 0.5 ? 'diagonals' : 'arcs', cols: Math.round(lerp(6, 16, f.busy)), rows: Math.round(lerp(6, 16, f.busy)), stroke: 12, multicolor: f.colorful > 0.5 }) },
    { label: 'Scattered stars', type: 'scatter', order: 'contrast',
      score: (f) => 0.3 * f.busy + 0.2 * f.colorful + 0.1,
      params: (f) => ({ motif: 'star', points: 5, spacing: +lerp(16, 7, f.busy).toFixed(1), size: 35, jitter: 25, rotate: true }) },
  ];

  // Best-fitting ideas for an analysis. `round` (0, 1, 2, ...) adds variety for "More ideas":
  // later rounds jitter scores, pick new seeds, and favor ideas not shown recently.
  VM.suggestPatterns = (a, round = 0, count = 6) => {
    const f = a.features;
    const rnd = VM.rng(1000 + round * 7919);
    // Turn "horizontal flow" into a camo stretch (>1 = wider), or the inverse for vertical.
    const dir = {
      stretch: (lo, hi) => {
        const s = +lerp(lo, hi, f.directional).toFixed(2);
        return f.vertical && f.directional > 0.3 ? +(1 / s).toFixed(2) : f.directional > 0.3 && !f.horizontal ? +lerp(1, lo, 0.5).toFixed(2) : s;
      },
    };
    const ranked = IDEAS.map((idea, i) => ({ idea, s: idea.score(f) + (round ? (rnd() - 0.5) * 0.35 : 0) + (round ? ((i + round * 5) % IDEAS.length < count ? -0.1 : 0) : 0) }))
      .sort((p, q) => q.s - p.s);
    const picked = [];
    let camos = 0;
    for (const { idea } of ranked) {
      if (picked.length >= count) break;
      if (idea.type === 'camo' && camos >= 2) continue; // keep the set varied
      if (idea.type === 'camo') camos++;
      const params = { ...idea.params(f, dir) };
      const gen = VM.GENERATORS[idea.type];
      if (gen.params.some((d) => d.key === 'seed')) params.seed = Math.floor(rnd() * 1e6);
      picked.push({ label: idea.label, type: idea.type, params, palette: paletteFor(a, idea.order) });
    }
    return picked;
  };

  // ---- stripe suggestions
  // Stripe sets from a picture. `img` is the same small ImageData given to analyzeImage.
  // `total` is the repeat width in px; widths snap to `step` px and always sum to `total`.
  VM.suggestStripes = (a, img, { total, step, unit, round = 0 }) => {
    const pal = a.palette.slice(0, 6);
    const { width: w, height: h, data } = img;
    // Nearest palette color for every pixel (in Lab, so "nearest" matches how it looks).
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const L = rgbToLab(data[4 * i], data[4 * i + 1], data[4 * i + 2]);
      let best = 0, bd = Infinity;
      pal.forEach((p, j) => { const d = dE(L, p.lab); if (d < bd) { bd = d; best = j; } });
      idx[i] = best;
    }
    const N = Math.max(1, Math.round(total / step)); // width budget in snap steps
    // 6 decimals keeps snap sizes like 1/32 in (0.03125) exact.
    const fmt = (steps) => +((steps * step) / VM.PX_PER[unit]).toFixed(6);

    // Lengths (any scale) -> integer step counts, each at least 1, summing to N.
    const toSteps = (lens) => {
      const sum = lens.reduce((x, y) => x + y, 0);
      const st = lens.map((l) => Math.max(1, Math.round((l / sum) * N)));
      let diff = N - st.reduce((x, y) => x + y, 0);
      // Settle the rounding difference on the widest stripes.
      const order = st.map((_, i) => i).sort((i, j) => st[j] - st[i]);
      for (let k = 0; diff !== 0 && k < 1000; k++) {
        const i = order[k % order.length];
        if (diff > 0) { st[i]++; diff--; } else if (st[i] > 1) { st[i]--; diff++; }
      }
      return st;
    };
    const stripes = (runs) => { const st = toSteps(runs.map((r) => r.len)); return runs.map((r, i) => ({ color: pal[r.c].hex, width: fmt(st[i]), unit })); };

    // Walk along one axis; each position takes its most common color across a band of the
    // other axis. Runs of one color become stripes; slivers merge into their neighbors.
    function scan(across, band0, band1) {
      const len = across ? w : h, other = across ? h : w;
      const lo = Math.floor(band0 * other), hi = Math.max(lo + 1, Math.ceil(band1 * other));
      const seq = [];
      for (let p = 0; p < len; p++) {
        const counts = new Array(pal.length).fill(0);
        for (let q = lo; q < hi; q++) counts[idx[across ? q * w + p : p * w + q]]++;
        seq.push(counts.indexOf(Math.max(...counts)));
      }
      let runs = [];
      for (const c of seq) { if (runs.length && runs.at(-1).c === c) runs.at(-1).len++; else runs.push({ c, len: 1 }); }
      const minLen = len / 36, maxRuns = 24;
      while (runs.length > 1) {
        let k = 0;
        runs.forEach((r, i) => { if (r.len < runs[k].len) k = i; });
        if (runs[k].len >= minLen && runs.length <= maxRuns) break;
        // Merge the smallest run into its closer-colored neighbor.
        const L = runs[k - 1], R = runs[k + 1];
        const into = !L ? R : !R ? L : dE(pal[L.c].lab, pal[runs[k].c].lab) <= dE(pal[R.c].lab, pal[runs[k].c].lab) ? L : R;
        into.len += runs[k].len;
        runs.splice(k, 1);
        runs = runs.reduce((out, r) => { if (out.length && out.at(-1).c === r.c) out.at(-1).len += r.len; else out.push({ ...r }); return out; }, []);
      }
      return stripes(runs);
    }

    const byLight = pal.map((p, c) => ({ c, len: Math.max(p.weight, 0.03), L: p.lab[0], hue: Math.atan2(p.lab[2], p.lab[1]) }));
    const orders = [
      (x) => x.slice().sort((p, q) => q.L - p.L), // light to dark
      (x) => x.slice().sort((p, q) => q.len - p.len), // biggest first
      (x) => x.slice().sort((p, q) => p.hue - q.hue), // around the color wheel
    ];
    const ordered = orders[round % orders.length](byLight);
    // Bands to scan: the whole picture first, then thirds/quarters on later rounds.
    const bands = [[0, 1], [0.33, 0.67], [0, 0.33], [0.67, 1], [0.25, 0.5], [0.5, 0.75]];
    const band = bands[round % bands.length];
    const bandName = round % bands.length === 0 ? '' : ` (${['', 'middle', 'top', 'bottom', 'upper middle', 'lower middle'][round % bands.length]} band)`;
    const sideName = round % bands.length === 0 ? '' : ` (${['', 'middle', 'left', 'right', 'left middle', 'right middle'][round % bands.length]} band)`;

    const ideas = [
      { label: 'Scan across' + bandName, items: scan(true, band[0], band[1]) },
      { label: 'Scan down' + sideName, items: scan(false, band[0], band[1]) },
      { label: 'Color blocks', items: stripes(ordered) },
    ];
    // Mirrored: blocks then back again, without doubling the end stripe (like "Mirror").
    const half = ordered.map((r) => ({ ...r, len: r.len / 2 }));
    ideas.push({ label: 'Mirrored blocks', items: stripes([...half, ...half.slice(0, -1).reverse()]) });
    // Pinstripe: dominant color as a ground with a cluster of thin accents.
    const ground = byLight.slice().sort((p, q) => q.len - p.len)[0];
    const accents = ordered.filter((r) => r.c !== ground.c).slice(0, 3);
    if (accents.length) {
      const pin = [0.02, 0.012, 0.03][round % 3], gap = pin * 1.5;
      const runs = [{ c: ground.c, len: 1 }];
      accents.forEach((acc, i) => {
        if (i) runs.push({ c: ground.c, len: gap }); // no trailing gap: the repeat wraps into the wide ground
        runs.push({ c: acc.c, len: pin * (i === 0 ? 2 : 1) });
      });
      runs[0].len = Math.max(0.3, 1 - runs.slice(1).reduce((x, r) => x + r.len, 0));
      ideas.push({ label: 'Pinstripe ground', items: stripes(runs) });
    }
    // Scan across, then mirrored, for a symmetric take on the picture itself.
    const sc = scan(true, band[0], band[1]);
    if (sc.length > 1) {
      const runs = sc.map((s) => ({ c: pal.findIndex((p) => p.hex === s.color), len: s.width }));
      ideas.push({ label: 'Scan, mirrored', items: stripes([...runs, ...runs.slice(0, -1).reverse()]) });
    }
    return ideas;
  };
})(window.VM);
