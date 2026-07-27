import { Vector3 } from "three";
import type { Panel, PanelTopology } from "@/lib/types";
import type { PanelFlat, Vec2 } from "./types";
import { arapFlattenBoundary } from "./arap";

/**
 * Seam-true development for band panels (the Spiral's pole-to-pole
 * bands): a closed flat outline whose every segment keeps its TRUE 3D
 * length, with the turning adjusted minimally to close.
 *
 * Physical motivation (from a stitched prototype): sewing enforces the
 * seam's length stitch-to-stitch, so boundary error prints directly
 * onto the ball — an ARAP development carried +12% seam length and
 * produced an oblate bag (2.4in equator on 1.9in height). The interior,
 * shaped by stuffing pressure, tolerates strain far better.
 *
 * Construction: develop the closed seam intrinsically (true chord
 * lengths, true geodesic turning at every vertex). For a half-sphere
 * panel the total geodesic turning is ~0 while a simple flat loop needs
 * 2π, so the raw development cannot close; the deficit is added as a
 * per-vertex turning correction δ solved by Gauss–Newton with minimum
 * Σδ² subject to heading + position closure. The correction spreads as
 * near-uniform extra curvature — the strip bends gently into a closed
 * crescent — and segment lengths are untouched, so the seam is exact.
 *
 * Interior cost: substituting true lengths shrinks the enclosed area
 * (spiral at twist 100: ~0.79 of the spherical area — the interior sews
 * up taut and the stuffing pressure rounds it). Routing is an explicit
 * per-preset choice (seamTrueFlatten), not geometric guessing: whether
 * the seam or the interior should carry the error is a property of the
 * DESIGN and its sewing style, not something the boundary curve can
 * decide.
 */

export function developBand(
  panel: Panel,
  topo: PanelTopology,
): PanelFlat | null {
  const loop = panel.vertexIndices;
  const n = loop.length;
  if (n < 16) return null;
  const pos = (i: number): Vector3 =>
    topo.vertices[loop[((i % n) + n) % n]].clone();

  // --- hybrid data: TRUE 3D segment lengths + the ARAP development's
  // turning angles. Pure intrinsic turning (the seam's own geodesic
  // curvature) closes into a shape with only ~56% of the panel's area —
  // ARAP's turning encodes the correct overall crescent shape, and
  // substituting true lengths under it fixes the seam while perturbing
  // the shape only by the (bounded) length correction. ---
  const arap = arapFlattenBoundary(panel, topo);
  if (!arap) return null;
  const lens: number[] = [];
  for (let i = 0; i < n; i++) lens.push(pos(i).distanceTo(pos(i + 1)));
  const at = (i: number): Vec2 => arap[((i % n) + n) % n];
  const intrinsicTurn: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = at(i);
    const vInX = p.x - at(i - 1).x;
    const vInY = p.y - at(i - 1).y;
    const vOutX = at(i + 1).x - p.x;
    const vOutY = at(i + 1).y - p.y;
    intrinsicTurn.push(
      Math.atan2(vInX * vOutY - vInY * vOutX, vInX * vOutX + vInY * vOutY),
    );
  }
  const totalIntrinsic = intrinsicTurn.reduce((s, t) => s + t, 0);
  // ARAP turning already sums to ±2π (its outline closes); the residual
  // is numeric noise plus the length-substitution misclosure.
  const target = totalIntrinsic >= 0 ? 2 * Math.PI : -2 * Math.PI;

  // --- Gauss–Newton: turns t = intrinsic + δ, min Σδ² s.t.
  //   Σt = target (heading closure) and the polygon closes in position.
  const delta = new Float64Array(n).fill((target - totalIntrinsic) / n);
  const build = (): { pts: Vec2[]; endX: number; endY: number } => {
    const pts: Vec2[] = [{ x: 0, y: 0 }];
    let heading = 0;
    for (let i = 0; i < n; i++) {
      heading += intrinsicTurn[i] + delta[i];
      const last = pts[pts.length - 1];
      pts.push({
        x: last.x + lens[i] * Math.cos(heading),
        y: last.y + lens[i] * Math.sin(heading),
      });
    }
    const end = pts[pts.length - 1];
    return { pts, endX: end.x, endY: end.y };
  };
  for (let iter = 0; iter < 100; iter++) {
    const { pts, endX, endY } = build();
    const err = Math.hypot(endX, endY);
    if (err < 1e-10) break;
    // Jacobian of the end position wrt δ_j: rotating everything after
    // vertex j about P_j by dδ moves the end by i·(P_end − P_j).
    // Constraints: g1 = endX, g2 = endY, g3 = Σδ − (target − Στ) = 0
    // (g3 is maintained exactly by construction of the update).
    const J: number[][] = [[], []];
    for (let j = 0; j < n; j++) {
      const pj = pts[j];
      J[0].push(-(endY - pj.y));
      J[1].push(endX - pj.x);
    }
    // min-norm update: δ ← δ − Jᵀ(JJᵀ)⁻¹ g, then re-center to keep Σδ.
    const a = J[0].reduce((s, v) => s + v * v, 0);
    const b = J[0].reduce((s, v, k) => s + v * J[1][k], 0);
    const c = J[1].reduce((s, v) => s + v * v, 0);
    const det = a * c - b * b;
    if (Math.abs(det) < 1e-18) break;
    const lam1 = (c * endX - b * endY) / det;
    const lam2 = (-b * endX + a * endY) / det;
    let mean = 0;
    for (let j = 0; j < n; j++) {
      const step = lam1 * J[0][j] + lam2 * J[1][j];
      delta[j] -= step;
      mean += step;
    }
    mean /= n;
    for (let j = 0; j < n; j++) delta[j] += mean; // restore Σδ
  }
  const { pts, endX, endY } = build();
  if (Math.hypot(endX, endY) > 1e-4) return null; // failed to close

  const outline = pts.slice(0, n);

  // SVG y-flip convention, matching every other flatten.
  return {
    corners: outline.map((p) => ({ x: p.x, y: -p.y })),
    sagittaRatios: new Array(n).fill(0),
  };
}
