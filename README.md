# vectormaker

A small browser tool for Lefty's Western Wear that designs repeating shirt patterns and exports them as SVG.

## Running it

Open `index.html` in Chrome, Safari, or Firefox. There's nothing to install and no build step. Your work is autosaved in the browser. **Save project** writes a `.json` file you can reopen later with **Open…**.

## Modes

**Stripes.** Build an inventory of vertical stripes. Each stripe has its own color and width (px, in, or cm). **+ Add stripe** stacks a new stripe flush against the right edge. You can reorder, duplicate, or delete stripes, and **Mirror** makes a symmetric repeat. By default the canvas width equals the total stripe width, so the exported tile repeats seamlessly.

Stripes can also fade top to bottom (◐), with a wrapping vertical shift. A fade's **look** can be:
- **smooth**
- **steps**
- **dither**: Bayer, noise, or diffusion, with adjustable levels and pixel size. More levels gives a pixelated ramp.
- **halftone** dots
- **lines**

Everything except smooth is built from solid-color shapes, which is handy for screen printing. They can also be filled with a pattern: **Use as stripe →** in Generative mode (or **+ Pattern stripe**) adds the current generative pattern, and **Import…** takes a saved project (`.json`) or any SVG. A pattern stripe repeats its tile a whole number of times down the stripe, so it always tiles. Generated patterns can be reseeded or opened with **Edit** and saved back.

**Effects** layer on top of the stripe list, and all of them keep the tile seamless:
- **Glitch slices:** random horizontal slices shift sideways and can swap colors.
- **Ikat edges:** feathered, jagged edges like hand-dyed cloth.
- **Plaid:** crosses the stripes with themselves horizontally. The tile height then follows the stripe total.

Effects apply to solid and gradient stripes; pattern stripes are left as they are.

**Generative.** Math-driven patterns that always tile:

| Pattern | Idea |
| --- | --- |
| Truchet tiles | Randomly rotated tiles (arcs, diagonals, triangles) whose lines meet at every edge |
| Contour lines | Topographic contours of interfering waves, tileable Perlin noise, or domain-warped noise |
| Spirograph rosettes | Hypotrochoid, rose, and Lissajous curves on a grid, half-drop, or brick layout |
| Wave bands | Filled bands with sine, zigzag, scallop, arches, square, sawtooth, stepped, or noise edges, plus harmonics, mirrored edges, amplitude swell, uneven bands, wobble, and outlines |
| Scattered motifs | Stars, sparkles, diamonds, or dots spaced with Poisson-disk sampling on a torus |
| Hitomezashi stitching | Japanese sashiko stitches, with the enclosed regions optionally filled in two colors |
| Flow field | Evenly spaced streamlines through a tileable noise field |
| Circle packing | Non-overlapping circles drawn as targets, bands, solids, or outlines |
| Voronoi cells | Stained-glass or pebble cells with gaps and rounded corners |
| Halftone field | A tixy.land-style grid of shapes sized and rotated by a math function |
| Recursive subdivision | Bauhaus/Mondrian-style blocks decorated with circles, half-moons, and stripes |
| Ridgelines | Stacked noise ridges in the *Unknown Pleasures* style, each hiding the ones behind it |
| Camouflage | Woodland, tiger stripe, digital, splinter, flecktarn, and chocolate-chip camo. Each ink color is one layer |
| Aztec / Southwestern bands | Blanket-style bands of stepped diamonds, chevrons, mountains, crosses, arrows, checks, and pinstripes on a weaving grid, optionally mirrored like a serape. Exports as rectangles |

Anything that crosses a tile edge is also drawn on the opposite edge, and the export is clipped to the tile.

**Inspire from a picture.** Load a photo (JPG or PNG) in either mode. The app reads its palette and character: busy or calm, the direction of its lines, blotchy or line-like, geometric or organic, colorful, high-contrast, earthy.
- In **Generative** mode it suggests six patterns tuned to the photo and colored with its palette.
- In **Stripes** mode it suggests six stripe sets at a repeat width you choose. "Scan" sets read the photo's colors in order, left to right or top to bottom; the others use its palette as color blocks, mirrored blocks, or pinstripes on a ground.

**More ideas** gives a fresh set. The picture stays in the browser and isn't saved with the project.

HEIC photos (iPhone) work too. Safari reads them natively; in other browsers the app loads a bundled decoder the first time you pick one.

## Export details

- Coordinates use Illustrator's convention of 72 px per inch, so a 40 px stripe opens in Illustrator as exactly 40 px. The page size is written in points (1/72 in), the same numbers as the coordinates, so an 8 in tile opens as exactly 8 in with no rescaling.
- The export only adds a clipping mask when shapes actually spill past the tile edge (generative patterns and pattern stripes). Plain stripes come out as plain rectangles.
- Use **Preview repeats** (2×2, 3×3, 5×5) to check the seams before exporting.

## Third-party code

- `vendor/heic-to.js`: [heic-to](https://github.com/hoppergee/heic-to) 1.5.2 (the `dist/iife` build), a browser build of libheif used to decode HEIC photos. Licensed LGPL-3.0; see `vendor/heic-to.LICENSE`. It's only loaded when a HEIC photo is picked in a browser that can't read HEIC itself. To update it, replace the file with the `dist/iife/heic-to.js` from a newer release.

## Code layout

- `js/util.js`: units, seeded RNG, seamless-wrap helper, tileable Perlin noise
- `js/stripes.js`: stripe rendering
- `js/generators.js`, `js/generators-art.js`, `js/generators-camo.js`, `js/generators-aztec.js`: generative patterns. Each one declares its `params` (the UI is built from these) and a `render(W, H, params, palette)` function, so a new pattern is one object.
- `js/inspire.js`: picture analysis and pattern/stripe suggestions
- `js/app.js`: state, panels, preview, save/open/export
