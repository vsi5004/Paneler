import { Vector3 } from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import type { PanelTopology } from "@/lib/types";
import { topologyFromFaces } from "@/lib/topology/fromFaces";
import { icosahedralGroup, type RotationGroup } from "./groups";
import { drift, mulberry32, randomUnit } from "./random";

/**
 * Kaleidoscope panel layout: a symmetric set of seed points on the sphere,
 * each panel being the region a seed "wins" in a weighted (power) Voronoi
 * diagram. Every seed belongs to a whole icosahedral orbit — a family —
 * so the panels are exactly symmetric at every moment.
 *
 * Families live and die. A seed p with weight s wins the directions x
 * where x·(s·p) beats every other seed, so cells are convex with
 * great-arc seams (the planes x·(sᵢpᵢ − sⱼpⱼ) = 0 pass through the
 * center), and they come straight from the convex hull of the weighted
 * points. Shrinking a family's weight below the hull makes its 60 (or 20,
 * or 30) panels contract to points and vanish; raising it grows them back
 * from points. Panel count therefore changes smoothly as the design
 * plays, between 12 and 242, never by popping.
 *
 * Families:
 *  - the 12 five-fold panels: always alive (the focal points);
 *  - the 20 three-fold and 30 two-fold families: born and dying;
 *  - three generic families of 60, each a free representative copied by
 *    all 60 rotations, wandering around a home position.
 * Homes come from a symmetric Lloyd relaxation of the full layout, so
 * any mix of live families stays evenly spaced. Every motion is a sum of
 * sines at pairwise-irrational frequencies (see `drift`), so the design
 * never repeats.
 */

export interface Family {
  /** Panel-id suffix, also the paint-by-shape group. */
  tag: string;
  /** Offset of this family's first panel in the id numbering. */
  offset: number;
  size: number;
}

export interface Frame {
  /** Seed directions, and their weights, per live family's members. */
  seeds: Vector3[];
  weights: number[];
  /** Family index and member index per seed. */
  familyOf: number[];
  memberOf: number[];
  /** Seam junctions (cell corners) and, per junction, its neighbours. */
  junctions: Vector3[];
  junctionNeighbors: number[][];
  /** Per seed: its cell's corners (indices into `junctions`), CCW. Empty = dead. */
  cells: number[][];
}

const GENERIC_FAMILIES = 3;
/** Weight that a dead family sinks to (well inside the hull). */
const DEAD_WEIGHT = 0.82;
/** Half-width of the life transition, in drift units. */
const LIFE_EDGE = 0.18;
/** Base rates, cycles per time unit. */
const LIFE_RATE = 1 / 45;
const WANDER_RATE = 1 / 30;
/** Wander radius as a fraction of a rep's gap to its nearest neighbour. */
const WANDER_FRACTION = 0.22;
/**
 * Longest straight seam segment before the warp, radians. The warp
 * stretches seams (see field.ts), and the stretched segments become the
 * seam polyline the flat net and laser templates cut along.
 */
const MAX_EDGE_ANGLE = (2 * Math.PI) / 180;
const MERGE_EPS_SQ = 1e-12;
const LLOYD_ITERATIONS = 40;

export const FAMILIES: Family[] = (() => {
  const sizes = [12, 20, 30, ...Array(GENERIC_FAMILIES).fill(60)];
  const tags = ["axis5", "axis3", "axis2", ...Array.from({ length: GENERIC_FAMILIES }, (_, k) => `swirl${k + 1}`)];
  let offset = 0;
  return sizes.map((size, i) => {
    const f = { tag: tags[i], offset, size };
    offset += size;
    return f;
  });
})();

interface Homes {
  reps: Vector3[];
  gaps: number[];
}

let homesCache: Homes | null = null;

