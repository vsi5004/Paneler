import { Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";
import { topologyFromFaces } from "./fromFaces";

/**
 * The octahedron truncation family: octahedron → truncated octahedron →
 * cuboctahedron, parameterized by the length of the hexagons' short edges.
 *
 * Truncate each octahedron edge (a, b) at `lerp(a, b, t)` and `lerp(a, b, 1-t)`:
 * every octa face becomes a hexagon (alternating long/short edges) and every
 * octa vertex becomes a square. The hexagon-hexagon shared edges — the segments
 * lying along the original octa edges — are the "short edges". At `t = 1/2`
 * both truncation points meet at the edge midpoint, the short edges vanish, and
 * the hexagons degenerate into the cuboctahedron's triangles.
 *
 * The parameter is the short edge's chord length on the *unit* sphere, so it is
 * scale-free and reads directly as a length in the UI. Derivation: the two
 * truncation points sit at fractions t and 1-t of an octa edge, separated by
 * `u = 1 - 2t` of the edge. Unit octa vertices are `√2` apart, and each point's
 * distance from the origin is `sqrt(1 - 2t + 2t²) = sqrt((1 + u²)/2)`, so after
 * projection onto the unit sphere the chord is `u√2 / sqrt((1+u²)/2)`:
 *
 *   s = 2u / sqrt(u² + 1)        u = s / sqrt(4 - s²)        t = (1 - u) / 2
 *
 * Anchors: t=1/2 → s=0 (cuboctahedron), t=1/3 → s=2/√10 ≈ 0.632 (regular
 * truncated octahedron, all edges equal), t=0 → s=√2 (octahedron, squares
 * degenerate). Beyond s ≈ 0.632 the hex-hex edge is no longer the short one.
 */

/** Short-edge chord length on the unit sphere → truncation fraction t ∈ (0, 1/2]. */
export function shortEdgeToT(shortEdge: number): number {
  const u = shortEdge / Math.sqrt(4 - shortEdge * shortEdge);
  return (1 - u) / 2;
}

/** Truncation fraction t → short-edge chord length on the unit sphere. */
export function tToShortEdge(t: number): number {
  const u = 1 - 2 * t;
  return (2 * u) / Math.sqrt(u * u + 1);
}

/** Below this, truncation points are merged and hexagons collapse to triangles. */
const DEGENERATE_SHORT_EDGE = 1e-6;

// Mirrors octahedron() in presets.ts — duplicated here (6 verts, 8 faces) so
// this module doesn't import from presets.ts, which imports us back.
const OCTA_VERTS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], // 0  +X
  [-1, 0, 0], // 1  -X
  [0, 1, 0], // 2  +Y
  [0, -1, 0], // 3  -Y
  [0, 0, 1], // 4  +Z
  [0, 0, -1], // 5  -Z
];
const OCTA_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 4],
  [2, 1, 4],
  [1, 3, 4],
  [3, 0, 4],
  [2, 0, 5],
  [1, 2, 5],
  [3, 1, 5],
  [0, 3, 5],
];

/**
 * Panel ids are frozen to the degenerate (s=0, cuboctahedron) shapes: the 8
 * face panels are always `panel_001..008_triangle` and the 6 vertex panels
 * always `panel_009..014_quad`, regardless of the current shortEdge. This keeps
 * ids — and therefore painted colors, selection, and saved designs — stable
 * while the parameter morphs triangles into hexagons. `Panel.shape` (and the
 * shape recovered by parseGlb from corner count) still reflects the true
 * geometry.
 */
const FROZEN_SHAPES = [
  ...Array<string>(8).fill("triangle"),
  ...Array<string>(6).fill("quad"),
];

export function truncatedOctahedronFamily(
  radius = 1,
  shortEdge = 0,
): PanelTopology {
  const t = shortEdgeToT(shortEdge);
  const degenerate = shortEdge < DEGENERATE_SHORT_EDGE;
  const octa = OCTA_VERTS.map(([x, y, z]) => new Vector3(x, y, z));

  const rawVertices: [number, number, number][] = [];
  const pointIndex = new Map<string, number>();
  // Truncation point on edge (a, b) near a. In the degenerate case both points
  // of an edge collapse to its midpoint and share one vertex (undirected key),
  // so consecutive-duplicate filtering below yields true triangle loops.
  const P = (a: number, b: number): number => {
    const key = degenerate
      ? a < b
        ? `${a}-${b}`
        : `${b}-${a}`
      : `${a}-${b}`;
    let idx = pointIndex.get(key);
    if (idx === undefined) {
      const v = octa[a].clone().lerp(octa[b], degenerate ? 0.5 : t);
      idx = rawVertices.length;
      rawVertices.push([v.x, v.y, v.z]);
      pointIndex.set(key, idx);
    }
    return idx;
  };

  const faces: number[][] = [];

  // One hexagon per octa face, winding inherited from the face's CCW order:
  // along edge (a,b), corner cut at b, along (b,c), cut at c, along (c,a),
  // cut at a. The along-edge segments are the hex-hex short edges.
  for (const [a, b, c] of OCTA_FACES) {
    const loop = [P(a, b), P(b, a), P(b, c), P(c, b), P(c, a), P(a, c)];
    faces.push(loop.filter((v, i) => v !== loop[(i + 1) % loop.length]));
  }

  // One square per octa vertex: its 4 truncation points sorted CCW as seen
  // from outside the sphere (atan2 in the vertex's tangent plane).
  for (let v = 0; v < octa.length; v++) {
    const neighbors = new Set<number>();
    for (const face of OCTA_FACES) {
      if (face.includes(v)) {
        for (const x of face) if (x !== v) neighbors.add(x);
      }
    }
    const n = octa[v].clone().normalize();
    const ref =
      Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const e1 = ref
      .clone()
      .sub(n.clone().multiplyScalar(ref.dot(n)))
      .normalize();
    const e2 = n.clone().cross(e1);
    const angle = (i: number) =>
      Math.atan2(octa[i].dot(e2), octa[i].dot(e1));
    const sorted = [...neighbors].sort((p, q) => angle(p) - angle(q));
    faces.push(sorted.map((x) => P(v, x)));
  }

  return topologyFromFaces(
    rawVertices,
    faces,
    radius,
    (idx) => `panel_${String(idx + 1).padStart(3, "0")}_${FROZEN_SHAPES[idx]}`,
  );
}
