import type { PanelTopology } from "@/lib/types";
import { flattenPanelUnscaled } from "@/lib/flatten/unfoldNet";
import {
  buildCurvedPanelPath,
  sampleOutline,
  type OutlineSample,
} from "@/lib/flatten/panelPath";
import type { PanelFlat, Vec2 } from "@/lib/flatten/types";
import {
  CORNER_MARGIN_MM,
  HOLE_BUNCHING_MM,
  HOLE_SPACING_MM,
  MARGIN_MM,
  SAMPLE_STEP_MM,
  mmPerUnit,
} from "./constants";
import type { LaserSettings, LaserTemplate, PanelClass } from "./types";

/**
 * Build the laser template for one panel class: seam outline (the
 * flattened panel at physical scale), cut outline (seam offset outward by
 * bite depth, round corner joins), and stitch holes on the seam line.
 */
export function buildLaserTemplate(
  topo: PanelTopology,
  cls: PanelClass,
  settings: LaserSettings,
): LaserTemplate {
  const scale = mmPerUnit(settings.diameterIn);
  const unscaled = flattenPanelUnscaled(cls.representative, topo);
  const flatMm: PanelFlat = {
    corners: unscaled.corners.map((c) => ({ x: c.x * scale, y: c.y * scale })),
    sagittaRatios: unscaled.sagittaRatios,
  };

  const samples = sampleOutline(flatMm, SAMPLE_STEP_MM);
  const seamPath = buildCurvedPanelPath(flatMm);
  const cutPoints = offsetOutline(samples, settings.biteDepthMm);
  const cutPath = polylinePath(cutPoints);
  const holes = placeStitchHoles(topo, cls, flatMm, samples);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of [...cutPoints, ...holes]) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    classKey: cls.key,
    label: cls.label,
    count: cls.panelIds.length,
    seamPath,
    cutPath,
    holes,
    bounds: {
      minX: minX - MARGIN_MM,
      minY: minY - MARGIN_MM,
      width: maxX - minX + 2 * MARGIN_MM,
      height: maxY - minY + 2 * MARGIN_MM,
    },
  };
}

/**
 * Offset the sampled seam outline outward by `depth` mm.
 *
 * - Each sample moves along its outward normal.
 * - Where consecutive normals disagree by more than ~5° (panel corners),
 *   an arc fan of intermediate points is inserted — a round join, which
 *   cuts cleanly on a laser.
 * - A prune pass then drops any offset point that ended up closer than
 *   `depth − ε` to the seam polyline. On concave stretches (trionda
 *   pinwheel arms) naive per-sample offsets cross each other; pruning
 *   the too-close points and connecting the survivors in order yields a
 *   simple, valid cut loop.
 */
export function offsetOutline(
  samples: OutlineSample[],
  depth: number,
): Vec2[] {
  if (samples.length === 0) return [];
  const out: Vec2[] = [];
  const n = samples.length;
  const JOIN_THRESHOLD = (5 * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const cur = samples[i];
    const next = samples[(i + 1) % n];
    out.push({
      x: cur.p.x + cur.nOut.x * depth,
      y: cur.p.y + cur.nOut.y * depth,
    });
    // Angle between consecutive outward normals; positive cross = convex
    // turn (fan needed), concave turns overlap and get pruned instead.
    const dot = cur.nOut.x * next.nOut.x + cur.nOut.y * next.nOut.y;
    const cross = cur.nOut.x * next.nOut.y - cur.nOut.y * next.nOut.x;
    const angle = Math.atan2(Math.abs(cross), dot);
    const sameCorner =
      Math.hypot(next.p.x - cur.p.x, next.p.y - cur.p.y) < SAMPLE_STEP_MM / 4;
    if (angle > JOIN_THRESHOLD && (sameCorner || angle > Math.PI / 6)) {
      const steps = Math.ceil(angle / JOIN_THRESHOLD);
      const a0 = Math.atan2(cur.nOut.y, cur.nOut.x);
      let delta = Math.atan2(next.nOut.y, next.nOut.x) - a0;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      for (let k = 1; k < steps; k++) {
        const a = a0 + (delta * k) / steps;
        out.push({
          x: cur.p.x + Math.cos(a) * depth,
          y: cur.p.y + Math.sin(a) * depth,
        });
      }
    }
  }

  // Prune points that fell closer than depth − ε to the seam (concave
  // self-intersections). Survivors stay in order, so joining them
  // preserves a simple loop.
  const eps = 0.05;
  const minAllowed = depth - eps;
  return out.filter((p) => {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const a = samples[i].p;
      const b = samples[(i + 1) % n].p;
      const d = pointSegmentDistance(p, a, b);
      if (d < best) best = d;
      if (best < minAllowed) return false;
    }
    return true;
  });
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t =
    lenSq > 0
      ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq))
      : 0;
  const dx = p.x - (a.x + abx * t);
  const dy = p.y - (a.y + aby * t);
  return Math.hypot(dx, dy);
}

