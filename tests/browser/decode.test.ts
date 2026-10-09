import { describe, test } from "vitest";
import { TerrainRGB } from "../../src/lib";
import {
  makeTile,
  mockFetch,
  pixelCenter,
  terrainRgb,
  toPng,
} from "../helpers";

const SIZE = 256;
const url = "https://tiles.test/10/600/400.png";
const elevations = [0, 123.4, 1500.7, 4321.9];
const data = makeTile(SIZE, (x) => terrainRgb(elevations[Math.floor(x / 64)]));

/**
 * gAMA chunk declaring a linear (1.0) gamma, which browsers color-correct by default.
 */
function linearGamma() {
  const body = new Uint8Array(4);
  new DataView(body.buffer).setUint32(0, 100000);
  return { name: "gAMA", data: body };
}

describe.for([
  { name: "plain PNG", png: toPng(data, SIZE) },
  { name: "PNG with gAMA", png: toPng(data, SIZE, [linearGamma()]) },
])("canvas decoder: $name", ({ png }) => {
  test.for(elevations.map((elevation, i) => ({ elevation, px: i * 64 + 32 })))(
    "reads $elevation m unaltered",
    async ({ elevation, px }, { expect }) => {
      mockFetch({ [url]: png });
      const dem = new TerrainRGB("https://tiles.test/{z}/{x}/{y}.png");
      const value = await dem.getElevation(
        pixelCenter([600, 400, 10], px, 128, SIZE),
        10,
      );
      expect(value).toBeCloseTo(elevation, 5);
    },
  );
});
