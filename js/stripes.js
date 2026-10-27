// Vertical stripes: each stripe is a full-height box placed flush against the previous one.
(function (VM) {
  VM.stripeWidthPx = (s) => Math.max(0, VM.toPx(Number(s.width) || 0, s.unit));

  VM.stripesTotalPx = (stripes) => stripes.reduce((sum, s) => sum + VM.stripeWidthPx(s), 0);

  // Returns the SVG body for a tile of width W and height H. Stripes past W are clipped
  // by the caller's clip path; any space left over shows the background.
  VM.renderStripes = (stripes, H) => {
    let x = 0;
    let body = '';
    stripes.forEach((s, i) => {
      const w = VM.stripeWidthPx(s);
      if (w > 0) {
        body += `<rect data-stripe="${i}" x="${VM.n(x)}" y="0" width="${VM.n(w)}" height="${VM.n(H)}" fill="${VM.esc(s.color)}"/>`;
      }
      x += w;
    });
    return body;
  };
})(window.VM);