function polylinePath(points: Vec2[]): string {
  if (points.length === 0) return "";
  const parts = [`M ${points[0].x.toFixed(3)} ${points[0].y.toFixed(3)}`];
  for (let i = 1; i < points.length; i++) {
    parts.push(`L ${points[i].x.toFixed(3)} ${points[i].y.toFixed(3)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/**
 * Place stitch holes along the seam line, one run at a time.
 *
 * A "run" is a maximal sequence of consecutive boundary edges that share
 * the same neighbouring panel — for polyhedral panels that's one edge;
 * for imported wavy panels (trionda's densified boundary) it's the whole
 * shared stretch, so hole spacing flows continuously along the curve
 * instead of restarting at every micro-edge.
 *
 * Within a run: the largest even hole count n with
 * `(n−1)·spacing − bunching ≤ usable` is centered on the run, holes laid
 * with alternating gaps (spacing − bunching, spacing + bunching). Even
 * counts + centering make the pattern reversal-symmetric, so the two
 * panels sharing a seam get matching holes.
 */
function placeStitchHoles(
  topo: PanelTopology,
  cls: PanelClass,
  flatMm: PanelFlat,
  samples: OutlineSample[],
): Vec2[] {
  const loop = cls.representative.vertexIndices;
  const nEdges = loop.length;

  // Neighbour panel id per boundary edge.
  const neighborOf = new Map<string, string | null>();
  for (const e of topo.edges) {
    const key = `${Math.min(e.vertexA, e.vertexB)}-${Math.max(e.vertexA, e.vertexB)}`;
    neighborOf.set(
      key,
      e.panelA === cls.representative.id ? e.panelB : e.panelA,
    );
  }
  const edgeNeighbor = (i: number): string | null => {
    const a = loop[i];
    const b = loop[(i + 1) % nEdges];
    return (
      neighborOf.get(`${Math.min(a, b)}-${Math.max(a, b)}`) ?? null
    );
  };

  // Split edge indices into runs of equal neighbour. Start at a run
  // boundary so a run never wraps split.
  let start = 0;
  for (let i = 0; i < nEdges; i++) {
    if (edgeNeighbor(i) !== edgeNeighbor((i - 1 + nEdges) % nEdges)) {
      start = i;
      break;
    }
  }
  const runs: number[][] = [];
  let current: number[] = [];
  for (let k = 0; k < nEdges; k++) {
    const i = (start + k) % nEdges;
    if (
      current.length > 0 &&
      edgeNeighbor(i) !== edgeNeighbor(current[current.length - 1])
    ) {
      runs.push(current);
      current = [];
    }
    current.push(i);
  }
  if (current.length > 0) runs.push(current);

  // Arc-length span per edge from the samples.
  const totalLength = samples.length
    ? samples[samples.length - 1].s +
      Math.hypot(
        samples[0].p.x - samples[samples.length - 1].p.x,
        samples[0].p.y - samples[samples.length - 1].p.y,
      )
    : 0;
  const edgeStart = new Map<number, number>();
  const edgeEnd = new Map<number, number>();
  for (const smp of samples) {
    if (!edgeStart.has(smp.edgeIndex)) edgeStart.set(smp.edgeIndex, smp.s);
    edgeEnd.set(smp.edgeIndex, smp.s);
  }

  const holes: Vec2[] = [];
  for (const run of runs) {
    const s0 = edgeStart.get(run[0]);
    const lastEdge = run[run.length - 1];
    // Run end = start of the edge after the run (wrap → total length).
    const nextEdge = (lastEdge + 1) % nEdges;
    let s1 =
      nextEdge === 0 || !edgeStart.has(nextEdge)
        ? totalLength
        : edgeStart.get(nextEdge)!;
    if (s0 === undefined) continue;
    if (s1 < s0) s1 = totalLength; // wrapped run guard
    const usable = s1 - s0 - 2 * CORNER_MARGIN_MM;
    if (usable < 1) continue;

    let n = 2 * Math.floor((usable + HOLE_BUNCHING_MM + HOLE_SPACING_MM) / (2 * HOLE_SPACING_MM));
    while (n >= 2 && (n - 1) * HOLE_SPACING_MM - HOLE_BUNCHING_MM > usable) {
      n -= 2;
    }
    let span: number;
    if (n < 2) {
      n = 1;
      span = 0;
    } else {
      span = (n - 1) * HOLE_SPACING_MM - HOLE_BUNCHING_MM;
    }
    let s = s0 + CORNER_MARGIN_MM + (usable - span) / 2;
    for (let k = 0; k < n; k++) {
      holes.push(pointAtArcLength(samples, s, totalLength));
      s +=
        k % 2 === 0
          ? HOLE_SPACING_MM - HOLE_BUNCHING_MM
          : HOLE_SPACING_MM + HOLE_BUNCHING_MM;
    }
  }
  return holes;
}

function pointAtArcLength(
  samples: OutlineSample[],
  s: number,
  totalLength: number,
): Vec2 {
  const n = samples.length;
  const target = ((s % totalLength) + totalLength) % totalLength;
  // Binary search the last sample with sample.s <= target.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].s <= target) lo = mid;
    else hi = mid - 1;
  }
  const a = samples[lo];
  const b = samples[(lo + 1) % n];
  const segLen =
    (lo + 1 < n ? b.s : totalLength) - a.s || 1e-12;
  const t = Math.max(0, Math.min(1, (target - a.s) / segLen));
  return {
    x: a.p.x + (b.p.x - a.p.x) * t,
    y: a.p.y + (b.p.y - a.p.y) * t,
  };
}
