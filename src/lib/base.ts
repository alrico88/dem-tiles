import { pointToTileFraction } from "@mapbox/tilebelt";
import { calcMedian } from "math-helper-functions";
import pMemoize from "p-memoize";
import Formatter from "string-object-formatter";

export type SamplingMode = "nearest" | "median";

export interface DecodedTile {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Minimal cache contract, satisfied by `Map` and `LRUCache` from `lru-cache`.
 */
export interface TileCache {
  has(key: string): boolean;
  get(key: string): DecodedTile | undefined;
  set(key: string, value: DecodedTile): unknown;
  delete(key: string): unknown;
}

export interface BaseTileOptions {
  /**
   * Lowest zoom available in the tileset. Requests below it are clamped. Default 5.
   */
  minzoom?: number;
  /**
   * Highest zoom available in the tileset. Requests above it are clamped. Default 15.
   */
  maxzoom?: number;
  /**
   * Whether the tileset uses the TMS (bottom-left origin) y axis. Default false.
   */
  tms?: boolean;
  /**
   * Cache for decoded tiles, keyed by URL.
   */
  tileCache?: TileCache;
  /**
   * Pixel sampling strategy. "nearest" reads one pixel. "median" returns the
   * median elevation from a square window around the target pixel.
   */
  sampling?: SamplingMode;
  /**
   * Pixel radius for median sampling. 1 means a 3x3 window.
   */
  sampleRadius?: number;
  /**
   * Decodes a fetched tile into RGBA pixels. Defaults to the browser canvas decoder.
   */
  decode?: (blob: Blob) => Promise<DecodedTile>;
}

interface PixelRequest {
  index: number;
  fx: number;
  fy: number;
}

const urlFormatter = new Formatter();

const MISSING_TILE: DecodedTile = {
  data: new Uint8Array(0),
  width: 0,
  height: 0,
};

let decodeContext:
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D
  | null = null;

/**
 * Decodes an image with the browser, skipping color management and alpha
 * premultiplication so RGB values reach us untouched.
 */
async function decodeWithCanvas(blob: Blob): Promise<DecodedTile> {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  try {
    const { width, height } = bitmap;
    if (!decodeContext) {
      const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : document.createElement("canvas");
      decodeContext = canvas.getContext("2d", {
        willReadFrequently: true,
      }) as typeof decodeContext;
      if (!decodeContext) throw new Error("Failed to create canvas context");
    }
    const { canvas } = decodeContext;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    decodeContext.clearRect(0, 0, width, height);
    decodeContext.drawImage(bitmap, 0, 0);
    return {
      data: decodeContext.getImageData(0, 0, width, height).data,
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Fetches, decodes and samples elevation tiles. Subclasses define the encoding.
 */
export abstract class BaseTile {
  protected url: string;

  protected tms: boolean;

  protected minzoom: number;

  protected maxzoom: number;

  private sampling: SamplingMode;

  private sampleRadius: number;

  private decode: (blob: Blob) => Promise<DecodedTile>;

  /**
   * Fetches a tile by URL, sharing in-flight requests and caching results.
   */
  private readonly getTile: (url: string) => Promise<DecodedTile>;

  /**
   * @param url tile URL template with {z}, {x} and {y} placeholders
   * @param options tileset and sampling options
   */
  constructor(url: string, options?: BaseTileOptions) {
    this.url = url;
    this.minzoom = options?.minzoom ?? 5;
    this.maxzoom = options?.maxzoom ?? 15;
    this.tms = options?.tms ?? false;
    this.sampling = options?.sampling ?? "nearest";
    this.sampleRadius = Math.max(0, Math.floor(options?.sampleRadius ?? 1));
    this.decode = options?.decode ?? decodeWithCanvas;
    this.getTile = pMemoize((url: string) => this.fetchTile(url), {
      cache: options?.tileCache ?? false,
    });
  }

  /**
   * Elevation at a coordinate, or undefined when there is no data.
   * @param lnglat [lng, lat]
   * @param z zoom level, clamped to the tileset range
   */
  public async getElevation(
    lnglat: number[],
    z: number,
  ): Promise<number | undefined> {
    return (await this.getElevations([lnglat], z))[0];
  }

  /**
   * Elevations for many coordinates at one zoom level. Coordinates sharing a
   * tile reuse one fetched and decoded tile.
   * @param lnglats list of [lng, lat]
   * @param z zoom level, clamped to the tileset range
   */
  public async getElevations(
    lnglats: number[][],
    z: number,
  ): Promise<Array<number | undefined>> {
    const zoom = Math.min(this.maxzoom, Math.max(this.minzoom, Math.floor(z)));
    const tiles = 2 ** zoom;
    const values = new Array<number | undefined>(lnglats.length);
    const groups = new Map<number, PixelRequest[]>();

    lnglats.forEach(([lng, lat], index) => {
      const [fx, fy] = pointToTileFraction(lng, lat, zoom);
      // Beyond Web Mercator's latitude limits (also catches NaN)
      if (!(fy >= 0 && fy < tiles)) return;
      const x = Math.floor(fx);
      const y = Math.floor(fy);
      const key = y * tiles + x;
      const request = { index, fx: fx - x, fy: fy - y };
      const group = groups.get(key);
      if (group) group.push(request);
      else groups.set(key, [request]);
    });

    await Promise.all(
      Array.from(groups, async ([key, requests]) => {
        const x = key % tiles;
        const y = (key - x) / tiles;
        const url = urlFormatter.format(this.url, {
          z: zoom,
          x,
          y: this.tms ? tiles - 1 - y : y,
        });
        const tile = await this.getTile(url);
        if (tile === MISSING_TILE) return;
        for (const { index, fx, fy } of requests) {
          const px = Math.min(tile.width - 1, Math.floor(fx * tile.width));
          const py = Math.min(tile.height - 1, Math.floor(fy * tile.height));
          values[index] =
            this.sampling === "median" && this.sampleRadius > 0
              ? this.getMedianValue(tile, px, py)
              : this.getPixelValue(tile, px, py);
        }
      }),
    );

    return values;
  }

  /**
   * Elevation encoded by an RGBA pixel. Implemented by each encoding.
   */
  protected abstract calc(r: number, g: number, b: number, a: number): number;

  /**
   * Fetches and decodes a tile. 404, 204 and empty responses yield `MISSING_TILE`.
   */
  private async fetchTile(url: string): Promise<DecodedTile> {
    const res = await fetch(url);
    if (res.status === 404 || res.status === 204) return MISSING_TILE;
    if (!res.ok) {
      throw new Error(`Failed to fetch tile ${url}: ${res.status}`);
    }
    const blob = await res.blob();
    if (blob.size === 0) return MISSING_TILE;
    return this.decode(blob);
  }

  /**
   * Value of a single pixel, or undefined when it is transparent.
   */
  private getPixelValue(
    tile: DecodedTile,
    x: number,
    y: number,
  ): number | undefined {
    const offset = (y * tile.width + x) * 4;
    const { data } = tile;
    const a = data[offset + 3];
    if (a === 0) return undefined;
    return this.calc(data[offset], data[offset + 1], data[offset + 2], a);
  }

  /**
   * Median value of the non-transparent pixels in a window around (x, y).
   */
  private getMedianValue(
    tile: DecodedTile,
    x: number,
    y: number,
  ): number | undefined {
    const r = this.sampleRadius;
    const minX = Math.max(0, x - r);
    const maxX = Math.min(tile.width - 1, x + r);
    const minY = Math.max(0, y - r);
    const maxY = Math.min(tile.height - 1, y + r);
    const values: number[] = [];
    for (let j = minY; j <= maxY; j += 1) {
      for (let i = minX; i <= maxX; i += 1) {
        const value = this.getPixelValue(tile, i, j);
        if (value !== undefined) values.push(value);
      }
    }
    return calcMedian(values);
  }
}
