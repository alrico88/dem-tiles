# dem-tiles

## 3.1.0

### Minor Changes

- f8c8737: Adds `sampling: "bilinear"`, which interpolates the four nearest pixel heights across tile boundaries and the antimeridian. Median sampling is about 3x faster and no longer depends on `math-helper-functions`.

### Patch Changes

- 69e1922: Builds with Vite+ (`vp pack`). `require("dem-tiles")` now loads a real CommonJS build instead of a UMD file Node treated as ESM. The UMD build stays available for CDNs as `dist/index.umd.js`, and type declarations keep their JSDoc.

## 3.0.0

### Major Changes

- 50f765c: Constructors now take `(url, options)`: `tileSize` is removed (the decoded image size is used) and `minzoom`, `maxzoom` and `tms` move into options. `tileCache` values are now `DecodedTile`, and undecodable tiles reject instead of resolving to `undefined`. Adds a pluggable `decode` option.

  Fixes TMS lookups, low-zoom and tile-edge pixel errors, rejected `.pngraw`/extensionless URLs, color-managed decoding altering RGB values, uncached 404s and mismatched tile sizes.

## 2.1.1

### Patch Changes

- 3de148a: fix: removed png.ts and pako to fetch PNG tiles by the same approarch of webp with canvas api.

## 2.1.0

### Minor Changes

- 109d0ed: feat: add support of terrarium encoding.

## 2.0.2

### Patch Changes

- 381aba3: fix: fixed bug of v2 package to use canvas api for webp feature. also switched vitest to playwright to test computation in browser.
