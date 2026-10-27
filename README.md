# vectormaker

A small browser tool for Lefty's Western Wear that designs repeating shirt patterns and exports them as SVG.

## Running it

Open `index.html` in Chrome, Safari, or Firefox. There's nothing to install and no build step. Your work is autosaved in the browser. **Save project** writes a `.json` file you can reopen later with **Open…**.

## Modes

**Stripes.** Build an inventory of vertical stripes. Each stripe has its own color and width (px, in, or cm). **+ Add stripe** stacks a new stripe flush against the right edge. You can reorder, duplicate, or delete stripes, and **Mirror** makes a symmetric repeat. By default the canvas width equals the total stripe width, so the exported tile repeats seamlessly.

**Generative.** Math-driven patterns that always tile:

| Pattern | Idea |
| --- | --- |
| Truchet tiles | Randomly rotated tiles (arcs, diagonals, triangles) whose lines meet at every edge |
| Contour lines | Topographic contours of interfering waves, tileable Perlin noise, or domain-warped noise |
| Spirograph rosettes | Hypotrochoid, rose, and Lissajous curves on a grid, half-drop, or brick layout |
| Wave bands | Filled sine, zigzag, scallop, or square-wave bands, horizontal or vertical |
| Scattered motifs | Stars, sparkles, diamonds, or dots spaced with Poisson-disk sampling on a torus |
| Hitomezashi stitching | Japanese sashiko stitches, with the enclosed regions optionally filled in two colors |
| Flow field | Evenly spaced streamlines through a tileable noise field |
| Circle packing | Non-overlapping circles drawn as targets, bands, solids, or outlines |
| Voronoi cells | Stained-glass or pebble cells with gaps and rounded corners |
| Halftone field | A tixy.land-style grid of shapes sized and rotated by a math function |
| Recursive subdivision | Bauhaus/Mondrian-style blocks decorated with circles, half-moons, and stripes |
| Ridgelines | Stacked noise ridges in the *Unknown Pleasures* style, each hiding the ones behind it |

Anything that crosses a tile edge is also drawn on the opposite edge, and the export is clipped to the tile.

## Export details

- Coordinates are in px at 96 px/in (the SVG standard). The `width` and `height` attributes use your chosen unit, so an 8 in tile opens as 8 in in Illustrator or Inkscape.
- Use **Preview repeats** (2×2, 3×3, 5×5) to check the seams before exporting.

## Code layout

- `js/util.js`: units, seeded RNG, seamless-wrap helper, tileable Perlin noise
- `js/stripes.js`: stripe rendering
- `js/generators.js`, `js/generators-art.js`: generative patterns. Each one declares its `params` (the UI is built from these) and a `render(W, H, params, palette)` function, so a new pattern is one object.
- `js/app.js`: state, panels, preview, save/open/export
