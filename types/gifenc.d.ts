/**
 * gifenc ships no types. Only the three functions the order-form capture uses
 * are declared, deliberately — a fuller guess at the API would be a fiction
 * TypeScript then enforces.
 */
declare module "gifenc" {
  export function quantize(
    rgba: Uint8ClampedArray,
    maxColors: number,
  ): number[][];
  export function applyPalette(
    rgba: Uint8ClampedArray,
    palette: number[][],
  ): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts: { palette: number[][]; delay?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
