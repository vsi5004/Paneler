import { Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";
import {
  buildArrangement,
  traceFaces,
  arrangementTopology,
  type Arrangement,
  type Crossing,
} from "./arrangement";

/**
 * Band weaving: strands with WIDTH crossing over and under each other,
 * Celtic-knot style. Fabric panels cannot physically interlace — the
 * over/under is the classic knotwork drawing convention, realized in
 * seams: wherever strand U passes UNDER strand O, U's edges stop at O's
 * edges (U's edge arcs inside O's band are dissolved before face
 * tracing), so O's panel runs unbroken through the crossing while U is
 * visibly interrupted. Alternating along every strand produces the
 * authentic woven read once panels are colored per strand.
 *
 * A strand is a closed center curve plus a band width (geodesic offset
 * of ±width/2 gives its two edge curves). Width 0 makes a bare SEAM
 * strand — it has no panels of its own, but participates in the weave:
 * seam-over-band cuts the band into two panels with the seam running
 * through; band-over-seam interrupts the seam at the band's edges
 * (T-junctions), letting the band panel pass unbroken.
 *
 * Over/under assignment: crossings of the CENTER curves are ordered
 * along each strand and must alternate over/under cyclically. The
 * constraints propagate across strands as a parity union-find; designs
 * whose crossing parities contradict (non-alternating diagrams) throw.
 * Seam×seam crossings (e.g. gore meridians meeting at the poles) stay
 * plain 4-way panel corners and take no part in the alternation.
 */

export interface Strand {
  /** Closed center curve, unit sphere, sampled ~uniformly in arc length. */
  center: Vector3[];
  /** Geodesic band width in radians. 0 = bare seam. */
  width: number;
}

export interface BandWeaveResult {
  topology: PanelTopology;
  /** Strand index for band panels, -1 for background panels. */
  roles: Map<string, number>;
}

/**
 * Roles of every topology built by bandWeave, retrievable later by the
 * presets' defaultColors hooks (PresetEntry.topology can only return
 * the PanelTopology itself).
 */
export const bandWeaveRoles = new WeakMap<PanelTopology, Map<string, number>>();

export function bandWeave(strands: Strand[], radius = 1): BandWeaveResult {
  // --- center-level crossings + over/under assignment ---
  const centerArr = buildArrangement(strands.map((s) => s.center));
  const over = assignOverUnder(centerArr.crossings, strands);

  // --- edge-level curves ---
  const curves: Vector3[][] = [];
  const curveStrand: number[] = []; // strand index per edge curve
  for (let s = 0; s < strands.length; s++) {
    if (strands[s].width > 0) {
      curves.push(offsetCurve(strands[s].center, strands[s].width / 2));
      curveStrand.push(s);
      curves.push(offsetCurve(strands[s].center, -strands[s].width / 2));
      curveStrand.push(s);
    } else {
      curves.push(strands[s].center.map((p) => p.clone()));
      curveStrand.push(s);
    }
  }
  const arr = buildArrangement(curves);

  // --- dissolution: drop under-strand arcs inside the over band ---
  const keep = arr.arcs.filter((arc) => {
    const s = curveStrand[arc.curve];
    const mid = arr.vertices[arc.points[arc.points.length >> 1]];
    // nearest center-level crossing involving strand s
    let best = -1;
    let bestD = Infinity;
    centerArr.crossings.forEach((c, i) => {
      if (c.curveA !== s && c.curveB !== s) return;
      const d = mid.angleTo(c.point);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return true;
    const c = centerArr.crossings[best];
    const o = over.get(best); // strand index that goes over here
    if (o === undefined) return true; // neutral crossing (seam x seam)
    // the region of interest around the crossing
    const reach = (strands[c.curveA].width + strands[c.curveB].width) / 2 + 0.02;
    if (bestD > reach) return true;
    if (strands[o].width <= 0) return true; // a seam covers nothing
    // outside the over band → untouched
    if (distToPolyline(mid, strands[o].center) > strands[o].width / 2 - 1e-6) {
      return true;
    }
    // self-crossing: keep the arc iff it belongs to the over PASS
    if (c.curveA === c.curveB && c.curveA === s) {
      const param = paramOfMid(arc, arr, strands[s].center);
      const n = strands[s].center.length;
      const dA = cyclicDist(param, c.paramA, n);
      const dB = cyclicDist(param, c.paramB, n);
      return dA < dB ? (selfOverA.get(best) ?? true) : !(selfOverA.get(best) ?? true);
    }
    // ordinary crossing: keep iff this strand is the over one
    return o === s;
  });

  let removed: Arrangement = { ...arr, arcs: keep };
  let faces = traceFaces(removed);

  // Swallowtail cleanup: where a band edge's offset exceeds the center
  // curve's turning radius (the gore spiral's hairpins), the offset
  // curve self-crosses in a tiny loop and the trace yields degenerate
  // 1–2 vertex faces the mesher cannot triangulate. Dissolve one arc of
  // each degenerate face (merging it into a neighbor) and re-trace.
  for (let pass = 0; pass < 10; pass++) {
    const degenerate = new Set<number>();
    faces.forEach((loop, f) => {
      if (loop.length <= 2) degenerate.add(f);
    });
    if (degenerate.size === 0) break;
    const drop = new Set<number>();
    for (const f of degenerate) {
      const arcIdx = removed.arcs.findIndex(
        (a, i) => !drop.has(i) && (a.faceLeft === f || a.faceRight === f),
      );
      if (arcIdx >= 0) drop.add(arcIdx);
    }
    removed = { ...removed, arcs: removed.arcs.filter((_, i) => !drop.has(i)) };
    faces = traceFaces(removed);
  }

  const topology = arrangementTopology(removed, faces, radius);

  // --- roles: which strand's band is each face part of? ---
  const roles = classifyFaces(removed, faces, topology, strands, curveStrand);
  bandWeaveRoles.set(topology, roles);
  return { topology, roles };
}

// Filled by assignOverUnder for self-crossings: whether the "A pass"
// (paramA side) is the over pass.
const selfOverA = new Map<number, boolean>();

/**
 * Alternate over/under along every strand. Crossing variable: true =
 * the curveA side goes over. Consecutive crossings along a strand must
 * flip that strand's role, which links variables with a parity; solve
 * by union-find with parity and detect contradictions. Crossings of two
 * zero-width seams are neutral: excluded entirely.
 *
 * Returns crossingIdx → over STRAND index (undefined for neutral).
 */
function assignOverUnder(
  crossings: Crossing[],
  strands: Strand[],
): Map<number, number> {
  selfOverA.clear();
  const active = crossings
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => strands[c.curveA].width > 0 || strands[c.curveB].width > 0);

  // participations per strand, ordered along the center curve
  const perStrand = new Map<number, { idx: number; param: number; sideA: boolean }[]>();
  for (const { c, i } of active) {
    if (!perStrand.has(c.curveA)) perStrand.set(c.curveA, []);
    perStrand.get(c.curveA)!.push({ idx: i, param: c.paramA, sideA: true });
    if (!perStrand.has(c.curveB)) perStrand.set(c.curveB, []);
    perStrand.get(c.curveB)!.push({ idx: i, param: c.paramB, sideA: false });
  }

  // union-find with parity: rel[x] = parity of x relative to its root
  const parent = new Map<number, number>();
  const rel = new Map<number, number>();
  const find = (x: number): [number, number] => {
    if (parent.get(x) === undefined || parent.get(x) === x) {
      parent.set(x, x);
      rel.set(x, rel.get(x) ?? 0);
      return [x, 0];
    }
    const [root, r] = find(parent.get(x)!);
    const total = (r + rel.get(x)!) % 2;
    parent.set(x, root);
    rel.set(x, total);
    return [root, total];
  };
  const union = (x: number, y: number, parity: number): void => {
    const [rx, px] = find(x);
    const [ry, py] = find(y);
    if (rx === ry) {
      if ((px + py) % 2 !== parity) {
        throw new Error("bandWeave: weave is not alternating (parity conflict)");
      }
      return;
    }
    parent.set(ry, rx);
    rel.set(ry, (px + py + parity) % 2);
  };

  for (const [strandIdx, list] of perStrand) {
    // Alternation is a BAND property: the eye tracks a ribbon going
    // over, under, over. Zero-width seams take whatever the bands
    // decide at each crossing — constraining them too makes honest
    // designs unsolvable (the gore seams pass through the poles
    // between band crossings; no alternation is visible there).
    if (strands[strandIdx].width <= 0) continue;
    if (list.length % 2 !== 0) {
      throw new Error(
        `bandWeave: strand has ${list.length} crossings — alternation needs an even count`,
      );
    }
    list.sort((a, b) => a.param - b.param);
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      const b = list[(k + 1) % list.length];
      // "this strand over" state must flip between consecutive crossings.
      // Variable x_i = "curveA side over at crossing i"; this strand is
      // over at a participation iff (x == sideA).
      // flip constraint: (x_a == a.sideA) != (x_b == b.sideA)
      //   -> x_a XOR x_b = 1 XOR (a.sideA XOR b.sideA) ... derive:
      // (x_a XOR !a.sideA) XOR (x_b XOR !b.sideA) = 1
      const parity = (1 + (a.sideA ? 0 : 1) + (b.sideA ? 0 : 1)) % 2;
      union(a.idx, b.idx, parity);
    }
  }

  // resolve: root of each component gets value true (arbitrary sign)
  const result = new Map<number, number>();
  for (const { c, i } of active) {
    const [, r] = find(i);
    const aOver = r === 0; // root true, parity offsets
    result.set(i, aOver ? c.curveA : c.curveB);
    if (c.curveA === c.curveB) selfOverA.set(i, aOver);
  }
  return result;
}

/** Geodesic offset: rotate every sample toward its left normal by h. */
function offsetCurve(center: Vector3[], h: number): Vector3[] {
  const n = center.length;
  const out: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const p = center[i];
    const t = center[(i + 1) % n].clone().sub(center[(i - 1 + n) % n]);
    t.addScaledVector(p, -t.dot(p)); // project to tangent plane
    if (t.lengthSq() < 1e-18) {
      out.push(p.clone());
      continue;
    }
    t.normalize();
    const left = new Vector3().crossVectors(p, t); // unit, tangent, left of travel
    out.push(
      p
        .clone()
        .multiplyScalar(Math.cos(h))
        .addScaledVector(left, Math.sin(h))
        .normalize(),
    );
  }
  return out;
}

