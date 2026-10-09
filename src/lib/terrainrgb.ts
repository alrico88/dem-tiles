import { BaseTile } from "./base";

/**
 * Mapbox Terrain RGB encoded tiles.
 */
export class TerrainRGB extends BaseTile {
  /**
   * https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/#elevation-data
   */
  protected calc(r: number, g: number, b: number): number {
    return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
  }
}
