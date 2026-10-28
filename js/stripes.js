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

  // Returns the SVG body for a tile of width W and height H. Stripes past W are clipped
  // by the caller's clip path; any space left over shows the background.
  // `assets` holds imported SVG art referenced by pattern stripes.
  VM.renderStripes = (stripes, H, assets) => {
    let x = 0;
    let body = '';
    let defs = '';
    const n = VM.n;
    const rect = (i, x0, w, fill, y0 = 0, h = H) => `<rect data-stripe="${i}" x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>`;
    stripes.forEach((s, i) => {
      const w = VM.stripeWidthPx(s);
      if (w > 0) {
        const c1 = VM.esc(s.color), c2 = VM.esc(s.color2 || s.color);
        const peak = s.shape === 'peak';
        const steps = Math.max(0, Math.round(Number(s.steps) || 0));
        const off = VM.mod((Number(s.shift) || 0) / 100, 1);
        const mix = (t) => VM.mixColor(s.color, s.color2 || s.color, t);
        if (s.kind === 'pattern') {
          // Draw the tile once, then place clipped copies across the stripe and k times down it.
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
          const under = s.pattern?.source === 'gen' && s.pattern.palette?.bg ? rect(i, x, w, VM.esc(s.pattern.palette.bg)) : '';
          body += `<g data-stripe="${i}" clip-path="url(#stripe-pat-clip-${i})">${under}${copies}</g>`;
        } else if (!s.gradient) {
          body += rect(i, x, w, c1);
        } else if (steps > 0) {
          // Solid horizontal bands, top to bottom. Fade & back samples one full up-and-down
          // cycle per tile, so the bottom band leads straight into the next tile's top band
          // (no doubled band at the seam); an even step count lands exactly on the end color.
          // The shift slides every band down, wrapping; a band that crosses the bottom
          // edge is split so its remainder continues at the top.
          for (let k = 0; k < steps; k++) {
            const t = steps === 1 ? 0 : peak ? 1 - Math.abs((2 * k) / steps - 1) : k / (steps - 1);
            const top = VM.mod(off + k / steps, 1), bottom = top + 1 / steps;
            body += rect(i, x, w, mix(t), top * H, (Math.min(1, bottom) - top) * H);
            if (bottom > 1 + 1e-9) body += rect(i, x, w, mix(t), 0, (bottom - 1) * H);
          }
        } else {
          const id = `stripe-grad-${i}`;
          const stops = shiftedStops(peak, off)
            .map(([o, t]) => `<stop offset="${n(o)}" stop-color="${t === 0 ? c1 : t === 1 ? c2 : mix(t)}"/>`).join('');
          defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>`;
          body += rect(i, x, w, `url(#${id})`);
        }
      }
      x += w;
    });
    return (defs ? `<defs>${defs}</defs>` : '') + body;
  };
})(window.VM);
