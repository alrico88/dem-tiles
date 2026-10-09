import { describe, test } from "vitest";
import { TerrainRGB, Terrarium } from "../../src/lib";
import { madrid, rwanda } from "../fixtures/points";

/**
 * Tile template served from tests/fixtures. Refresh with `node tests/fixtures/download.mjs`.
 */
const fixture = (name: string, ext: string) =>
  `/tests/fixtures/${name}/{z}/{x}/{y}.${ext}`;

describe("real tiles", () => {
  test.for([
    { name: "rw-terrain-png", ext: "png" },
    { name: "rw-terrain-webp", ext: "webp" },
  ])("terrain RGB $ext", async ({ name, ext }, { expect }) => {
    const dem = new TerrainRGB(fixture(name, ext));
    expect(await dem.getElevations(rwanda, 15)).toEqual([
      1347, 1586, 1997, 1710, 1392,
    ]);
  });

  test.for([
    {
      name: "terrarium",
      ext: "png",
      points: [...rwanda, madrid],
      expected: [1349, 1584, 2001, 1712, 1390, 664],
    },
    {
      name: "mapterhorn",
      ext: "webp",
      points: [madrid],
      expected: [648],
    },
  ])("terrarium $name", async ({ name, ext, points, expected }, { expect }) => {
    const dem = new Terrarium(fixture(name, ext));
    expect(await dem.getElevations(points, 15)).toEqual(expected);
  });
});
