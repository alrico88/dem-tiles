import { BaseTile } from "./base";

/**
 * Terrarium encoded tiles, rounded to whole metres.
 */
export class Terrarium extends BaseTile {
  /**
   * https://github.com/tilezen/joerd/blob/master/docs/formats.md#terrarium
   */
  protected calc(r: number, g: number, b: number): number {
    return Math.round(r * 256 + g + b / 256 - 32768);
  }
}
