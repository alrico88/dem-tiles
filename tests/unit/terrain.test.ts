import { encode } from "fast-png";
import { LRUCache } from "lru-cache";
import { describe, expect, test, vi } from "vite-plus/test";
import { TerrainRGB, Terrarium, type BaseTileOptions } from "../../src/lib";
import {
  decodePng,
  indexTile,
  indexToPixel,
  makeTile,
  mockFetch,
  pixelCenter,
  terrainRgb,
  terrarium,
  toPng,
} from "../helpers";

type Tile = [number, number, number];

const SIZE = 256;
const template = "https://tiles.test/{z}/{x}/{y}.png";
const tileUrl = ([x, y, z]: Tile) => `https://tiles.test/${z}/${x}/${y}.png`;
const tileA: Tile = [600, 400, 10];
const tileB: Tile = [601, 400, 10];

function terrainRGB(options: BaseTileOptions = {}, url = template) {
  return new TerrainRGB(url, { minzoom: 0, decode: decodePng, ...options });
}

describe("pixel lookup", () => {
  test.for([
    { tile: tileA, px: 100, py: 200 },
    { tile: tileA, px: 0, py: 0 },
    { tile: tileA, px: 255, py: 255 },
    { tile: [19300, 16600, 15] as Tile, px: 17, py: 230 },
  ])("tile $tile pixel ($px, $py)", async ({ tile, px, py }, { expect }) => {
    mockFetch({ [tileUrl(tile)]: toPng(indexTile(SIZE), SIZE) });
    const elevation = await terrainRGB().getElevation(pixelCenter(tile, px, py, SIZE), tile[2]);

    expect(indexToPixel(elevation, SIZE)).toEqual({ x: px, y: py });
  });

  test.for([5, 40, 128, 200, 250])("is exact at low zoom (z5, row %i)", async (py, { expect }) => {
    const tile: Tile = [15, 10, 5];

    mockFetch({ [tileUrl(tile)]: toPng(indexTile(SIZE), SIZE) });
    const elevation = await terrainRGB().getElevation(pixelCenter(tile, 128, py, SIZE), 5);

    expect(indexToPixel(elevation, SIZE)).toEqual({ x: 128, y: py });
  });

  test("points on a tile corner fall in the tile to the south-east", async () => {
    mockFetch({ [tileUrl([16384, 16384, 15])]: toPng(indexTile(SIZE), SIZE) });
    const elevation = await terrainRGB().getElevation([0, 0], 15);

    expect(indexToPixel(elevation, SIZE)).toEqual({ x: 0, y: 0 });
  });

  test("supports TMS tiles", async () => {
    const [x, y, z] = tileA;

    mockFetch({
      [tileUrl([x, 2 ** z - 1 - y, z])]: toPng(indexTile(SIZE), SIZE),
    });
    const elevation = await terrainRGB({ tms: true }).getElevation(
      pixelCenter(tileA, 30, 70, SIZE),
      z,
    );

    expect(indexToPixel(elevation, SIZE)).toEqual({ x: 30, y: 70 });
  });

  test.for([256, 512])("reads %ipx tiles", async (size, { expect }) => {
    mockFetch({ [tileUrl(tileA)]: toPng(indexTile(size), size) });
    const elevation = await terrainRGB().getElevation(pixelCenter(tileA, 100, 200, size), 10);

    expect(indexToPixel(elevation, size)).toEqual({ x: 100, y: 200 });
  });

  test("latitudes beyond Web Mercator are undefined without fetching", async () => {
    const fetch = mockFetch({});

    expect(await terrainRGB().getElevation([0, 89], 10)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("clamps zoom to maxzoom", async () => {
    const fetch = mockFetch({});
    const dem = terrainRGB({ maxzoom: 12 });

    await dem.getElevation([2, 40], 18);
    expect(String(fetch.mock.calls[0][0])).toMatch(/^https:\/\/tiles\.test\/12\//);
  });
});

describe("tile URLs", () => {
  test.for([
    "https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token=x",
    "https://tiles.example.com/dem/{z}/{x}/{y}",
    "https://tiles.example.com/dem/{z}/{x}/{y}@2x.png",
  ])("accepts %s", (url, { expect }) => {
    expect(() => terrainRGB({}, url)).not.toThrow();
  });
});

describe("decoding", () => {
  test("transparent pixels are no data", async () => {
    const data = makeTile(SIZE, (x) => (x < 128 ? [0, 0, 0, 0] : terrainRgb(500)));

    mockFetch({ [tileUrl(tileA)]: toPng(data, SIZE) });
    const dem = terrainRGB();

    expect(await dem.getElevation(pixelCenter(tileA, 10, 10, SIZE), 10)).toBeUndefined();
    expect(await dem.getElevation(pixelCenter(tileA, 200, 10, SIZE), 10)).toBe(500);
  });

  test.for([0, 1234.5, -50, 8848.8])("terrarium %d m", async (elevation, { expect }) => {
    mockFetch({
      [tileUrl(tileA)]: toPng(
        makeTile(SIZE, () => terrarium(elevation)),
        SIZE,
      ),
    });
    const dem = new Terrarium(template, { decode: decodePng });

    expect(await dem.getElevation(pixelCenter(tileA, 50, 50, SIZE), 10)).toBe(
      Math.round(elevation),
    );
  });

  test("median ignores a spike", async () => {
    const data = makeTile(SIZE, (x, y) =>
      x === 100 && y === 100 ? terrainRgb(9000) : terrainRgb(250),
    );

    mockFetch({ [tileUrl(tileA)]: toPng(data, SIZE) });
    const lnglat = pixelCenter(tileA, 100, 100, SIZE);

    expect(await terrainRGB().getElevation(lnglat, 10)).toBe(9000);
    expect(await terrainRGB({ sampling: "median" }).getElevation(lnglat, 10)).toBe(250);
  });

  test("median averages the middle pair and skips transparent pixels", async () => {
    const data = makeTile(SIZE, (x, y) => (y !== 0 ? [0, 0, 0, 0] : terrainRgb(x * 10)));

    mockFetch({ [tileUrl(tileA)]: toPng(data, SIZE) });
    const dem = terrainRGB({ sampling: "median" });

    expect(await dem.getElevation(pixelCenter(tileA, 0, 0, SIZE), 10)).toBe(5);
    expect(await dem.getElevation(pixelCenter(tileA, 0, 10, SIZE), 10)).toBeUndefined();
  });
});

describe("getTileElevations", () => {
  test("rejects invalid coordinates without fetching and treats out-of-range y as missing", async () => {
    const fetch = mockFetch({});
    const dem = terrainRGB();

    for (const [z, x, y] of [
      [-1, 0, 0],
      [10.5, 0, 0],
      [NaN, 0, 0],
      [54, 0, 0],
      [10, 0.5, 0],
      [10, 0, NaN],
    ]) {
      await expect(dem.getTileElevations(z, x, y)).rejects.toThrow(RangeError);
    }

    expect(await dem.getTileElevations(10, 0, 1024)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("propagates HTTP errors", async () => {
    const [x, y, z] = tileA;

    mockFetch({ [tileUrl(tileA)]: 500 });
    await expect(terrainRGB().getTileElevations(z, x, y)).rejects.toThrow("500");
  });

  test("wraps x around the antimeridian", async () => {
    const fetch = mockFetch({});

    await terrainRGB().getTileElevations(10, -1, 0);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://tiles.test/10/1023/0.png");
  });

  test.for([
    { Dem: TerrainRGB, color: terrainRgb },
    { Dem: Terrarium, color: terrarium },
  ])("decodes $Dem.name in image row order", async ({ Dem, color }, { expect }) => {
    const [x, y, z] = tileA;
    const [r, g, b] = color(50);
    const png = encode({
      width: 3,
      height: 2,
      data: Uint8Array.of(
        ...color(12.5),
        ...color(0),
        r,
        g,
        b,
        0,
        ...color(-25),
        r,
        g,
        b,
        128,
        ...color(256),
      ),
      channels: 4,
      depth: 8,
    });

    mockFetch({ [tileUrl([x, 2 ** z - 1 - y, z])]: png });

    const dem = new Dem(template, {
      decode: decodePng,
      tms: true,
      minzoom: 11,
      sampling: "median",
    });

    expect(await dem.getTileElevations(z, x, y)).toEqual({
      width: 3,
      height: 2,
      elevations: Float32Array.of(12.5, 0, NaN, -25, 50, 256),
    });
  });

  test("shares an in-flight fetch and decode with coordinate lookups", async () => {
    const [x, y, z] = tileA;
    const fetch = mockFetch({
      [tileUrl(tileA)]: toPng(
        makeTile(2, () => terrainRgb(42)),
        2,
      ),
    });
    const decode = vi.fn(decodePng);
    const dem = terrainRGB({ decode });
    const [elevation, tile] = await Promise.all([
      dem.getElevation(pixelCenter(tileA, 0, 0, 2), z),
      dem.getTileElevations(z, x, y),
    ]);

    expect(elevation).toBe(42);
    expect(tile?.elevations).toEqual(Float32Array.of(42, 42, 42, 42));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  test("preserves Terrarium coordinate rounding while returning fractional tile heights", async () => {
    const [x, y, z] = tileA;
    const fetch = mockFetch({
      [tileUrl(tileA)]: toPng(
        makeTile(2, () => terrarium(12.5)),
        2,
      ),
    });
    const dem = new Terrarium(template, { decode: decodePng, tileCache: new Map() });

    expect(await dem.getElevation(pixelCenter(tileA, 0, 0, 2), z)).toBe(13);
    expect((await dem.getTileElevations(z, x, y))?.elevations[0]).toBe(12.5);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("uses the configured fetch and shares cached tiles with coordinate lookups", async () => {
    const [x, y, z] = tileA;
    const png = toPng(
      makeTile(2, () => terrainRgb(42)),
      2,
    );
    const globalFetch = mockFetch({ [tileUrl(tileA)]: png });
    const request = vi.fn(async (_url: string, _init: RequestInit) => new Response(png.slice()));
    const decode = vi.fn(decodePng);
    const headers = { Authorization: "Bearer test-token" };
    const dem = terrainRGB({
      decode,
      fetch: (url) => request(url, { headers }),
      tileCache: new Map(),
    });

    expect(await dem.getTileElevations(z, x, y)).toBeDefined();
    expect(await dem.getElevations([pixelCenter(tileA, 0, 0, 2)], z)).toEqual([42]);
    expect(request).toHaveBeenCalledExactlyOnceWith(tileUrl(tileA), { headers });
    expect(globalFetch).not.toHaveBeenCalled();
    expect(decode).toHaveBeenCalledTimes(1);
  });
});

describe("fetching", () => {
  test("batches points by tile", async () => {
    const fetch = mockFetch({
      [tileUrl(tileA)]: toPng(indexTile(SIZE), SIZE),
      [tileUrl(tileB)]: toPng(indexTile(SIZE), SIZE),
    });
    const values = await terrainRGB().getElevations(
      [
        pixelCenter(tileA, 1, 1, SIZE),
        pixelCenter(tileB, 2, 2, SIZE),
        pixelCenter(tileA, 3, 3, SIZE),
      ],
      10,
    );

    expect(values.map((v) => indexToPixel(v, SIZE))).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("dedupes concurrent requests for the same tile", async () => {
    const fetch = mockFetch({ [tileUrl(tileA)]: toPng(indexTile(SIZE), SIZE) });
    const dem = terrainRGB();

    await Promise.all([
      dem.getElevation(pixelCenter(tileA, 1, 1, SIZE), 10),
      dem.getElevation(pixelCenter(tileA, 2, 2, SIZE), 10),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("reuses cached tiles", async () => {
    const fetch = mockFetch({ [tileUrl(tileA)]: toPng(indexTile(SIZE), SIZE) });
    const dem = terrainRGB({ tileCache: new LRUCache({ max: 10 }) });

    await dem.getElevation(pixelCenter(tileA, 1, 1, SIZE), 10);
    await dem.getElevation(pixelCenter(tileA, 2, 2, SIZE), 10);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.for([
    { name: "404", route: 404 },
    { name: "204", route: 204 },
    { name: "empty 200", route: new Uint8Array(0) },
  ])("$name tiles are undefined and cached", async ({ route }, { expect }) => {
    const [x, y, z] = tileA;
    const fetch = mockFetch({ [tileUrl(tileA)]: route });
    const dem = terrainRGB({ tileCache: new LRUCache({ max: 10 }) });
    const lnglat = pixelCenter(tileA, 1, 1, SIZE);

    expect(await dem.getElevation(lnglat, z)).toBeUndefined();
    expect(await dem.getTileElevations(z, x, y)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("corrupt images reject", async () => {
    mockFetch({ [tileUrl(tileA)]: new Uint8Array([1, 2, 3]) });
    await expect(terrainRGB().getElevation(pixelCenter(tileA, 1, 1, SIZE), 10)).rejects.toThrow();
  });

  test("server errors reject", async () => {
    mockFetch({ [tileUrl(tileA)]: 500 });
    await expect(terrainRGB().getElevation(pixelCenter(tileA, 1, 1, SIZE), 10)).rejects.toThrow();
  });
});
