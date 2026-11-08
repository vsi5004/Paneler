import { Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";
import { topologyFromFaces } from "./fromFaces";
import { ICOSAHEDRON } from "./truncationFamily";
import { geodesicIcosahedron } from "./goldberg";

// Longest boundary segment on a circle arc, in radians — fine enough that
// the circles read as round, not as polygons.
const MAX_ARC_STEP = (2 * Math.PI) / 180;
// Longest segment on a straight hex-hex edge. The hexagons have concave
// sides, so they go to the concave mesher, which needs boundary corners
// dense enough that each great arc stays close to its chord (same limit
// as importedBall.ts).
const MAX_EDGE_ANGLE = (3 * Math.PI) / 180;

/**
 * A triangulated sphere to hang circles on: one circle per vertex, one
 * filler panel per triangle. Faces wound CCW from outside.
 */
interface CircleParent {
  vertices: ReadonlyArray<readonly [number, number, number]>;
  faces: ReadonlyArray<readonly [number, number, number]>;
}

/**
 * "Circle Soccer" — the classic 32-panel ball with each of the 12
 * pentagons replaced by a circle centered on it.
 *
 * Every hex-hex seam of a soccer ball lies on the great circle joining
 * two pentagon centers (the parent icosahedron's edges), so the layout
 * follows from one number, the circles' angular radius ρ: each seam runs
 * along its center-to-center arc between the two circles, and each circle
 * is split into five arcs where those seams meet it. Each hexagon is
 * three seams plus three concave arcs hugging its circles.
 *
 * `circleSize` scales ρ relative to the pentagon circumradius: 1 = each
 * circle passes through its pentagon's corners (the three-panel junctions
 * stay where the soccer ball has them). Smaller circles lengthen the
 * seams inward; larger ones shorten them, until neighbouring circles
 * touch at ~1.58 (seams vanish) — callers cap below that.
 *
 * Panel ids follow the soccer ball's order (20 hexagons, then 12 circles)
 * with frozen suffixes `_hexagon` / `_circle`, so paint-by-shape groups
 * them even though both are dense "polygon" loops.
 */
export function circleSoccer(radius = 1, circleSize = 1): PanelTopology {
  return circleBall(ICOSAHEDRON, radius, circleSize);
}

/**
 * "Circle Soccer 6" — the same construction on a frequency-2 geodesic
 * icosahedron: 42 circles, 30 of them ringed by six neighbours (the 12
 * original icosahedron vertices necessarily keep five — Euler forbids an
 * all-six sphere), plus 80 filler panels, 122 in all.
 *
 * Geodesic edges come in two lengths, so ρ is set against the shortest:
 * `circleSize` 1 gives the same ρ-to-closest-neighbour ratio as Circle
 * Soccer at 1, and the same ~1.58 touching limit.
 */
export function circleSoccer6(radius = 1, circleSize = 1): PanelTopology {
  return circleBall(geodesicIcosahedron(2), radius, circleSize);
}

/**
 * Circles on every vertex of `parent`, each seam along a center-to-center
 * great arc, one filler panel per face. ρ = circleSize × (the soccer
 * ball's pentagon-circumradius-to-half-edge ratio) × half the parent's
 * shortest edge, so circleSize 1 reproduces Circle Soccer on the
 * icosahedron.
 */
function circleBall(
  parent: CircleParent,
  radius: number,
  circleSize: number,
): PanelTopology {
  const centers = parent.vertices.map(([x, y, z]) =>
    new Vector3(x, y, z).normalize(),
  );
  const rho = circleSize * DEFAULT_RHO_PER_HALF_EDGE * (minEdgeAngle(parent) / 2);

  const vertices: Vector3[] = [];
  const add = (v: Vector3) => vertices.push(v) - 1;

  // Where circle a meets the seam toward b: ρ along the great arc a → b.
  const pointIndex = new Map<string, number>();
  const P = (a: number, b: number): number => {
    const key = `${a}-${b}`;
    let idx = pointIndex.get(key);
    if (idx === undefined) {
      const ca = centers[a];
      const u = centers[b]
        .clone()
        .sub(ca.clone().multiplyScalar(ca.dot(centers[b])))
        .normalize();
      idx = add(
        ca.clone().multiplyScalar(Math.cos(rho)).addScaledVector(u, Math.sin(rho)),
      );
      pointIndex.set(key, idx);
    }
    return idx;
  };

  const faces: number[][] = [];

  // Hexagons, one per icosahedron face, wound like the truncation family:
  // seam along (a,b), arc around b, seam along (b,c), arc around c, …
  for (const [a, b, c] of parent.faces) {
    faces.push([P(a, b), P(b, a), P(b, c), P(c, b), P(c, a), P(a, c)]);
  }
  const hexCount = faces.length;

  // Circles, one per icosahedron vertex: its five seam points sorted CCW
  // as seen from outside (atan2 in the center's tangent plane).
  const circleOf = new Map<number, number>(); // boundary point → circle center
  for (let v = 0; v < centers.length; v++) {
    const neighbors = new Set<number>();
    for (const face of parent.faces) {
      if (face.includes(v)) for (const x of face) if (x !== v) neighbors.add(x);
    }
    const n = centers[v];
    const ref = Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const e1 = ref.clone().projectOnPlane(n).normalize();
    const e2 = n.clone().cross(e1);
    const angle = (i: number) => Math.atan2(centers[i].dot(e2), centers[i].dot(e1));
    const loop = [...neighbors].sort((p, q) => angle(p) - angle(q)).map((x) => P(v, x));
    for (const i of loop) circleOf.set(i, v);
    faces.push(loop);
  }

  // Inserted vertices per undirected edge, shared by both adjacent panels
  // so the topology stays watertight. Stored in ascending-endpoint order.
  const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const inserted = new Map<string, number[]>();
  const edgePoints = (a: number, b: number): number[] => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = edgeKey(lo, hi);
    let pts = inserted.get(key);
    if (!pts) {
      pts = [];
      const vl = vertices[lo];
      const vh = vertices[hi];
      const center = circleOf.get(lo);
      if (center !== undefined && center === circleOf.get(hi)) {
        // Circle arc: rotate about the circle's axis, the short way round.
        const axis = centers[center];
        const pl = vl.clone().projectOnPlane(axis);
        const ph = vh.clone().projectOnPlane(axis);
        const sweep = Math.atan2(pl.clone().cross(ph).dot(axis), pl.dot(ph));
        const steps = Math.max(2, Math.ceil((Math.abs(sweep) * pl.length()) / MAX_ARC_STEP));
        for (let s = 1; s < steps; s++) {
          pts.push(add(vl.clone().applyAxisAngle(axis, (sweep * s) / steps)));
        }
      } else {
        // Straight seam: great-arc midpoints.
        const extra = Math.max(0, Math.ceil(vl.angleTo(vh) / MAX_EDGE_ANGLE) - 1);
        for (let s = 1; s <= extra; s++) {
          pts.push(add(vl.clone().lerp(vh, s / (extra + 1)).normalize()));
        }
      }
      inserted.set(key, pts);
    }
    return a < b ? pts : [...pts].reverse();
  };

  const loops = faces.map((loop) =>
    loop.flatMap((a, i) => [a, ...edgePoints(a, loop[(i + 1) % loop.length])]),
  );
  return topologyFromFaces(
    vertices.map((v) => [v.x, v.y, v.z] as const),
    loops,
    radius,
    (idx) =>
      `panel_${String(idx + 1).padStart(3, "0")}_${idx < hexCount ? "hexagon" : "circle"}`,
  );
}

/** Shortest edge of `parent`, as an angle between unit vertex directions. */
function minEdgeAngle(parent: CircleParent): number {
  const unit = parent.vertices.map(([x, y, z]) => new Vector3(x, y, z).normalize());
  let min = Infinity;
  for (const f of parent.faces) {
    for (let i = 0; i < 3; i++) {
      min = Math.min(min, unit[f[i]].angleTo(unit[f[(i + 1) % 3]]));
    }
  }
  return min;
}

// Pentagon circumradius over half the icosahedron edge, both as angles:
// the regular truncation point (t = 1/3 along an edge chord) seen from the
// pentagon's center, against half the center-to-center angle.
const DEFAULT_RHO_PER_HALF_EDGE = (() => {
  const [a, b] = ICOSAHEDRON.faces[0];
  const ca = new Vector3(...ICOSAHEDRON.vertices[a]).normalize();
  const cb = new Vector3(...ICOSAHEDRON.vertices[b]).normalize();
  return ca.angleTo(ca.clone().lerp(cb, 1 / 3)) / (ca.angleTo(cb) / 2);
})();
