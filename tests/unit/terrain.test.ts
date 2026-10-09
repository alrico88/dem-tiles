import { LRUCache } from "lru-cache";
import { describe, expect, test } from "vitest";
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
    const elevation = await terrainRGB().getElevation(
      pixelCenter(tile, px, py, SIZE),
      tile[2],
    );
    expect(indexToPixel(elevation, SIZE)).toEqual({ x: px, y: py });
  });

  test.for([5, 40, 128, 200, 250])(
    "is exact at low zoom (z5, row %i)",
    async (py, { expect }) => {
      const tile: Tile = [15, 10, 5];
      mockFetch({ [tileUrl(tile)]: toPng(indexTile(SIZE), SIZE) });
      const elevation = await terrainRGB().getElevation(
        pixelCenter(tile, 128, py, SIZE),
        5,
      );
      expect(indexToPixel(elevation, SIZE)).toEqual({ x: 128, y: py });
    },
  );

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
    const elevation = await terrainRGB().getElevation(
      pixelCenter(tileA, 100, 200, size),
      10,
    );
    expect(indexToPixel(elevation, size)).toEqual({ x: 100, y: 200 });
  });

  test("clamps zoom to maxzoom", async () => {
    const fetch = mockFetch({});
    const dem = terrainRGB({ maxzoom: 12 });
    await dem.getElevation([2, 40], 18);
    expect(String(fetch.mock.calls[0][0])).toMatch(
      /^https:\/\/tiles\.test\/12\//,
    );
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
    const data = makeTile(SIZE, (x) =>
      x < 128 ? [0, 0, 0, 0] : terrainRgb(500),
    );
    mockFetch({ [tileUrl(tileA)]: toPng(data, SIZE) });
    const dem = terrainRGB();
    expect(
      await dem.getElevation(pixelCenter(tileA, 10, 10, SIZE), 10),
    ).toBeUndefined();
    expect(await dem.getElevation(pixelCenter(tileA, 200, 10, SIZE), 10)).toBe(
      500,
    );
  });

  test.for([0, 1234.5, -50, 8848.8])(
    "terrarium %d m",
    async (elevation, { expect }) => {
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
    },
  );

  test("median ignores a spike", async () => {
    const data = makeTile(SIZE, (x, y) =>
      x === 100 && y === 100 ? terrainRgb(9000) : terrainRgb(250),
    );
    mockFetch({ [tileUrl(tileA)]: toPng(data, SIZE) });
    const lnglat = pixelCenter(tileA, 100, 100, SIZE);
    expect(await terrainRGB().getElevation(lnglat, 10)).toBe(9000);
    expect(
      await terrainRGB({ sampling: "median" }).getElevation(lnglat, 10),
    ).toBe(250);
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
    const fetch = mockFetch({ [tileUrl(tileA)]: route });
    const dem = terrainRGB({ tileCache: new LRUCache({ max: 10 }) });
    const lnglat = pixelCenter(tileA, 1, 1, SIZE);
    expect(await dem.getElevation(lnglat, 10)).toBeUndefined();
    expect(await dem.getElevation(lnglat, 10)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("corrupt images reject", async () => {
    mockFetch({ [tileUrl(tileA)]: new Uint8Array([1, 2, 3]) });
    await expect(
      terrainRGB().getElevation(pixelCenter(tileA, 1, 1, SIZE), 10),
    ).rejects.toThrow();
  });

  test("server errors reject", async () => {
    mockFetch({ [tileUrl(tileA)]: 500 });
    await expect(
      terrainRGB().getElevation(pixelCenter(tileA, 1, 1, SIZE), 10),
    ).rejects.toThrow();
  });
});
