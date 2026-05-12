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
 * Per-panel data in the unfolded layout.
 *
 * `corners[i]` is the 2D position of `panel.vertexIndices[i]`.
 *
 * `sagittaRatios[i]` is the dimensionless bulge ratio `s/c` for the edge
 * from `corners[i]` to `corners[(i+1) % n]`, where `s` is the sagitta of
 * the corresponding great-circle arc on the source sphere and `c` is the
 * arc's chord length. Scale-invariant: when the renderer wants the
 * actual 2D sagitta it multiplies by the 2D edge length. Used to draw
 * each panel as a curve-edged polygon (`<path>` with quadratic-bezier
 * sides) rather than a straight-edged polygon. Without this every
 * panel looks like a flat polygon — tetrahedron edges in particular
 * should visibly bulge because each face covers a quarter of the sphere.
 */
export interface PanelFlat {
  corners: Vec2[];
  sagittaRatios: number[];
}

export type FlatLayout = Map<string, PanelFlat>;
