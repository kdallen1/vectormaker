// Abstract paint: multi-color splotches, impressionistic brushstrokes, and cut-paper shapes.
// Every mark is wrapped across the tile edges, so the tile repeats seamlessly.
(function (VM) {
  const TAU = Math.PI * 2;
  const n = VM.n;

  // Smooth closed curve through the midpoints of a polygon's edges, with the corners as
  // quadratic control points.
  function smoothPath(pts) {
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const m0 = mid(pts[pts.length - 1], pts[0]);
    let d = `M${n(m0[0])} ${n(m0[1])}`;
    for (let i = 0; i < pts.length; i++) {
      const c = pts[i], m = mid(pts[i], pts[(i + 1) % pts.length]);
      d += `Q${n(c[0])} ${n(c[1])} ${n(m[0])} ${n(m[1])}`;
    }
    return d + 'Z';
  }

  // An organic blob: a circle whose radius wobbles with a few low harmonics.
  function blobPts(rnd, cx, cy, R, wobble = 0.25, k = 12) {
    const harm = [2, 3, 4].map((f) => ({ f, a: wobble * (0.4 + rnd()) / f, p: rnd() * TAU }));
    const pts = [];
    for (let i = 0; i < k; i++) {
      const t = (i / k) * TAU;
      let r = 1;
      for (const h of harm) r += h.a * Math.sin(h.f * t + h.p);
      r *= 1 + (rnd() - 0.5) * wobble * 0.3;
      pts.push([cx + Math.cos(t) * R * r, cy + Math.sin(t) * R * r]);
    }
    return pts;
  }

  const STYLE_PARAMS = {
    splotches: ['splatter', 'drips'],
    brushstrokes: ['length', 'flow', 'direction', 'bristles', 'underpaint'],
    shapes: ['shadow', 'outline'],
    mixed: ['splatter', 'length', 'flow', 'bristles', 'underpaint', 'shadow'],
  };
  const forStyles = (key) => Object.keys(STYLE_PARAMS).filter((s) => STYLE_PARAMS[s].includes(key));

  const abstract = {
    name: 'Abstract paint',
    blurb: 'Multi-color abstract art: paint splotches with splatter and drips, impressionistic brushstrokes over an underpainting, or cut-paper shapes. Uses every ink color; "Color variety" tints each mark for a painterly feel.',
    params: [
      { key: 'style', label: 'Style', type: 'select', options: Object.keys(STYLE_PARAMS), default: 'splotches' },
      { key: 'density', label: 'Density', type: 'float', min: 1, max: 100, step: 1, default: 30 },
      { key: 'size', label: 'Mark size (% of tile)', type: 'float', min: 1, max: 40, step: 0.5, default: 9 },
      { key: 'sizeVar', label: 'Size variety (%)', type: 'float', min: 0, max: 90, step: 1, default: 60 },
      { key: 'colorVar', label: 'Color variety (%)', type: 'float', min: 0, max: 100, step: 1, default: 30 },
      { key: 'splatter', label: 'Splatter droplets', type: 'float', min: 0, max: 100, step: 1, default: 40, when: { style: forStyles('splatter') } },
      { key: 'drips', label: 'Drips (%)', type: 'float', min: 0, max: 100, step: 1, default: 25, when: { style: forStyles('drips') } },
      { key: 'length', label: 'Stroke length (× width)', type: 'float', min: 1, max: 12, step: 0.1, default: 4, when: { style: forStyles('length') } },
      { key: 'flow', label: 'Swirl', type: 'float', min: 0, max: 4, step: 0.05, default: 1.2, when: { style: forStyles('flow') } },
      { key: 'direction', label: 'Stroke direction', type: 'select', options: ['flowing', 'horizontal', 'vertical', 'diagonal', 'any'], default: 'flowing', when: { style: forStyles('direction') } },
      { key: 'bristles', label: 'Bristle streaks', type: 'bool', default: true, when: { style: forStyles('bristles') } },
      { key: 'underpaint', label: 'Soft underpainting', type: 'bool', default: true, when: { style: forStyles('underpaint') } },
      { key: 'shadow', label: 'Drop shadows', type: 'bool', default: false, when: { style: forStyles('shadow') } },
      { key: 'outline', label: 'Outlined shapes (%)', type: 'float', min: 0, max: 100, step: 1, default: 15, when: { style: forStyles('outline') } },
      { key: 'seed', label: 'Seed', type: 'seed', default: 1 },
    ],
    render(W, H, p, pal) {
      const rnd = VM.rng(p.seed);
      const S = Math.min(W, H);
      const inks = pal.colors.length ? pal.colors : ['#000000'];
      const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
      // Each mark's color: a palette ink, nudged toward another ink, white, or black.
      const paint = () => {
        let c = pick(inks);
        if (p.colorVar > 0) {
          const r = rnd();
          const toward = r < 0.5 ? pick([...inks, pal.bg]) : r < 0.75 ? '#ffffff' : '#000000';
          c = VM.mixColor(c, toward, rnd() * (p.colorVar / 100) * (r < 0.5 ? 0.7 : 0.35));
        }
        return c;
      };
      const markR = () => (S * p.size) / 100 * (1 - (p.sizeVar / 100) * rnd()) / 2;
      const count = (k) => Math.max(1, Math.round(((p.density * W * H) / (S * S)) * k));
      const flowField = VM.noise(p.seed + 5, W, H, 2, 2);
      const marks = []; // [layer, svg] — lower layers drawn first
      const put = (layer, box, svg) => marks.push([layer, VM.wrap(W, H, box, svg)]);

      const underpainting = () => {
        // Big soft washes of muted color, the bottom layer of an impressionist canvas.
        for (let k = 0; k < Math.max(6, count(0.3)); k++) {
          const cx = rnd() * W, cy = rnd() * H, R = S * (0.07 + rnd() * 0.1);
          const pts = blobPts(rnd, cx, cy, R, 0.35, 10);
          put(0, VM.boxOf(pts), `<path d="${smoothPath(pts)}" fill="${VM.mixColor(paint(), pal.bg, 0.6)}"/>`);
        }
      };

      const splotch = (layer) => {
        const cx = rnd() * W, cy = rnd() * H, R = markR() * 1.5, c = paint();
        const pts = blobPts(rnd, cx, cy, R, 0.3, 12);
        let svg = `<path d="${smoothPath(pts)}" fill="${c}"/>`;
        let box = VM.boxOf(pts);
        // Splatter: droplets flung outward, smaller the farther they land.
        const drops = Math.round((p.splatter / 100) * 10 * rnd());
        for (let k = 0; k < drops; k++) {
          const a = rnd() * TAU, dist = R * (1.15 + rnd() * 1.4), r = R * (0.03 + 0.12 * rnd()) * (2.6 - dist / R) / 1.5;
          const x = cx + Math.cos(a) * dist, y = cy + Math.sin(a) * dist;
          svg += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(Math.max(0.4, r))}" fill="${c}"/>`;
          box = { x0: Math.min(box.x0, x - r), y0: Math.min(box.y0, y - r), x1: Math.max(box.x1, x + r), y1: Math.max(box.y1, y + r) };
        }
        // Drip: a tapering run of paint ending in a bead.
        if (p.drips && rnd() * 100 < p.drips) {
          const x = cx + (rnd() - 0.5) * R * 0.8, y0 = cy + R * 0.5, len = R * (0.8 + rnd() * 1.8), w = R * (0.1 + rnd() * 0.08);
          svg += `<path d="M${n(x - w)} ${n(y0)}L${n(x + w)} ${n(y0)}L${n(x + w * 0.55)} ${n(y0 + len)}L${n(x - w * 0.55)} ${n(y0 + len)}Z" fill="${c}"/><circle cx="${n(x)}" cy="${n(y0 + len)}" r="${n(w * 0.9)}" fill="${c}"/>`;
          box.y1 = Math.max(box.y1, y0 + len + w);
        }
        put(layer, box, svg);
      };

      const stroke = (layer) => {
        // A tapered dab following the flow field (or a fixed direction), with bristle streaks.
        const w = markR() * 0.9, c = paint();
        const L = w * p.length * (0.7 + 0.6 * rnd());
        const steps = 10;
        const fixed = { horizontal: 0, vertical: Math.PI / 2, diagonal: -Math.PI / 4 }[p.direction];
        let x = rnd() * W, y = rnd() * H;
        let ang = p.direction === 'any' ? rnd() * TAU : fixed ?? flowField(x, y) * Math.PI * p.flow;
        const center = [[x, y]];
        for (let s = 0; s < steps; s++) {
          const target = p.direction === 'flowing' || p.style === 'mixed' ? flowField(x, y) * Math.PI * p.flow : ang + (rnd() - 0.5) * 0.25;
          ang += (target - ang) * 0.5;
          x += Math.cos(ang) * (L / steps); y += Math.sin(ang) * (L / steps);
          center.push([x, y]);
        }
        // Width swells and tapers, a little uneven like a loaded brush.
        const left = [], right = [];
        center.forEach(([cx, cy], i) => {
          const t = i / steps, [ax, ay] = center[Math.max(0, i - 1)], [bx, by] = center[Math.min(steps, i + 1)];
          const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const hw = (w / 2) * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.5)) * (0.9 + 0.2 * rnd());
          left.push([cx + nx * hw, cy + ny * hw]); right.push([cx - nx * hw, cy - ny * hw]);
        });
        const outline = [...left, ...right.reverse()];
        let svg = `<path d="${smoothPath(outline)}" fill="${c}"/>`;
        if (p.bristles) {
          // Thin lighter and darker streaks along the stroke.
          for (const [off, tint] of [[-0.25, '#ffffff'], [0.15, '#000000'], [0.32, '#ffffff']]) {
            const line = center.slice(1, -1).map(([cx, cy], i) => {
              const [ax, ay] = center[i], [bx, by] = center[i + 2], len = Math.hypot(bx - ax, by - ay) || 1;
              return [cx - ((by - ay) / len) * off * w, cy + ((bx - ax) / len) * off * w];
            });
            svg += `<path d="${VM.polyPath(line)}" fill="none" stroke="${VM.mixColor(c, tint, 0.18 + rnd() * 0.12)}" stroke-width="${n(w * 0.09)}" stroke-linecap="round" stroke-linejoin="round"/>`;
          }
        }
        put(layer, VM.boxOf(outline, w * 0.1), svg);
      };

      const shape = (layer) => {
        const cx = rnd() * W, cy = rnd() * H, R = markR() * 1.2, c = paint(), rot = rnd() * 360;
        const kind = pick(['circle', 'ring', 'halfmoon', 'triangle', 'squiggle', 'blob', 'arcs', 'confetti', 'circle', 'blob']);
        const outlined = p.outline && rnd() * 100 < p.outline && ['circle', 'triangle', 'blob', 'halfmoon'].includes(kind);
        const fillAttr = outlined ? `fill="none" stroke="${c}" stroke-width="${n(R * 0.12)}" stroke-linejoin="round"` : `fill="${c}"`;
        let svg = '';
        if (kind === 'circle') svg = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 0.8)}" ${fillAttr}/>`;
        else if (kind === 'ring') svg = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 0.7)}" fill="none" stroke="${c}" stroke-width="${n(R * 0.28)}"/>`;
        else if (kind === 'halfmoon') svg = `<path d="M${n(cx - R)} ${n(cy)}A${n(R)} ${n(R)} 0 0 1 ${n(cx + R)} ${n(cy)}Z" ${fillAttr} transform="rotate(${n(rot)} ${n(cx)} ${n(cy)})"/>`;
        else if (kind === 'triangle') {
          const pts = [0, 1, 2].map((i) => { const a = (rot * Math.PI) / 180 + (i * TAU) / 3; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R]; });
          svg = `<path d="${VM.polyPath(pts, true)}" ${fillAttr}/>`;
        } else if (kind === 'squiggle') {
          const pts = Array.from({ length: 25 }, (_, i) => { const t = i / 24; return [cx - R * 1.2 + t * R * 2.4, cy + Math.sin(t * TAU * 1.5) * R * 0.3]; });
          svg = `<path d="${VM.polyPath(pts)}" fill="none" stroke="${c}" stroke-width="${n(R * 0.22)}" stroke-linecap="round" stroke-linejoin="round" transform="rotate(${n(rot)} ${n(cx)} ${n(cy)})"/>`;
        } else if (kind === 'blob') svg = `<path d="${smoothPath(blobPts(rnd, cx, cy, R * 0.85, 0.35, 10))}" ${fillAttr}/>`;
        else if (kind === 'arcs') {
          // Nested rainbow arcs in three colors.
          for (let k = 0; k < 3; k++) {
            const r = R * (1 - k * 0.3);
            svg += `<path d="M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 0 1 ${n(cx + r)} ${n(cy)}" fill="none" stroke="${k ? paint() : c}" stroke-width="${n(R * 0.24)}" transform="rotate(${n(rot)} ${n(cx)} ${n(cy)})"/>`;
          }
        } else {
          const w = R * 0.5, h = R * 0.18;
          svg = `<rect x="${n(cx - w / 2)}" y="${n(cy - h / 2)}" width="${n(w)}" height="${n(h)}" fill="${c}" transform="rotate(${n(rot)} ${n(cx)} ${n(cy)})"/>`;
        }
        if (p.shadow) {
          // The same shape, offset and darkened, drawn underneath.
          const off = R * 0.12, dark = VM.mixColor(pal.bg, '#000000', 0.35);
          const shadowSvg = svg.replace(/(fill|stroke)="#[0-9a-f]{6}"/gi, (_, attr) => `${attr}="${dark}"`);
          svg = `<g transform="translate(${n(off)} ${n(off)})">${shadowSvg}</g>${svg}`;
        }
        const pad = R * 1.5;
        put(layer, { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad }, svg);
      };

      if (p.style === 'splotches') {
        for (let k = 0; k < count(1); k++) splotch(1);
      } else if (p.style === 'brushstrokes') {
        if (p.underpaint) underpainting();
        for (let k = 0; k < count(10); k++) stroke(1);
      } else if (p.style === 'shapes') {
        for (let k = 0; k < count(2); k++) shape(1);
      } else {
        if (p.underpaint) underpainting();
        for (let k = 0; k < count(5); k++) stroke(1);
        for (let k = 0; k < count(0.35); k++) splotch(2);
        for (let k = 0; k < count(0.35); k++) shape(3);
      }
      return marks.sort((a, b) => a[0] - b[0]).map((m) => m[1]).join('');
    },
  };

  VM.GENERATORS.abstract = abstract;
})(window.VM);