/** Relaxed home positions for the generic families (all families alive). */
function homes(group: RotationGroup): Homes {
  if (homesCache) return homesCache;
  const fixed = group.specialOrbits.flat();
  const expand = (reps: Vector3[]) => [
    ...fixed,
    ...reps.flatMap((r) => group.elements.map((m) => r.clone().applyMatrix3(m))),
  ];
  // Best-candidate start: each rep where its images sit farthest from
  // everything placed so far, its own images included (off the axes).
  const rand = mulberry32(0x9e3779b9);
  const reps: Vector3[] = [];
  for (let k = 0; k < GENERIC_FAMILIES; k++) {
    const placed = expand(reps);
    let best = new Vector3(1, 0, 0);
    let bestGap = -1;
    for (let c = 0; c < 120; c++) {
      const cand = randomUnit(rand);
      let gap = Infinity;
      for (let a = 1; a < group.elements.length; a++) {
        gap = Math.min(gap, cand.distanceTo(cand.clone().applyMatrix3(group.elements[a])));
      }
      for (const q of placed) gap = Math.min(gap, cand.distanceTo(q));
      if (gap > bestGap) {
        bestGap = gap;
        best = cand;
      }
    }
    reps.push(best);
  }
  // Symmetric Lloyd relaxation: move each rep to its cell's centroid; the
  // other 59 copies follow by symmetry.
  for (let it = 0; it < LLOYD_ITERATIONS; it++) {
    const seeds = expand(reps);
    const d = powerDiagram(seeds, seeds.map(() => 1));
    reps.forEach((_, k) => {
      const i = fixed.length + k * group.elements.length;
      reps[k] = cellCentroid(seeds[i], d.vertices, d.loops[i]);
    });
  }
  const seeds = expand(reps);
  const gaps = reps.map((r) => {
    let gap = Infinity;
    for (const q of seeds) {
      const dist = r.distanceTo(q);
      if (dist > 1e-9) gap = Math.min(gap, dist);
    }
    return gap / 2;
  });
  homesCache = { reps, gaps };
  return homesCache;
}

// Per-family signals, built once.
const lifeSignals = FAMILIES.map((_, i) => drift(0x1f00 + i * 977, LIFE_RATE));
const pulseSignals = FAMILIES.map((_, i) => drift(0x2f00 + i * 613, LIFE_RATE * 2));
const wanderSignals = Array.from({ length: GENERIC_FAMILIES }, (_, k) => [
  drift(0x3f00 + k * 389, WANDER_RATE),
  drift(0x4f00 + k * 211, WANDER_RATE),
]);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Family weight at `time`: ~1 alive (with a gentle pulse), DEAD_WEIGHT dead. */
function familyWeight(i: number, time: number): number {
  const pulse = 1 + 0.03 * pulseSignals[i](time);
  if (i === 0) return pulse; // the 12 focal panels never die
  const life = smoothstep(-LIFE_EDGE, LIFE_EDGE, lifeSignals[i](time));
  return DEAD_WEIGHT + (pulse - DEAD_WEIGHT) * life;
}

let frameCache: { time: number; frame: Frame } | null = null;

/** The layout at `time` (the last frame is cached: topology and warp share it). */
export function frameAt(time: number): Frame {
  if (frameCache && frameCache.time === time) return frameCache.frame;
  const group = icosahedralGroup();
  const home = homes(group);
  const seeds: Vector3[] = [];
  const weights: number[] = [];
  const familyOf: number[] = [];
  const memberOf: number[] = [];
  const push = (p: Vector3, w: number, f: number, m: number) => {
    seeds.push(p);
    weights.push(w);
    familyOf.push(f);
    memberOf.push(m);
  };
  group.specialOrbits.forEach((orbit, f) => {
    const w = familyWeight(f, time);
    orbit.forEach((p, m) => push(p.clone(), w, f, m));
  });
  home.reps.forEach((rep, k) => {
    const f = 3 + k;
    const w = familyWeight(f, time);
    const rand = mulberry32(0x51ed27 + k * 7919);
    const u = randomUnit(rand).projectOnPlane(rep).normalize();
    const v = rep.clone().cross(u);
    const amp = WANDER_FRACTION * 2 * home.gaps[k];
    const [a, b] = wanderSignals[k];
    const moved = rep
      .clone()
      .addScaledVector(u, amp * a(time))
      .addScaledVector(v, amp * b(time))
      .normalize();
    group.elements.forEach((m, e) => push(moved.clone().applyMatrix3(m), w, f, e));
  });

  const d = powerDiagram(seeds, weights);
  const frame: Frame = {
    seeds,
    weights,
    familyOf,
    memberOf,
    junctions: d.vertices,
    junctionNeighbors: d.neighbors,
    cells: d.loops,
  };
  frameCache = { time, frame };
  return frame;
}

/**
 * Spherical power diagram via the convex hull of the weighted points:
 * each hull face's outward normal is a cell corner (merged when
 * cocircular seeds — common in symmetric layouts — produce duplicates);
 * a seed inside the hull has no cell. Loops list corners counter-
 * clockwise as seen from outside.
 */
