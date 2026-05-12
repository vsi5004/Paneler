/**
 * A 2D point in the unfolded-net coordinate space.
 *
 * Kept as a plain object rather than three.js Vector2 — the flatten
 * pipeline runs on the client AND in Vitest under node, where pulling in
 * three.js just to use Vector2 is overkill.
 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Output of `unfoldNet`: per-panel 2D corner coordinates in the unfolded
 * frame, keyed by `Panel.id`. The corner order matches the source
 * `panel.vertexIndices` order (so corner i of `vertexIndices[i]` maps to
 * the i-th entry here).
 *
 * Coordinates are NOT viewport-normalised — they sit in whatever
 * absolute 2D space the BFS produced, with units matching the source
 * sphere radius. The renderer auto-fits via SVG viewBox.
 */
export type FlatLayout = Map<string, Vec2[]>;
