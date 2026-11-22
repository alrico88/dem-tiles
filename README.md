# dem-tiles

> Fork of [@watergis/terrain-rgb](https://github.com/watergis/terrain-rgb) by Jin IGARASHI, with performance improvements and additional sampling modes.

Decode elevation from Terrain RGB and Terrarium raster tile sets by longitude and latitude or by tile.

## What's different from upstream

- **Median filter sampling** — median elevation from a configurable pixel window, reducing noise from resampled/gdal2tiles tilesets.
- **`createImageBitmap` decoding** — uses the browser-native [`createImageBitmap`](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap) API instead of `HTMLImageElement` + Object URLs. Faster decoding, no dangling object URLs.
- **OffscreenCanvas support** — uses `OffscreenCanvas` when available, otherwise falls back to `<canvas>`.
- **O(1) pixel lookup** — computes RGBA byte offset directly, no intermediate `Array<[r,g,b,a]>` allocation.
- **In-flight request deduplication** — multiple lookups on the same tile share one fetch + decode promise.
- **Batch `getElevations`** — group coordinates by tile to minimize fetch/decode work.
- **Exact pixel lookup** — tile and pixel come from the same Web Mercator projection, so lookups are accurate at any zoom, on tile edges and for TMS.
- **Raw decoding** — color management and alpha premultiplication are disabled, so tiles with gamma or ICC metadata decode to their true values. Canvas reads can still be perturbed by privacy modes; see [Canvas-free decoding](#canvas-free-decoding).
- **Pluggable decoder** — pass `decode` to use the library outside the browser.

## Install

```
npm i dem-tiles
```

## Usage

```ts
import { TerrainRGB, Terrarium, type DecodedTile } from "dem-tiles";
import { LRUCache } from "lru-cache";

const url = "https://wasac.github.io/rw-terrain/tiles/{z}/{x}/{y}.png";
const tileCache = new LRUCache<string, DecodedTile>({ max: 500 });

// Default: nearest-neighbor sampling
const trgb = new TerrainRGB(url, { tileCache });
const elevation = await trgb.getElevation([30.0529622, -1.9575129], 15);

// Median filter sampling (3x3 window)
const trgbMedian = new TerrainRGB(url, {
  tileCache,
  sampling: "median",
  sampleRadius: 1,
});

// Terrarium tileset
const terrarium = new Terrarium("https://tiles.mapterhorn.com/{z}/{x}/{y}.webp", {
  maxzoom: 17,
  tileCache,
});

// Batch lookup — coordinates sharing the same tile reuse one decoded buffer
const elevations = await trgb.getElevations(
  [
    [30.0529622, -1.9575129],
    [30.05297, -1.9576],
  ],
  15,
);

// Read every pixel in the tile
const tile = await trgb.getTileElevations(15, 19119, 16562);
if (tile) {
  const { width, height, elevations } = tile;
  console.log(width, height, elevations[0]);
}
```

TMS tilesets need `tms: true`:

```ts
const trgb = new TerrainRGB(url, { tms: true });
```

Tile size is read from each decoded image, so 256 and 512 px tilesets work alike.

If a tile cannot be found (404, 204 or an empty body), tile and coordinate lookups for it return `undefined`, and the miss is cached when a cache is configured. Other HTTP errors and undecodable images reject. Any format the browser can decode works (PNG, WebP, Mapbox `.pngraw`…), with or without an extension in the URL.

To send authentication headers, pass a custom `fetch`:

```ts
const dem = new TerrainRGB(url, {
  fetch: (url) => fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
});
```

### Canvas-free decoding

The default decoder reads pixels back from a canvas. Browsers with fingerprinting protection (Brave, Safari's advanced protection, Firefox's strict mode) add noise to canvas reads, and one step in the red channel is 256 m in Terrarium, so the terrain grows spikes. Use the bundled decoder, which never touches a canvas:

```ts
import { Terrarium } from "dem-tiles";
import { decodeTile } from "dem-tiles/decoder";

const dem = new Terrarium(url, { decode: decodeTile });
```

It reads PNG with `fast-png` and WebP with libwebp compiled to WebAssembly (about 50 kB gzip). Each is imported on the first tile of its format and both are optional peer dependencies, so install only the formats you use:

```sh
pnpm add fast-png @jsquash/webp
```

Bundlers must serve the `.wasm` next to its module. With Vite, add `optimizeDeps: { exclude: ["@jsquash/webp"] }`.

### Outside the browser

The default decoder needs `createImageBitmap` and a canvas. In Node or workers without one, pass a decoder such as `decodeTile` above, or your own:

```ts
import { decode } from "fast-png";

const trgb = new TerrainRGB(url, {
  decode: async (blob) => {
    const png = decode(new Uint8Array(await blob.arrayBuffer()));
    return {
      data: png.data as Uint8Array,
      width: png.width,
      height: png.height,
    };
  },
});
```

The decoder must return RGBA pixels.

## Migrating from 2.x

The positional `tileSize`, `minzoom`, `maxzoom` and `tms` arguments are gone. `tileSize` is no longer needed; the rest moved into `options`:

```ts
// 2.x
new TerrainRGB(url, 512, 5, 15, true, { tileCache });
// 3.x
new TerrainRGB(url, { minzoom: 5, maxzoom: 15, tms: true, tileCache });
```

Cache values are now `DecodedTile` (`LRUCache<string, DecodedTile>`), and undecodable tiles reject instead of resolving to `undefined`.

## API

### `TerrainRGB` / `Terrarium`

```
new TerrainRGB(url, options?)
new Terrarium(url, options?)
```

### `BaseTileOptions`

| Option         | Type                                   | Default      | Description                                     |
| -------------- | -------------------------------------- | ------------ | ----------------------------------------------- |
| `minzoom`      | `number`                               | `5`          | Minimum zoom for coordinate lookups             |
| `maxzoom`      | `number`                               | `15`         | Maximum zoom for coordinate lookups             |
| `tms`          | `boolean`                              | `false`      | TMS (bottom-left origin) y axis                 |
| `tileCache`    | `TileCache` (e.g. `Map`, `LRUCache`)   | —            | Cache for decoded tiles, keyed by URL           |
| `sampling`     | `"nearest" \| "median" \| "bilinear"`  | `"nearest"`  | Pixel sampling strategy                         |
| `sampleRadius` | `number`                               | `1`          | Pixel radius for median window (1 = 3x3)        |
| `decode`       | `(blob: Blob) => Promise<DecodedTile>` | canvas       | Turns a fetched tile into RGBA pixels           |
| `fetch`        | `(url: string) => Promise<Response>`   | global fetch | Fetches tile URLs, with optional custom headers |

Use `sampling: "bilinear"` for a weighted interpolation of the four neighboring
pixel heights, measured from pixel centers. Sampling crosses tile boundaries
(wrapping at the antimeridian) and can fetch up to four tiles per coordinate.
Missing or transparent neighbors are ignored and the remaining weights are
renormalized; no valid neighbors means `undefined`. If the coordinate's own tile
is missing, the result is also `undefined`. `sampleRadius` only affects `median`.

### Methods

- `getElevation([lng, lat], zoom)` → `Promise<number | undefined>`
- `getElevations([[lng,lat], ...], zoom)` → `Promise<Array<number | undefined>>`
- `getTileElevations(z, x, y)` → `Promise<TileElevations | undefined>`

`getTileElevations` takes XYZ tile coordinates at the exact zoom supplied. With
`tms: true`, the library flips `y` when building the URL. `x` wraps around the
antimeridian; `y` outside the tile range returns `undefined`. Zoom must be an
integer from 0 to 53, and `x` and `y` must be safe integers; invalid arguments
reject with a `RangeError`. The result contains
`width`, `height`, and a `Float32Array` called `elevations` with one height in
metres per pixel. Index a pixel as `elevations[row * width + column]`, with row
zero at the top. Fully transparent pixels are `NaN`. The method applies the
format's pixel decoding directly, without Terrarium's coordinate rounding and
independent of the `sampling` option. It shares the decoder, cache and
in-flight requests with coordinate lookups.

## Performance

- Reuse a `tileCache` across calls when possible.
- Prefer `getElevations(coords, zoom)` over many independent `getElevation()` calls when many coordinates share tiles.
- Grouping happens by resolved tile URL, so repeated coordinates in the same tile share fetch, decode, cache, and in-flight request work.

## Credits

This project is a fork of [watergis/terrain-rgb](https://github.com/watergis/terrain-rgb). Original work by [Jin IGARASHI](https://github.com/watergis). Licensed under MIT.