function powerDiagram(
  seeds: Vector3[],
  weights: number[],
): { vertices: Vector3[]; loops: number[][]; neighbors: number[][] } {
  const points = seeds.map((p, i) => p.clone().multiplyScalar(weights[i]));
  const hull = new ConvexHull().setFromPoints(points);
  const indexOf = new Map<Vector3, number>(points.map((p, i) => [p, i]));
  const vertices: Vector3[] = [];
  const merge = (v: Vector3): number => {
    const hit = vertices.findIndex((r) => r.distanceToSquared(v) < MERGE_EPS_SQ);
    return hit >= 0 ? hit : vertices.push(v) - 1;
  };
  const incident: number[][] = seeds.map(() => []);
  for (const face of hull.faces) {
    const tri: number[] = [];
    let e = face.edge;
    do {
      tri.push(indexOf.get(e.head().point)!);
      e = e.next;
    } while (e !== face.edge);
    const [a, b, c] = tri.map((i) => points[i]);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (n.dot(a) < 0) n.negate();
    const vi = merge(n);
    for (const i of tri) incident[i].push(vi);
  }
  const neighbors = vertices.map(() => new Set<number>());
  const loops = seeds.map((s, i) => {
    const corners = [...new Set(incident[i])];
    if (corners.length < 3) return [];
    // Sort around the cell's own center (the seed can sit outside a
    // shrunken cell).
    const c = corners.reduce((acc, v) => acc.add(vertices[v]), new Vector3()).normalize();
    const ref = Math.abs(c.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const e1 = ref.projectOnPlane(c).normalize();
    const e2 = c.clone().cross(e1);
    const angle = (v: number) => Math.atan2(vertices[v].dot(e2), vertices[v].dot(e1));
    const loop = corners.sort((p, q) => angle(p) - angle(q));
    loop.forEach((v, k) => {
      const w = loop[(k + 1) % loop.length];
      neighbors[v].add(w);
      neighbors[w].add(v);
    });
    return loop;
  });
  return { vertices, loops, neighbors: neighbors.map((s) => [...s]) };
}

/** Area-weighted centroid of a spherical cell (fan from its seed). */
function cellCentroid(seed: Vector3, vertices: Vector3[], loop: number[]): Vector3 {
  const c = new Vector3();
  for (let k = 0; k < loop.length; k++) {
    const a = vertices[loop[k]];
    const b = vertices[loop[(k + 1) % loop.length]];
    const area = a.clone().sub(seed).cross(b.clone().sub(seed)).length();
    c.addScaledVector(seed.clone().add(a).add(b), area);
  }
  return c.normalize();
}

/**
 * The frame's live cells as a PanelTopology: one convex panel per live
 * seed, seams densified with shared great-arc points so the warp bends
 * them smoothly. Panel ids are frozen to family and member
 * (`panel_075_swirl1`), so a panel keeps its id — and its color — for as
 * long as it lives, and gets the same id back when its family returns.
 */
export function frameTopology(frame: Frame, radius = 1): PanelTopology {
  const live = frame.cells
    .map((loop, i) => ({ loop, i }))
    .filter(({ loop }) => loop.length >= 3);
  const vertices = frame.junctions.map((v) => v.clone());
  const inserted = new Map<string, number[]>();
  const densified = live.map(({ loop }) =>
    loop.flatMap((a, k) => {
      const b = loop[(k + 1) % loop.length];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}-${hi}`;
      let pts = inserted.get(key);
      if (!pts) {
        pts = [];
        const extra = Math.max(
          0,
          Math.ceil(vertices[lo].angleTo(vertices[hi]) / MAX_EDGE_ANGLE) - 1,
        );
        for (let s = 1; s <= extra; s++) {
          pts.push(
            vertices.push(vertices[lo].clone().lerp(vertices[hi], s / (extra + 1)).normalize()) - 1,
          );
        }
        inserted.set(key, pts);
      }
      return [a, ...(a < b ? pts : [...pts].reverse())];
    }),
  );
  return topologyFromFaces(
    vertices.map((v) => [v.x, v.y, v.z] as const),
    densified,
    radius,
    (idx) => {
      const i = live[idx].i;
      const fam = FAMILIES[frame.familyOf[i]];
      return `panel_${String(fam.offset + frame.memberOf[i] + 1).padStart(3, "0")}_${fam.tag}`;
    },
  );
}
