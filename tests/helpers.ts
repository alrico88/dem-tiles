import { SphericalMercator } from "@mapbox/sphericalmercator";
import { decode, encode } from "fast-png";
import encodeChunks from "png-chunks-encode";
import extractChunks from "png-chunks-extract";
import { vi } from "vitest";
import type { DecodedTile } from "../src/lib";

type Route = Uint8Array | number;

/**
 * Builds an RGBA tile where each pixel gets the color returned by `color`.
 */
export function makeTile(
  size: number,
  color: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      data.set(color(x, y), (y * size + x) * 4);
    }
  }
  return data;
}

/**
 * Encodes an elevation in metres as Terrain RGB.
 */
export function terrainRgb(
  elevation: number,
): [number, number, number, number] {
  const v = Math.round((elevation + 10000) * 10);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}

/**
 * Encodes an elevation in metres as Terrarium.
 */
export function terrarium(elevation: number): [number, number, number, number] {
  const v = elevation + 32768;
  return [
    Math.floor(v / 256),
    Math.floor(v) % 256,
    Math.round((v % 1) * 256),
    255,
  ];
}

/**
 * Terrain RGB tile where every pixel encodes its own index (`y * size + x`).
 */
export function indexTile(size: number): Uint8Array {
  return makeTile(size, (x, y) => {
    const v = y * size + x;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
  });
}

/**
 * Recovers the pixel an elevation read from an `indexTile` came from.
 */
export function indexToPixel(elevation: number | undefined, size: number) {
  if (elevation === undefined) return undefined;
  const v = Math.round((elevation + 10000) * 10);
  return { x: v % size, y: Math.floor(v / size) };
}

/**
 * Lng/lat of the center of pixel (px, py) inside XYZ tile (x, y, z).
 */
export function pixelCenter(
  tile: [number, number, number],
  px: number,
  py: number,
  size: number,
): number[] {
  const [x, y, z] = tile;
  return new SphericalMercator({ size }).ll(
    [x * size + px + 0.5, y * size + py + 0.5],
    z,
  );
}

/**
 * Encodes RGBA pixels as PNG, optionally inserting extra chunks right after IHDR.
 */
export function toPng(
  data: Uint8Array,
  size: number,
  extraChunks: Array<{ name: string; data: Uint8Array }> = [],
): Uint8Array {
  const png = encode({
    width: size,
    height: size,
    data,
    channels: 4,
    depth: 8,
  });
  if (extraChunks.length === 0) return png;
  const [ihdr, ...rest] = extractChunks(png);
  return encodeChunks([ihdr, ...extraChunks, ...rest]);
}

/**
 * PNG decoder for environments without canvas.
 */
export async function decodePng(blob: Blob): Promise<DecodedTile> {
  const png = decode(new Uint8Array(await blob.arrayBuffer()));
  return { data: png.data as Uint8Array, width: png.width, height: png.height };
}

/**
 * Stubs `fetch`: each URL maps to image bytes or an HTTP status. Unknown URLs return 404.
 */
export function mockFetch(routes: Record<string, Route>) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)] ?? 404;
    if (typeof route === "number") return new Response(null, { status: route });
    return new Response(route.slice(), {
      headers: { "content-type": "image/png" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
