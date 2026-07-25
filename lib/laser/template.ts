import type { PanelTopology } from "@/lib/types";
import {
  flattenPanelUnscaled,
  symmetrizeWavyPanel,
} from "@/lib/flatten/unfoldNet";
import { groupPanelsByCongruence } from "./congruence";
import {
  buildCurvedPanelPath,
  sampleOutline,
  type OutlineSample,
} from "@/lib/flatten/panelPath";
import type { PanelFlat, Vec2 } from "@/lib/flatten/types";
import {
  HOLE_BUNCHING_MM,
  HOLE_MIN_RUN_RATIO,
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
  const unscaled = laserPanelOutline(topo, cls.representative);
  // Curvature scales each edge's bulge: 100% = the true spherical
  // sagitta, 0% = straight polygon edges. Everything downstream (seam
  // path, sampled outline, cut offset, stitch holes) derives from these
  // ratios, so the whole template follows consistently.
  const curve = settings.curvaturePct / 100;
  const flatMm: PanelFlat = {
    corners: unscaled.corners.map((c) => ({ x: c.x * scale, y: c.y * scale })),
    sagittaRatios: unscaled.sagittaRatios.map((r) => r * curve),
  };

  const samples = sampleOutline(flatMm, SAMPLE_STEP_MM);
  const seamPath = buildCurvedPanelPath(flatMm);
  const cutPoints = offsetOutline(samples, settings.biteDepthMm);
  const cutPath = polylinePath(cutPoints);
  const holes = placeStitchHoles(topo, cls, samples, scale, settings);

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
 * The unscaled flat outline the laser templates are built from.
 *
 * Wavy panels with junction corners (trionda) use the seam-symmetrized
 * flatten: each seam is replaced by the average of its two panels'
 * Lambert developments, so both templates carry congruent seam curves
 * and laser-cut pieces mate (previously up to 32mm apart) while the
 * overall shape stays Lambert-true. Polygon panels and the baseball
 * (no junction corners) keep the plain Lambert flatten.
 */
export function laserPanelOutline(
  topo: PanelTopology,
  panel: PanelClass["representative"],
): PanelFlat {
  if (panel.vertexIndices.length > 6) {
    const symmetrized = symmetrizeWavyPanel(panel, topo);
    if (symmetrized) return symmetrized;
  }
  return flattenPanelUnscaled(panel, topo);
}

/**
 * Offset the sampled seam outline outward by `depth` mm — computed as the
 * outer `distance = depth` level set of the seam polyline via an exact
 * distance grid + marching squares.
 *
 * This is the true offset envelope (the Minkowski boundary): round joins
 * at convex corners, correct sealing of concave features narrower than
 * 2×depth (trionda's pinwheel hooks — where no point-wise offset scheme
 * can stay ≥ depth from both walls), and by construction it can never
 * approach the seam closer than `depth` anywhere along any segment.
 * Grid resolution bounds the positional error at ±cell/2 (≤ ~0.12mm).
 */
export function offsetOutline(
  samples: OutlineSample[],
  depth: number,
): Vec2[] {
  if (samples.length < 3) return [];
  const pts = samples.map((s) => s.p);
  const n = pts.length;

  // --- Exact distance field on a regular grid, resolved within a band ---
  const cell = Math.min(0.25, depth / 8);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = depth + 4 * cell;
  const gx0 = minX - pad;
  const gy0 = minY - pad;
  const W = Math.ceil((maxX - minX + 2 * pad) / cell) + 2;
  const H = Math.ceil((maxY - minY + 2 * pad) / cell) + 2;
  // Far value: anything comfortably above the iso level. Cells outside the
  // resolved band keep it, and since band > depth the iso contour never
  // crosses an unresolved cell.
  const FAR = depth + 3 * cell;
  const field = new Float64Array(W * H).fill(FAR);
  const band = depth + 3 * cell;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const sxMin = Math.max(0, Math.floor((Math.min(a.x, b.x) - band - gx0) / cell));
    const sxMax = Math.min(W - 1, Math.ceil((Math.max(a.x, b.x) + band - gx0) / cell));
    const syMin = Math.max(0, Math.floor((Math.min(a.y, b.y) - band - gy0) / cell));
    const syMax = Math.min(H - 1, Math.ceil((Math.max(a.y, b.y) + band - gy0) / cell));
    for (let gy = syMin; gy <= syMax; gy++) {
      const py = gy0 + gy * cell;
      for (let gx = sxMin; gx <= sxMax; gx++) {
        const px = gx0 + gx * cell;
        const d = pointSegmentDistance({ x: px, y: py }, a, b);
        const idx = gy * W + gx;
        if (d < field[idx]) field[idx] = d;
      }
    }
  }

  // --- Marching squares at iso = depth ---
  // "Inside" = distance < depth (the near-seam region); the contour we
  // want separates it from the far region. Standard 16-case table with
  // linear interpolation along cell edges.
  const iso = depth;
  type Pt = Vec2;
  const segsOut: [Pt, Pt][] = [];
  const lerp = (pA: Pt, pB: Pt, fA: number, fB: number): Pt => {
    const t = fB === fA ? 0.5 : (iso - fA) / (fB - fA);
    return { x: pA.x + (pB.x - pA.x) * t, y: pA.y + (pB.y - pA.y) * t };
  };
  for (let gy = 0; gy < H - 1; gy++) {
    for (let gx = 0; gx < W - 1; gx++) {
      const f00 = field[gy * W + gx];
      const f10 = field[gy * W + gx + 1];
      const f11 = field[(gy + 1) * W + gx + 1];
      const f01 = field[(gy + 1) * W + gx];
      let caseId = 0;
      if (f00 < iso) caseId |= 1;
      if (f10 < iso) caseId |= 2;
      if (f11 < iso) caseId |= 4;
      if (f01 < iso) caseId |= 8;
      if (caseId === 0 || caseId === 15) continue;
      const p00 = { x: gx0 + gx * cell, y: gy0 + gy * cell };
      const p10 = { x: p00.x + cell, y: p00.y };
      const p11 = { x: p00.x + cell, y: p00.y + cell };
      const p01 = { x: p00.x, y: p00.y + cell };
      const top = () => lerp(p00, p10, f00, f10);
      const right = () => lerp(p10, p11, f10, f11);
      const bottom = () => lerp(p01, p11, f01, f11);
      const left = () => lerp(p00, p01, f00, f01);
      switch (caseId) {
        case 1: case 14: segsOut.push([left(), top()]); break;
        case 2: case 13: segsOut.push([top(), right()]); break;
        case 3: case 12: segsOut.push([left(), right()]); break;
        case 4: case 11: segsOut.push([right(), bottom()]); break;
        case 6: case 9: segsOut.push([top(), bottom()]); break;
        case 7: case 8: segsOut.push([left(), bottom()]); break;
        case 5:
          segsOut.push([left(), top()]);
          segsOut.push([right(), bottom()]);
          break;
        case 10:
          segsOut.push([top(), right()]);
          segsOut.push([bottom(), left()]);
          break;
      }
    }
  }

  // --- Link segments into loops, keep the outermost (largest area) ---
  const key = (p: Pt) => `${Math.round(p.x / (cell / 16))}:${Math.round(p.y / (cell / 16))}`;
  const adj = new Map<string, { p: Pt; segs: number[] }>();
  segsOut.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p);
      let e = adj.get(k);
      if (!e) {
        e = { p, segs: [] };
        adj.set(k, e);
      }
      e.segs.push(i);
    }
  });
  const used = new Array(segsOut.length).fill(false);
  let bestLoop: Pt[] = [];
  let bestArea = 0;
  for (let i = 0; i < segsOut.length; i++) {
    if (used[i]) continue;
    const loop: Pt[] = [];
    let segIdx = i;
    let cur = segsOut[i][0];
    while (segIdx >= 0 && !used[segIdx]) {
      used[segIdx] = true;
      const [a, b] = segsOut[segIdx];
      const nextPt = key(a) === key(cur) ? b : a;
      loop.push(nextPt);
      cur = nextPt;
      const entry = adj.get(key(cur));
      segIdx = entry ? (entry.segs.find((s) => !used[s]) ?? -1) : -1;
    }
    if (loop.length < 3) continue;
    let area = 0;
    for (let k2 = 0; k2 < loop.length; k2++) {
      const a = loop[k2];
      const b = loop[(k2 + 1) % loop.length];
      area += a.x * b.y - b.x * a.y;
    }
    area = Math.abs(area) / 2;
    if (area > bestArea) {
      bestArea = area;
      bestLoop = loop;
    }
  }

  // Decimation: walk the loop with an anchor, extending a chord while every
  // skipped point stays within a hair of it and the chord stays short.
  // (Naive per-point collinearity dropping cascades on smooth arcs and
  // guts the loop into giant chords.)
  const m = bestLoop.length;
  if (m < 3) return bestLoop;
  const MAX_CHORD = 1.2;
  const MAX_DEV = 0.03;
  const out: Pt[] = [bestLoop[0]];
  let anchorIdx = 0;
  for (let i = 2; i <= m; i++) {
    const anchor = bestLoop[anchorIdx];
    const cand = bestLoop[i % m];
    const chord = Math.hypot(cand.x - anchor.x, cand.y - anchor.y);
    let ok = chord <= MAX_CHORD;
    if (ok) {
      for (let j = anchorIdx + 1; j < i; j++) {
        const q = bestLoop[j % m];
        if (pointSegmentDistance(q, anchor, cand) > MAX_DEV) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) {
      const kept = bestLoop[(i - 1) % m];
      out.push(kept);
      anchorIdx = i - 1;
    }
  }
  return out.length >= 3 ? out : bestLoop;
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
  samples: OutlineSample[],
  mmScale: number,
  settings: LaserSettings,
): Vec2[] {
  const spacing = settings.holeSpacingMm;
  const cornerMargin = settings.cornerMarginMm;
  // Pair bunching only on simple polygon panels, where the palindromic
  // pattern provably mates across a seam. On wavy imported panels
  // (trionda, baseball: >6 corners) seam alignment can't be verified
  // visually, so a mismatched 2.1-vs-2.9 pairing would go unnoticed —
  // uniform spacing removes the risk.
  const isWavy = cls.representative.vertexIndices.length > 6;
  const bunching = isWavy ? 0 : HOLE_BUNCHING_MM;
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

  // Resolve each run: its span in this panel's FLAT outline (for placing
  // points) and the length of the same seam in 3D (for deciding the hole
  // pattern). The 3D length is identical on both panels sharing a seam —
  // flat lengths differ slightly per panel because equal-area flattening
  // distorts each panel differently, and deriving counts from them let a
  // shared seam land on opposite sides of a rounding threshold (mating
  // panels with mismatched hole counts). The run list is rotated to
  // begin at a neighbour-change boundary, so the LAST run can wrap
  // through the loop's arc-length origin — its flat span continues past
  // totalLength (pointAtArcLength wraps modulo the total).
  // Corner-anchor extras: on a seam between two DIFFERENT classes, the
  // class that also has same-class seams gets one extra hole at each end
  // of the run — the holes that stitch it to its adjacent same-class
  // neighbour across the corner. Matches the proven templates: 32-panel
  // pent 6 / hex 8, 14-panel square 10 / hex 12.
  const classes = groupPanelsByCongruence(topo);
  const classOfPanel = new Map<string, string>();
  for (const c of classes) {
    for (const pid of c.panelIds) classOfPanel.set(pid, c.key);
  }
  const selfAdjacent = new Set<string>();
  for (const e of topo.edges) {
    if (!e.panelB) continue;
    const ca = classOfPanel.get(e.panelA);
    const cb = classOfPanel.get(e.panelB);
    if (ca !== undefined && ca === cb) selfAdjacent.add(ca);
  }
  const ownClass = classOfPanel.get(cls.representative.id);
  const runGetsExtras = (run: number[]): boolean => {
    if (ownClass === undefined || !selfAdjacent.has(ownClass)) return false;
    const neighborId = edgeNeighbor(run[0]);
    if (!neighborId) return false;
    const neighborClass = classOfPanel.get(neighborId);
    if (neighborClass === undefined || neighborClass === ownClass) return false;
    return !selfAdjacent.has(neighborClass);
  };

  const sphereRadius = topo.vertices[loop[0]].length() || 1;
  const edge3DLen = (i: number): number =>
    topo.vertices[loop[i]].angleTo(topo.vertices[loop[(i + 1) % nEdges]]) *
    sphereRadius *
    mmScale;
  const runSpans = runs.map((run) => {
    const s0 = edgeStart.get(run[0]);
    if (s0 === undefined) return null;
    const lastEdge = run[run.length - 1];
    const nextEdge = (lastEdge + 1) % nEdges;
    const sNext = edgeStart.get(nextEdge);
    let flatSpan: number;
    if (runs.length === 1 || sNext === undefined) {
      flatSpan = totalLength;
    } else if (sNext > s0) {
      flatSpan = sNext - s0;
    } else {
      flatSpan = totalLength - s0 + sNext;
    }
    const len3d = run.reduce((sum, i) => sum + edge3DLen(i), 0);
    // Pattern-length basis: the 3D seam length exists to keep DIFFERENT
    // classes in agreement across a seam (their flattenings distort
    // differently). A same-class seam joins congruent panels whose flat
    // runs are identical, so the pattern can fill the true flat length —
    // otherwise big wavy panels (trionda: flat ~7% longer than 3D) get
    // bare zones at the corners.
    const neighborId = edgeNeighbor(run[0]);
    const neighborCls =
      neighborId !== null ? classOfPanel.get(neighborId) : undefined;
    const sameClass = neighborCls !== undefined && neighborCls === ownClass;
    return {
      s0,
      flatSpan,
      len3d,
      neighborCls: neighborCls ?? "boundary",
      patternLen: sameClass || neighborId === null ? flatSpan : len3d,
      extras: runGetsExtras(run),
    };
  });

  // Canonicalize equivalent runs: runs with the same neighbour class and
  // near-equal length (numeric noise on imported boundaries — trionda's
  // three symmetric runs differ ~0.5%) share ONE pattern length. Without
  // this, two runs straddling a count-rounding threshold get different
  // hole counts: corners look different, and — since every physical seam
  // is cut from two different runs of the SAME class template — the
  // seams wouldn't mate.
  {
    interface Bucket { key: string; lens: number[]; members: number[] }
    const buckets: Bucket[] = [];
    runSpans.forEach((r, i) => {
      if (!r) return;
      let placed = false;
      for (const b of buckets) {
        const mean = b.lens.reduce((a, v) => a + v, 0) / b.lens.length;
        // 2.5%: trionda's flat-space run noise reaches ~1.7% (larger than
        // its 3D noise), while genuinely different runs (GP hexagons'
        // alternating edges) differ by ~10%+.
        if (
          b.key === r.neighborCls &&
          Math.abs(r.patternLen - mean) / mean <= 0.025
        ) {
          b.lens.push(r.patternLen);
          b.members.push(i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        buckets.push({ key: r.neighborCls, lens: [r.patternLen], members: [i] });
      }
    });
    for (const b of buckets) {
      const canonical = b.lens.reduce((a, v) => a + v, 0) / b.lens.length;
      for (const i of b.members) {
        runSpans[i]!.patternLen = canonical;
      }
    }
  }
  const maxLen3d = Math.max(0, ...runSpans.map((r) => (r ? r.len3d : 0)));

  // Wavy panels with real junction corners (runs.length > 1: trionda's
  // pinwheels, not the baseball's single closed seam) get one hole
  // EXACTLY at each corner — the same physical junction point exists on
  // every panel meeting there, so corner holes mate unambiguously — and
  // the remaining holes divide each run EVENLY corner-to-corner (no
  // bunching, no end slack). Count derives from the canonical run length
  // so all equivalent runs and both sides of a seam agree.
  const cornerHoles = isWavy && runs.length > 1;

  const holes: Vec2[] = [];
  for (const resolved of runSpans) {
    if (!resolved) continue;
    // Short-edge rule, judged on the shared 3D length so both panels of
    // a seam agree: runs under 55% of the longest are unstitched (the
    // proven 32/14-panel convention — soccer hex short edges carry no
    // holes). User-toggleable because it's a convention, not geometry:
    // the Teamgeist's short runs ARE stitched seams and need holes.
    if (
      !settings.shortEdgeHoles &&
      resolved.len3d < HOLE_MIN_RUN_RATIO * maxLen3d
    ) {
      continue;
    }
    const { s0, flatSpan, patternLen, extras } = resolved;
    if (cornerHoles) {
      const placeFlat = (sFlat: number) => {
        holes.push(pointAtArcLength(samples, s0 + sFlat, totalLength));
      };
      placeFlat(0); // the junction corner itself; run end = next corner
      const nInterior = Math.max(0, Math.round(patternLen / spacing) - 1);
      const gap = flatSpan / (nInterior + 1);
      for (let k = 1; k <= nInterior; k++) placeFlat(k * gap);
      continue;
    }
    const usable = patternLen - 2 * cornerMargin;
    if (usable < 1 || flatSpan <= 0) continue;

    let n = 2 * Math.floor((usable + bunching + spacing) / (2 * spacing));
    while (n >= 2 && (n - 1) * spacing - bunching > usable) {
      n -= 2;
    }
    let span: number;
    if (n < 2) {
      n = 1;
      span = 0;
    } else {
      span = (n - 1) * spacing - bunching;
    }
    // COUNT comes from the shared 3D length (the mating invariant);
    // POSITIONS are laid with exact bunched gaps in the panel's FLAT
    // outline — that's the physical fabric, so gaps must be true there.
    // If flatten distortion leaves the flat run slightly shorter than
    // the pattern, gaps compress uniformly to fit (both panels of a seam
    // have near-identical flat lengths, so their holes still align).
    const gapScale = span > flatSpan - 0.6 ? (flatSpan - 0.6) / span : 1;
    const placeFlat = (sFlat: number) => {
      holes.push(pointAtArcLength(samples, s0 + sFlat, totalLength));
    };
    const patternStart =
      cornerMargin + (flatSpan - 2 * cornerMargin - span * gapScale) / 2;
    if (extras) {
      placeFlat(Math.max(0.3, patternStart - spacing * gapScale));
    }
    let sFlat = patternStart;
    for (let k = 0; k < n; k++) {
      placeFlat(sFlat);
      if (k < n - 1) {
        sFlat +=
          (k % 2 === 0 ? spacing - bunching : spacing + bunching) * gapScale;
      }
    }
    if (extras) {
      placeFlat(
        Math.min(flatSpan - 0.3, sFlat + spacing * gapScale),
      );
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
