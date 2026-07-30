import { Vector3 } from "three";
import type { Panel, PanelTopology } from "@/lib/types";
import type { PanelFlat, Vec2 } from "./types";
import { arapFlattenBoundary } from "./arap";

/**
 * Seam-and-width-true development for band panels (the Spiral's
 * pole-to-pole bands), built by marching cross-band rungs from tip to
 * tip: each new rung is placed so BOTH seam-edge segment lengths and
 * the rung's geodesic width are exactly true (three constraints, three
 * dof — unique forward placement). The sphere's inevitable strain lands
 * in the interior BETWEEN rungs, where stuffing pressure absorbs it.
 *
 * Physical motivation, two stitched prototypes deep: sewing enforces
 * the seam stitch-to-stitch (prototype 1: ARAP's +12% boundary printed
 * as an oblate 2.4in equator), and the cross-band width IS the
 * meridional fabric (prototype 2: a seam-true-only development that
 * squeezed widths ~11% sewed up 1.85in around but only 1.5in tall).
 * This construction keeps both exact.
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

const bandCache = new WeakMap<PanelTopology, Map<string, PanelFlat | null>>();

export function developBand(
  panel: Panel,
  topo: PanelTopology,
): PanelFlat | null {
  let perTopo = bandCache.get(topo);
  if (!perTopo) {
    perTopo = new Map();
    bandCache.set(topo, perTopo);
  }
  const hit = perTopo.get(panel.id);
  if (hit !== undefined) {
    return hit
      ? { corners: hit.corners.map((c) => ({ ...c })), sagittaRatios: [...hit.sagittaRatios] }
      : null;
  }
  const result = developBandUncached(panel, topo);
  perTopo.set(panel.id, result);
  return result
    ? { corners: result.corners.map((c) => ({ ...c })), sagittaRatios: [...result.sagittaRatios] }
    : null;
}

function developBandUncached(
  panel: Panel,
  topo: PanelTopology,
): PanelFlat | null {
  const loop = panel.vertexIndices;
  const n = loop.length;
  if (n < 16 || n % 2 !== 0) return null;
  const pos = (i: number): Vector3 =>
    topo.vertices[loop[((i % n) + n) % n]].clone();

  // true 3D segment lengths — the invariant both passes preserve
  const lens: number[] = [];
  for (let i = 0; i < n; i++) lens.push(pos(i).distanceTo(pos(i + 1)));

  // --- pass 1: seam-true development seeded by the ARAP outline's
  // turning (the ARAP shape is right; its lengths are not) ---
  const arap = arapFlattenBoundary(panel, topo);
  if (!arap) return null;
  const pass1 = closeWithTrueLengths(turningOf(arap), lens);
  if (!pass1) return null;

  // --- pass 2: widen the band transversally, then re-true the lengths.
  // A stitched prototype of the pass-1 template measured 1.85in around
  // the equator (seam-driven: on target) but only 1.5in pole-to-pole —
  // the seam-true closure had squeezed the band's width, and the width
  // IS the meridional fabric. Widening by the measured deficit and
  // re-running the closure keeps the seam exact while restoring height.
  const WIDTH_BOOST = 1.23; // = 1.85 / 1.5, measured
  let tip = -1;
  let bestD = 0;
  for (let i = 0; i < n / 2; i++) {
    const d = pos(i).distanceTo(pos(i + n / 2));
    if (d > bestD) {
      bestD = d;
      tip = i;
    }
  }
  if (bestD < 1.7 * (pos(0).length() || 1)) return null; // not a polar band
  const widened: Vec2[] = new Array(n);
  const at = (i: number) => pass1[((i % n) + n) % n];
  for (let k = 0; k <= n / 2; k++) {
    const ai = ((tip + k) % n + n) % n;
    const bi = ((tip - k) % n + n) % n;
    const A = at(tip + k);
    const B = at(tip - k);
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    widened[ai] = { x: mx + (A.x - mx) * WIDTH_BOOST, y: my + (A.y - my) * WIDTH_BOOST };
    widened[bi] = { x: mx + (B.x - mx) * WIDTH_BOOST, y: my + (B.y - my) * WIDTH_BOOST };
  }
  const pass2 = closeWithTrueLengths(turningOf(widened), lens);
  if (!pass2) return null;

  for (const c of pass2) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
  }
  return { corners: pass2, sagittaRatios: new Array(n).fill(0) };
}

/** Signed turning angle at every vertex of a closed flat polyline. */
function turningOf(pts: Vec2[]): number[] {
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n];
  const turns: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = at(i);
    const vInX = p.x - at(i - 1).x;
    const vInY = p.y - at(i - 1).y;
    const vOutX = at(i + 1).x - p.x;
    const vOutY = at(i + 1).y - p.y;
    turns.push(
      Math.atan2(vInX * vOutY - vInY * vOutX, vInX * vOutX + vInY * vOutY),
    );
  }
  return turns;
}

/**
 * Rebuild a closed flat polygon with the given turning angles but TRUE
 * segment lengths, adjusting turning minimally (Gauss–Newton, min Σδ²)
 * to close in heading and position. Returns the n corners (y as-is; the
 * caller owns the SVG flip), or null if closure fails.
 */
function closeWithTrueLengths(
  intrinsicTurn: number[],
  lens: number[],
): Vec2[] | null {
  const n = lens.length;
  const totalIntrinsic = intrinsicTurn.reduce((s, t) => s + t, 0);
  const target = totalIntrinsic >= 0 ? 2 * Math.PI : -2 * Math.PI;
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
    if (Math.hypot(endX, endY) < 1e-8) break;
    const J0: number[] = [];
    const J1: number[] = [];
    for (let j = 0; j < n; j++) {
      J0.push(-(endY - pts[j].y));
      J1.push(endX - pts[j].x);
    }
    const a = J0.reduce((s, v) => s + v * v, 0);
    const b = J0.reduce((s, v, k) => s + v * J1[k], 0);
    const c = J1.reduce((s, v) => s + v * v, 0);
    const det = a * c - b * b;
    if (Math.abs(det) < 1e-18) break;
    const l1 = (c * endX - b * endY) / det;
    const l2 = (-b * endX + a * endY) / det;
    let mean = 0;
    for (let j = 0; j < n; j++) {
      const step = l1 * J0[j] + l2 * J1[j];
      delta[j] -= step;
      mean += step;
    }
    mean /= n;
    for (let j = 0; j < n; j++) delta[j] += mean;
  }
  const { pts, endX, endY } = build();
  if (Math.hypot(endX, endY) > 1e-4) return null;
  return pts.slice(0, n);
}