/** Angular distance from a point to a closed polyline (vertex-sampled). */
function distToPolyline(p: Vector3, poly: Vector3[]): number {
  let best = Infinity;
  for (const q of poly) best = Math.min(best, p.angleTo(q));
  return best;
}

/** Center-curve param nearest an arc's midpoint (edge samples map 1:1). */
function paramOfMid(
  arc: { points: number[] },
  arr: Arrangement,
  center: Vector3[],
): number {
  const mid = arr.vertices[arc.points[arc.points.length >> 1]];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < center.length; i++) {
    const d = mid.angleTo(center[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function cyclicDist(a: number, b: number, n: number): number {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
}

/**
 * Face roles by voting: each edge-curve arc knows which of its two
 * faces lies on the band side (toward the strand center); that face
 * collects a vote for the strand. Faces with no votes are background.
 * Merged over-band faces vote consistently (the under strand's edges
 * inside them were dissolved). Bare-seam arcs vote for nobody.
 */
function classifyFaces(
  arr: Arrangement,
  faces: number[][],
  topology: PanelTopology,
  strands: Strand[],
  curveStrand: number[],
): Map<string, number> {
  const votes: Map<number, number>[] = faces.map(() => new Map());
  for (const arc of arr.arcs) {
    const s = curveStrand[arc.curve];
    if (strands[s].width <= 0) continue;
    const k = arc.points.length >> 1;
    const m = arr.vertices[arc.points[k]];
    const nxt = arr.vertices[arc.points[Math.min(k + 1, arc.points.length - 1)]];
    const d = nxt.clone().sub(m);
    if (d.lengthSq() < 1e-18) continue;
    const left = new Vector3().crossVectors(m, d);
    // direction toward the strand center
    let cBest = strands[s].center[0];
    let cD = Infinity;
    for (const q of strands[s].center) {
      const dd = m.angleTo(q);
      if (dd < cD) {
        cD = dd;
        cBest = q;
      }
    }
    const toward = cBest.clone().sub(m);
    const bandFace = left.dot(toward) > 0 ? arc.faceLeft : arc.faceRight;
    votes[bandFace].set(s, (votes[bandFace].get(s) ?? 0) + 1);
  }
  const roles = new Map<string, number>();
  topology.panels.forEach((panel, i) => {
    let role = -1;
    let most = 0;
    for (const [s, v] of votes[i]) {
      if (v > most) {
        most = v;
        role = s;
      }
    }
    roles.set(panel.id, role);
  });
  return roles;
}

/** Closed great circle with the given plane normal. */
export function greatCircle(normal: Vector3, samples = 256): Vector3[] {
  const n = normal.clone().normalize();
  const helper = Math.abs(n.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(n, helper).normalize();
  const v = new Vector3().crossVectors(n, u);
  const pts: Vector3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * 2 * Math.PI;
    pts.push(u.clone().multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t)));
  }
  return pts;
}

/** Knotwork strand colors shared by the band-weave presets. */
export const STRAND_COLORS = ["#b03a2e", "#1f618d", "#196f3d", "#b7950b"];

/**
 * Default panel colors from roles: strands cycle through a knotwork
 * palette, background gets parchment. Used by presets' defaultColors.
 */
export function roleColors(
  topology: PanelTopology,
  roles: Map<string, number>,
  strandColors: string[],
  background = "#e8e0cd",
): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const panel of topology.panels) {
    const role = roles.get(panel.id) ?? -1;
    colors[panel.id] =
      role >= 0 ? strandColors[role % strandColors.length] : background;
  }
  return colors;
}
