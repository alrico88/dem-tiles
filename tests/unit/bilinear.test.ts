import { describe, expect, test } from "vite-plus/test";
import { TerrainRGB, Terrarium } from "../../src/lib";
import {
  decodePng,
  makeTile,
  mockFetch,
  pixelCenter,
  terrainRgb,
  terrarium,
  toPng,
} from "../helpers";

describe.for([
  { name: "TerrainRGB", Tile: TerrainRGB, encode: terrainRgb },
  { name: "Terrarium", Tile: Terrarium, encode: terrarium },
])("$name bilinear", ({ Tile, encode }) => {
  const url = "https://tiles/{z}/{x}/{y}";
  const options = {
    minzoom: 0,
    sampling: "bilinear" as const,
    decode: decodePng,
  };
  const png = (height: number) =>
    toPng(
      makeTile(2, () => encode(height)),
      2,
    );

  test("interpolates decoded heights relative to pixel centers", async () => {
    mockFetch({
      "https://tiles/1/0/0": toPng(
        makeTile(2, (x, y) => encode(x * 100 + y * 200)),
        2,
      ),
    });
    const tile = new Tile(url, options);

    expect(await tile.getElevation(pixelCenter([0, 0, 1], 0.25, 0.25, 2), 1)).toBeCloseTo(75);
    expect(await tile.getElevation(pixelCenter([0, 0, 1], 1, 1, 2), 1)).toBeCloseTo(300);
  });

  test.for([
    {
      edge: "east",
      next: "https://tiles/1/1/0",
      at: (o: number) => [1.5 + o, 0],
    },
    {
      edge: "south",
      next: "https://tiles/1/0/1",
      at: (o: number) => [0, 1.5 + o],
    },
  ])("is continuous across the $edge tile edge", async ({ next, at }, { expect }) => {
    mockFetch({ "https://tiles/1/0/0": png(100), [next]: png(300) });
    const tile = new Tile(url, options);

    for (const offset of [-0.0001, 0, 0.0001]) {
      const [px, py] = at(offset);

      expect(await tile.getElevation(pixelCenter([0, 0, 1], px, py, 2), 1)).toBeCloseTo(
        200 + offset * 200,
      );
    }
  });

  test("returns undefined when the target tile is missing", async () => {
    mockFetch({});
    const tile = new Tile(url, options);

    expect(await tile.getElevation(pixelCenter([0, 0, 1], 0, 0, 2), 1)).toBeUndefined();
  });

  test.for([false, true])(
    "crosses corners and deduplicates batch requests (TMS %s)",
    async (tms, { expect }) => {
      const fetch = mockFetch({
        [`https://tiles/1/0/${tms ? 1 : 0}`]: png(0),
        [`https://tiles/1/1/${tms ? 1 : 0}`]: png(100),
        [`https://tiles/1/0/${tms ? 0 : 1}`]: png(200),
        [`https://tiles/1/1/${tms ? 0 : 1}`]: png(300),
      });
      const tile = new Tile(url, { ...options, tms });
      const coord = pixelCenter([0, 0, 1], 1.5, 1.5, 2);
      const values = await tile.getElevations([coord, coord], 1);

      values.forEach((value) => expect(value).toBeCloseTo(150));
      expect(fetch).toHaveBeenCalledTimes(4);
    },
  );

  test("fetches each tile once per batch without a cache", async () => {
    const fetch = mockFetch({
      "https://tiles/1/0/0": png(100),
      "https://tiles/1/1/0": png(300),
    });
    const tile = new Tile(url, options);
    const values = await tile.getElevations(
      [pixelCenter([0, 0, 1], 1.25, 0, 2), pixelCenter([1, 0, 1], -0.25, 0, 2)],
      1,
    );

    expect(values[0]).toBeCloseTo(150);
    expect(values[1]).toBeCloseTo(250);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("renormalizes missing and transparent neighbors", async () => {
    mockFetch({
      "https://tiles/1/1/1": toPng(
        makeTile(2, (x, y) => (x === 0 && y === 0 ? encode(80) : [0, 0, 0, 0])),
        2,
      ),
    });
    const tile = new Tile(url, options);

    expect(await tile.getElevation(pixelCenter([1, 1, 1], -0.25, -0.25, 2), 1)).toBeCloseTo(80);
    expect(await tile.getElevation(pixelCenter([1, 1, 1], 1, 1, 2), 1)).toBeUndefined();
  });

  test("wraps longitude at the antimeridian", async () => {
    mockFetch({
      "https://tiles/1/0/1": png(100),
      "https://tiles/1/1/1": png(300),
    });
    const tile = new Tile(url, options);

    expect(await tile.getElevation(pixelCenter([0, 1, 1], -0.5, 0, 2), 1)).toBeCloseTo(200);
  });

  test("uses available pixels at the northern world edge", async () => {
    const fetch = mockFetch({ "https://tiles/1/0/0": png(100) });
    const tile = new Tile(url, options);

    expect(await tile.getElevation(pixelCenter([0, 0, 1], 0, -0.25, 2), 1)).toBeCloseTo(100);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
