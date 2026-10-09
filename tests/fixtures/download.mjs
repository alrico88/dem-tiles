// Downloads the real tiles used by tests/browser/tiles.test.ts: node tests/fixtures/download.mjs
import { pointToTile } from "@mapbox/tilebelt";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { madrid, rwanda } from "./points.ts";

const root = dirname(fileURLToPath(import.meta.url));

const sets = [
  {
    name: "rw-terrain-png",
    url: "https://wasac.github.io/rw-terrain/tiles/{z}/{x}/{y}.png",
    points: rwanda,
  },
  {
    name: "rw-terrain-webp",
    url: "https://wasac.github.io/rw-terrain-webp/tiles/{z}/{x}/{y}.webp",
    points: rwanda,
  },
  {
    name: "terrarium",
    url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    points: [...rwanda, madrid],
  },
  {
    name: "mapterhorn",
    url: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
    points: [madrid],
  },
];

for (const { name, url, points } of sets) {
  for (const [lng, lat] of points) {
    const [x, y, z] = pointToTile(lng, lat, 15);
    const src = url.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: ${res.status}`);
    const dest = join(root, name, src.slice(src.indexOf(`/${z}/${x}/`) + 1));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, new Uint8Array(await res.arrayBuffer()));
    console.log(dest);
  }
}
