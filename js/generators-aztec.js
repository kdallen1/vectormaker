// Aztec / Southwestern blanket bands: bands of grid-based motifs (stepped diamonds, chevrons,
// stepped mountains, crosses, hourglasses, arrows, checks, pinstripes) like a woven serape.
// Everything is drawn on a cell grid and output as merged rectangles, so it's crisp to print.
(function (VM) {
  const n = VM.n;

  // Motifs: (x, y, w, h, t) -> slot, for a cell in one motif repeat that is w cells wide and
  // h tall. Slot 0 = the band's ground, 1 and 2 = its two ink colors. `width(h)` is the
  // natural repeat width; t is a small per-band variation (0 or 1).
  const MOTIFS = {
    solid: { width: () => 1, cell: () => 0 },
    pinstripe: { width: () => 1, cell: (x, y) => (y % 2 ? 0 : 1) },
    checks: { width: () => 2, cell: (x, y) => ((x + y) % 2 ? 1 : 0) },
    dots: { width: () => 4, cell: (x, y, w, h) => (x % 4 === 1 && y === Math.floor(h / 2) ? 1 : 0) },
    diamonds: {
      // Concentric stepped diamonds, rings alternating ink colors, one gap column between.
      width: (h) => h + 1,
      cell: (x, y, w, h, t) => {
        if (x === h) return 0;
        const c = (h - 1) / 2, d = Math.abs(x - c) + Math.abs(y - c);
        if (d > c) return 0;
        const ring = Math.round(c - d);
        return t ? (ring % 2 ? 0 : 1 + ((ring / 2) % 2)) : 1 + (ring % 2);
      },
    },
    chevrons: {
      // Zigzag band: a thick line bouncing between top and bottom, with an echo line.
      width: (h) => Math.max(2, 2 * (h - 1)),
      cell: (x, y, w, h, t) => {
        const half = w / 2, yl = (h - 1) * (1 - Math.abs((x % w) - half + 0.5) / half);
        const th = Math.max(1, Math.round(h / 5));
        if (Math.abs(y - yl) < th) return 1;
        if (t && Math.abs(y - yl + 2 * th) < th * 0.6) return 2;
        return 0;
      },
    },
    mountains: {
      // Stepped pyramids pointing up, with a smaller inner pyramid.
      width: (h) => 2 * h,
      cell: (x, y, w, h) => {
        const c = h - 0.5, dx = Math.abs(x - c);
        if (dx > y + 0.5) return 0;
        return dx <= y - 2.5 && y > 2 ? 2 : 1;
      },
    },
    hourglass: {
      width: (h) => h + 1,
      cell: (x, y, w, h) => {
        if (x === h) return 0;
        const c = (h - 1) / 2, dx = Math.abs(x - c), dy = Math.abs(y - c);
        if (dx > dy) return 0;
        return dx === 0 && dy === 0 ? 2 : dy - dx < 1.5 ? 2 : 1;
      },
    },
    crosses: {
      // Plus signs with a contrasting center.
      width: (h) => h + 2,
      cell: (x, y, w, h) => {
        if (x >= h) return 0;
        const c = (h - 1) / 2, a = Math.max(0.5, h / 6);
        const dx = Math.abs(x - c), dy = Math.abs(y - c);
        if (dx < a && dy < a) return 2;
        return (dx < a && dy <= c) || (dy < a && dx <= c) ? 1 : 0;
      },
    },
    arrows: {
      // Feathered arrowheads pointing along the band.
      width: (h) => h,
      cell: (x, y, w, h) => {
        const c = (h - 1) / 2, dy = Math.abs(y - c);
        const v = Math.abs(dy - x);
        return v < 1 ? 1 : Math.abs(dy - x + Math.max(2, h / 3)) < 1 ? 2 : 0;
      },
    },
    stairs: {
      // A stepped meander line climbing and descending.
      width: (h) => 2 * h,
      cell: (x, y, w, h) => {
        const s = Math.max(1, Math.round(h / 4));
        const climb = x < h ? Math.floor(x / s) * s : Math.floor((2 * h - 1 - x) / s) * s;
        return Math.abs(h - 1 - y - climb) < s ? 1 : 0;
      },
    },
  };
  const FEATURES = ['diamonds', 'chevrons', 'mountains', 'hourglass', 'crosses', 'arrows', 'stairs'];
  const ACCENTS = ['pinstripe', 'checks', 'dots'];
  const STYLES = {
    blanket: FEATURES,
    diamonds: ['diamonds', 'diamonds', 'hourglass', 'crosses'],
    chevrons: ['chevrons', 'chevrons', 'arrows', 'stairs'],
    mountains: ['mountains', 'mountains', 'stairs', 'diamonds'],
  };

  const aztec = {
    name: 'Aztec / Southwestern bands',
    blurb: 'Blanket-style bands of stepped diamonds, chevrons, mountains, crosses, arrows, and more, built on a grid like weaving. "Serape" mirrors the bands like a Mexican blanket. Exports as crisp rectangles.',
    params: [
      { key: 'style', label: 'Motif mix', type: 'select', options: Object.keys(STYLES), default: 'blanket' },
      { key: 'direction', label: 'Bands run', type: 'select', options: ['horizontal', 'vertical'], default: 'horizontal' },
      { key: 'rows', label: 'Grid rows (detail)', type: 'int', min: 20, max: 300, default: 90 },
      { key: 'motifSize', label: 'Motif height (cells)', type: 'int', min: 3, max: 41, default: 11 },
      { key: 'busy', label: 'Accent bands (%)', type: 'float', min: 0, max: 100, step: 1, default: 50 },
      { key: 'solid', label: 'Plain stripe bands (%)', type: 'float', min: 0, max: 100, step: 1, default: 40 },
      { key: 'mirror', label: 'Serape mirror (bands repeat in reverse)', type: 'bool', default: true },
      { key: 'seed', label: 'Seed', type: 'seed', default: 1 },
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      const vertical = p.direction === 'vertical';
      // Work with bands running along L, stacked across A; swap at the end for vertical.
      const L = vertical ? H : W, A = vertical ? W : H;
      const R = Math.max(4, p.rows);
      const ch = A / R; // cell height
      const C = Math.max(1, Math.round(L / ch)); // cells along a band (square-ish cells)
      const inks = pal.colors.length ? pal.colors : ['#000000'];
      const colorsAll = [pal.bg, ...inks];
      const pickInk = (not) => { const c = inks.filter((k) => !not.includes(k)); return c.length ? c[Math.floor(rnd() * c.length)] : inks[Math.floor(rnd() * inks.length)]; };
      const odd = (v) => Math.max(1, v % 2 ? v : v + 1);

      // Bands for one pass: feature motifs separated by accents and plain stripes.
      const makeBand = (maxH) => {
        const r = rnd();
        let motif, h;
        if (r < p.solid / 100 * 0.5) { motif = 'solid'; h = 1 + Math.floor(rnd() * 3); }
        else if (r < 0.5 * (p.solid / 100 + p.busy / 100)) { motif = ACCENTS[Math.floor(rnd() * ACCENTS.length)]; h = motif === 'pinstripe' ? 3 : motif === 'dots' ? 3 : 2; }
        else { const list = STYLES[p.style]; motif = list[Math.floor(rnd() * list.length)]; h = odd(p.motifSize + Math.round((rnd() - 0.5) * p.motifSize * 0.4)); }
        h = Math.min(h, maxH);
        if (h < 3 && FEATURES.includes(motif)) motif = 'solid';
        const ground = rnd() < 0.7 ? pal.bg : pickInk([]);
        const a = pickInk([ground]), b = pickInk([ground, a]);
        return { motif, h, slots: [ground, a, b], t: rnd() < 0.5 ? 1 : 0 };
      };
      let bands = [];
      if (p.mirror) {
        // Half the bands, a center band, then the half again in reverse.
        const half = Math.floor((R - 1) / 2);
        let used = 0;
        while (used < half) { const b = makeBand(half - used); bands.push(b); used += b.h; }
        const centerH = R - 2 * used;
        const center = makeBand(centerH);
        center.h = centerH;
        if (centerH < 3 && FEATURES.includes(center.motif)) center.motif = 'solid';
        bands = [...bands, ...(centerH > 0 ? [center] : []), ...bands.slice().reverse()];
      } else {
        let used = 0;
        while (used < R) { const b = makeBand(R - used); bands.push(b); used += b.h; }
      }

      // Draw: each band row is run-length encoded into rectangles; identical runs that
      // continue straight down merge into one taller rectangle.
      const rects = [];
      const open = new Map();
      const emit = (x, w, y, h, fill) => {
        const key = `${n(x)}|${n(w)}|${fill}`;
        const prev = open.get(key);
        if (prev && Math.abs(prev.y + prev.h - y) < 1e-6) { prev.h += h; return; }
        const r = { x, w, y, h, fill };
        open.set(key, r); rects.push(r);
      };
      let row = 0;
      for (const band of bands) {
        const M = MOTIFS[band.motif];
        const mw = Math.max(1, M.width(band.h));
        const reps = Math.max(1, Math.round(C / mw)); // whole repeats across the tile
        const cells = reps * mw, cw = L / cells; // motif stretches a little to fit exactly
        for (let y = 0; y < band.h; y++, row++) {
          let runStart = 0, runSlot = -1;
          for (let x = 0; x <= cells; x++) {
            const slot = x < cells ? M.cell(x % mw, y, mw, band.h, band.t) : -2;
            if (slot !== runSlot) {
              if (runSlot >= 0 && x > runStart) emit(runStart * cw, (x - runStart) * cw, row * ch, ch, band.slots[runSlot] || colorsAll[0]);
              runStart = x; runSlot = slot;
            }
          }
        }
      }
      return rects.map((r) => (vertical
        ? `<rect x="${n(r.y)}" y="${n(r.x)}" width="${n(r.h)}" height="${n(r.w)}" fill="${r.fill}"/>`
        : `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="${r.fill}"/>`)).join('');
    },
  };

  VM.GENERATORS.aztec = aztec;
})(window.VM);
