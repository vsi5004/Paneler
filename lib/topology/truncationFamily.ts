import { Vector3 } from "three";
import type { PanelShape, PanelTopology } from "@/lib/types";
import { topologyFromFaces } from "./fromFaces";

/**
 * Truncation families: morph a triangle-faced parent solid toward its
 * rectification by a single "short edge" parameter.
 *
 *   octahedron  → truncated octahedron  → cuboctahedron
 *   icosahedron → truncated icosahedron → icosidodecahedron
 *
 * Truncate each parent edge (a, b) at `lerp(a, b, t)` and `lerp(a, b, 1-t)`:
 * every parent face becomes a hexagon (alternating long/short edges) and every
 * parent vertex becomes an n-gon of its valence (square for the octahedron,
 * pentagon for the icosahedron). The hexagon-hexagon shared edges — the
 * segments lying along the original parent edges — are the "short edges". At
 * `t = 1/2` both truncation points meet at the edge midpoint, the short edges
 * vanish, and the hexagons degenerate into triangles (the rectified solid).
 *
 * The parameter is the short/long edge length ratio, which reads naturally in
 * the UI as a percent. Derivation: with `u = 1 - 2t`, the two truncation
 * points of one parent edge are `u·e` apart (short edge) and the corner-cut
 * segment near a vertex spans `t·e` (long edge), where `e` is the parent edge
 * length — the same for every edge because the parents are edge-transitive,
 * with adjacent neighbors of a vertex themselves adjacent. Every truncation
 * point also sits at the same distance from the origin, so projecting onto the
 * sphere scales all chords equally and the ratio survives exactly:
 *
 *   r = u / t = 2u / (1 - u)        u = r / (2 + r)        t = (1 - u) / 2
 *
 * Anchors: t=1/2 → r=0 (rectified solid), t=1/3 → r=1 (regular truncation,
 * all edges equal — 100%), t=0 → r=∞ (the parent itself, vertex panels
 * degenerate). The slider range [0, 1] covers rectified → regular; beyond r=1
 * the "short" edge would be the long one.
 */

/** Short/long edge ratio → truncation fraction t ∈ (0, 1/2]. */
export function shortEdgeRatioToT(ratio: number): number {
  const u = ratio / (2 + ratio);
  return (1 - u) / 2;
}

/** Truncation fraction t → short/long edge ratio. */
export function tToShortEdgeRatio(t: number): number {
  const u = 1 - 2 * t;
  return (2 * u) / (1 - u);
}

/** Below this ratio, truncation points are merged and hexagons collapse to triangles. */
const DEGENERATE_RATIO = 1e-6;

/**
 * A parent solid the family can truncate. Faces must be triangles, wound CCW
 * from outside; vertices must share one circumradius and one edge length
 * (edge-transitivity) for the ratio math above to hold.
 */
interface ParentSolid {
  vertices: ReadonlyArray<readonly [number, number, number]>;
  faces: ReadonlyArray<readonly [number, number, number]>;
  /**
   * Frozen panel-id suffixes: face panels get `faceShape`, vertex panels get
   * `vertexShape`, regardless of the current ratio. Chosen to match each
   * preset's default member so ids — and therefore painted colors, selection,
   * and saved designs — stay stable while the parameter morphs shapes.
   */
  faceShape: PanelShape;
  vertexShape: PanelShape;
}

// Mirrors octahedron() in presets.ts — duplicated here so this module doesn't
// import from presets.ts, which imports us back.
const OCTAHEDRON: ParentSolid = {
  vertices: [
    [1, 0, 0], // 0  +X
    [-1, 0, 0], // 1  -X
    [0, 1, 0], // 2  +Y
    [0, -1, 0], // 3  -Y
    [0, 0, 1], // 4  +Z
    [0, 0, -1], // 5  -Z
  ],
  faces: [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ],
  // Frozen to the cubocta preset's default (ratio 0): degenerate shapes.
  faceShape: "triangle",
  vertexShape: "quad",
};

