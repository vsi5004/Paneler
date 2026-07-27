import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";

/**
 * "Spiral" — two congruent panels separated by a single seam that
 * spirals from pole to pole and back (the classic apple-peel ball).
 *
 * The seam is two interleaved spherical spirals 180° apart in
 * longitude:
 *
 *   spiral A: λ(θ) = twist · 2π · (π − θ)/π      (south → north)
 *   spiral B: λ(θ) = spiral A + π                 (north → south)
 *
 * where θ is the polar angle. Joined at the poles they form one closed
 * curve; each spiral enters a pole along meridian λ and leaves along
 * λ + π, i.e. straight through — the seam is smooth everywhere, no
 * corners at all (like the baseball).
 *
 * Every latitude band is split into two half-turns of longitude, so the
 * two panels are congruent by construction (rotate 180° about the polar
 * axis) and each has exactly half the sphere: a band that is widest at
 * the equator and tapers into both poles, wound `twist` turns.
 *
 * twist = 0 degenerates to two hemispheres split by a meridian circle.
 *
 * Sampling is uniform in seam arc length (a θ-uniform sampling gets
 * coarse at the equator once the spiral tilts), scaled with twist so
 * the visible seam stays smooth.
 */
export function spiral(radius = 1, twist = 1): PanelTopology {
  // Longitude advance per unit polar angle.
  const T = (twist * 2 * Math.PI) / Math.PI;

  // Arc length of one spiral branch: ∫ sqrt(1 + T² sin²θ) dθ over [0, π].
  const ARC_STEPS = 2048;
  const cumArc: number[] = [0];
  let arc = 0;
  for (let i = 0; i < ARC_STEPS; i++) {
    const th = ((i + 0.5) / ARC_STEPS) * Math.PI;
    arc += Math.sqrt(1 + T * T * Math.sin(th) * Math.sin(th)) * (Math.PI / ARC_STEPS);
    cumArc.push(arc);
  }
  const thetaAtArc = (s: number): number => {
    // invert the cumulative table (s in [0, arc])
    let lo = 0;
    let hi = ARC_STEPS;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cumArc[mid] <= s) lo = mid;
      else hi = mid;
    }
    const f =
      cumArc[hi] > cumArc[lo] ? (s - cumArc[lo]) / (cumArc[hi] - cumArc[lo]) : 0;
    return ((lo + f) / ARC_STEPS) * Math.PI;
  };

  // Samples per branch, scaled with the branch's true length.
  const perBranch = Math.max(48, Math.round(24 * arc));

  const pointAt = (theta: number, lonOffset: number): Vector3 => {
    const lon = T * (Math.PI - theta) + lonOffset;
    const v = new Vector3(
      Math.sin(theta) * Math.cos(lon),
      Math.sin(theta) * Math.sin(lon),
      Math.cos(theta),
    );
    return v.setLength(radius);
  };

  const vertices: Vector3[] = [];
  // south pole → spiral A up → north pole → spiral B down → (close)
  vertices.push(new Vector3(0, 0, -radius)); // south pole
  for (let i = perBranch - 1; i >= 1; i--) {
    // arc position from the north end so the pole approaches are sampled
    // symmetrically; θ runs π → 0 as we walk A upward
    vertices.push(pointAt(thetaAtArc((i / perBranch) * arc), 0));
  }
  vertices.push(new Vector3(0, 0, radius)); // north pole
  for (let i = 1; i <= perBranch - 1; i++) {
    vertices.push(pointAt(thetaAtArc((i / perBranch) * arc), Math.PI));
  }

  const n = vertices.length;
  const indicesAsc = Array.from({ length: n }, (_, i) => i);
  const indicesDesc = [...indicesAsc].reverse();

  const shape = shapeForVertexCount(n); // > 6 → "polygon"
  const panels = [
    { id: panelId(0, shape), vertexIndices: indicesAsc, shape },
    { id: panelId(1, shape), vertexIndices: indicesDesc, shape },
  ];

  const edges: PanelEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = i;
    const b = (i + 1) % n;
    edges.push({
      vertexA: Math.min(a, b),
      vertexB: Math.max(a, b),
      panelA: panels[0].id,
      panelB: panels[1].id,
    });
  }

  return { vertices, panels, edges };
}