// Mirrors icosahedron() in presets.ts.
const ICOSA_PHI = (1 + Math.sqrt(5)) / 2;
const ICOSAHEDRON: ParentSolid = {
  vertices: [
    [-1, ICOSA_PHI, 0], // 0
    [1, ICOSA_PHI, 0], // 1
    [-1, -ICOSA_PHI, 0], // 2
    [1, -ICOSA_PHI, 0], // 3
    [0, -1, ICOSA_PHI], // 4
    [0, 1, ICOSA_PHI], // 5
    [0, -1, -ICOSA_PHI], // 6
    [0, 1, -ICOSA_PHI], // 7
    [ICOSA_PHI, 0, -1], // 8
    [ICOSA_PHI, 0, 1], // 9
    [-ICOSA_PHI, 0, -1], // 10
    [-ICOSA_PHI, 0, 1], // 11
  ],
  faces: [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ],
  // Frozen to the soccer preset's default (ratio 1): regular truncation shapes.
  faceShape: "hexagon",
  vertexShape: "pentagon",
};

function truncationFamily(
  parent: ParentSolid,
  radius: number,
  shortEdgeRatio: number,
): PanelTopology {
  const t = shortEdgeRatioToT(shortEdgeRatio);
  const degenerate = shortEdgeRatio < DEGENERATE_RATIO;
  const parentVerts = parent.vertices.map(([x, y, z]) => new Vector3(x, y, z));

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
      const v = parentVerts[a]
        .clone()
        .lerp(parentVerts[b], degenerate ? 0.5 : t);
      idx = rawVertices.length;
      rawVertices.push([v.x, v.y, v.z]);
      pointIndex.set(key, idx);
    }
    return idx;
  };

  const faces: number[][] = [];

  // One hexagon per parent face, winding inherited from the face's CCW order:
  // along edge (a,b), corner cut at b, along (b,c), cut at c, along (c,a),
  // cut at a. The along-edge segments are the hex-hex short edges.
  for (const [a, b, c] of parent.faces) {
    const loop = [P(a, b), P(b, a), P(b, c), P(c, b), P(c, a), P(a, c)];
    faces.push(loop.filter((v, i) => v !== loop[(i + 1) % loop.length]));
  }

  // One n-gon per parent vertex: its truncation points sorted CCW as seen
  // from outside the sphere (atan2 in the vertex's tangent plane).
  for (let v = 0; v < parentVerts.length; v++) {
    const neighbors = new Set<number>();
    for (const face of parent.faces) {
      if (face.includes(v)) {
        for (const x of face) if (x !== v) neighbors.add(x);
      }
    }
    const n = parentVerts[v].clone().normalize();
    const ref =
      Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const e1 = ref
      .clone()
      .sub(n.clone().multiplyScalar(ref.dot(n)))
      .normalize();
    const e2 = n.clone().cross(e1);
    const angle = (i: number) =>
      Math.atan2(parentVerts[i].dot(e2), parentVerts[i].dot(e1));
    const sorted = [...neighbors].sort((p, q) => angle(p) - angle(q));
    faces.push(sorted.map((x) => P(v, x)));
  }

  const faceCount = parent.faces.length;
  return topologyFromFaces(rawVertices, faces, radius, (idx) => {
    const shape = idx < faceCount ? parent.faceShape : parent.vertexShape;
    return `panel_${String(idx + 1).padStart(3, "0")}_${shape}`;
  });
}

/** Cuboctahedron (ratio 0) → truncated octahedron (ratio 1). */
export function truncatedOctahedronFamily(
  radius = 1,
  shortEdgeRatio = 0,
): PanelTopology {
  return truncationFamily(OCTAHEDRON, radius, shortEdgeRatio);
}

/** Icosidodecahedron (ratio 0) → soccer ball / truncated icosahedron (ratio 1). */
export function truncatedIcosahedronFamily(
  radius = 1,
  shortEdgeRatio = 1,
): PanelTopology {
  return truncationFamily(ICOSAHEDRON, radius, shortEdgeRatio);
}
