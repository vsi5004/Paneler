import type { PanelTopology } from "@/lib/types";
import {
  flattenPanelUnscaled,
  symmetrizeWavyPanel,
  type FlattenOptions,
} from "@/lib/flatten/unfoldNet";
import { groupPanelsByCongruence } from "./congruence";
import {
  buildCurvedPanelPath,
  sampleOutline,
  type OutlineSample,
} from "@/lib/flatten/panelPath";
import type { PanelFlat, Vec2 } from "@/lib/flatten/types";
import {
  EDGE_MARKER_INSET_MM,
  HOLE_BUNCHING_MM,
  HOLE_MIN_RUN_RATIO,
  MARGIN_MM,
  SAMPLE_STEP_MM,
  mmPerUnit,
  curvatureFor,
} from "./constants";
import type { LaserSettings, LaserTemplate, PanelClass } from "./types";

/**
 * Build the laser template for one panel class: seam outline (the
 * flattened panel at physical scale), cut outline (seam offset outward by
 * bite depth, round corner joins), and stitch holes on the seam line.
 */
export interface LaserTemplateOptions {
  /** Anchor holes exactly on sharp in-run bends (Orbita-style stars). */
  sharpBendAnchors?: boolean;
  /** Seam-true band flatten (the Spiral) — see lib/flatten/bandDevelop.ts. */
  seamTrueBands?: boolean;
  /** Per-design gather correction override (linear factor). */
  gatherCorrection?: number;
  /**
   * Place a stitch hole exactly at every polygon corner (vertex junction)
   * and space remaining holes evenly between corners. For simple-polygon
   * designs like the tetrahedron where corner stitches are structural.
   */
  cornerHoles?: boolean;
  /**
   * Replace rounded arc joins at convex corners with straight bevels —
   * applied to templates whose panel type has 0% curvature.
   */
  sharpCorners?: boolean;
  /**
   * Hole counts set directly by `settings.hexEdgeHoles` instead of derived
   * from length and spacing (circle soccers, GP(3,0)). Panels split into
   * "fillers" (the hexes with short sides) and the rest; seams between a
   * filler and a non-filler get hexEdgeHoles − 2 on both panels, plus a
   * corner extra at each end on the filler (so its edge totals
   * hexEdgeHoles); seams between two fillers are unstitched. Holes spread
   * evenly along each seam, so counts hold at every size.
   */
  holeCount?: HoleCountConvention;
}

/** Which panels are fillers, for `LaserTemplateOptions.holeCount`. */
export interface HoleCountConvention {
  isFiller: (topo: PanelTopology, panelId: string) => boolean;
  /**
   * Seams to mark with one extra hole at the middle of the side, out in the
   * seam allowance near the cut edge, so a maker can tell apart sides that
   * look alike (the 92-panel small hex's pentagon side is ~1mm shorter than
   * its two big-hex sides). Not a stitch hole: not counted in edgeHoles.
   */
  markEdge?: (topo: PanelTopology, panelId: string, neighborId: string) => boolean;
}

export function buildLaserTemplate(
  topo: PanelTopology,
  cls: PanelClass,
  settings: LaserSettings,
  options: LaserTemplateOptions = {},
): LaserTemplate {
  const scale = mmPerUnit(settings.diameterIn, options.gatherCorrection);
  const unscaled = laserPanelOutline(topo, cls.representative, {
    seamTrueBands: options.seamTrueBands,
  });
  // Curvature scales each edge's bulge: 100% = the true spherical
  // sagitta, 0% = straight polygon edges. Everything downstream (seam
  // path, sampled outline, cut offset, stitch holes) derives from these
  // ratios, so the whole template follows consistently.
  const curvaturePct = curvatureFor(settings, cls.label);
  const curve = curvaturePct / 100;
  const flatMm: PanelFlat = {
    corners: unscaled.corners.map((c) => ({ x: c.x * scale, y: c.y * scale })),
    sagittaRatios: unscaled.sagittaRatios.map((r) => r * curve),
  };

  const samples = sampleOutline(flatMm, SAMPLE_STEP_MM);
  const { holes, markerHoles, edgeHoles, unstitchedSpans, cornerExtensions, runs, runStitched } = placeStitchHoles(
    topo,
    cls,
    samples,
    scale,
    settings,
    options,
  );
  // Count-controlled hexes extend their stitched edges past each corner
  // (see placeStitchHoles); the seam outline grows to meet the extensions.
  const outline = extendEdgeEnds(samples, unstitchedSpans, cornerExtensions);
  const seamPath =
    cornerExtensions.length > 0 ? polylinePath(outline.map((sm) => sm.p)) : buildCurvedPanelPath(flatMm);
  const rawCut = offsetOutline(
    extendShortEdges(outline, unstitchedSpans, settings.shortEdgeExtensionMm),
    settings.biteDepthMm,
  );
  const cutPoints = options.sharpCorners && curvaturePct === 0
    ? sharpenOffsetCorners(rawCut, flatMm, settings.biteDepthMm)
    : rawCut;
  const cutPath = polylinePath(cutPoints);
  // Stitched sides are labelled as cut, corner extensions included (a hex
  // side reads its mating side plus the two extensions); unstitched short
  // sides give their true seam length, matching the Short edge slider.
  const labelGap = settings.biteDepthMm + EDGE_LABEL_GAP_MM;
  const asCut = measureRuns(outline, runs, labelGap);
  const onBall = measureRuns(samples, runs, labelGap);
  const edgeLengths = asCut.map((cut, r) => (runStitched[r] ? cut : onBall[r]));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of [...cutPoints, ...holes, ...markerHoles]) {
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
    markerHoles,
    edgeHoles,
    edgeLengths,
    bounds: {
      minX: minX - MARGIN_MM,
      minY: minY - MARGIN_MM,
      width: maxX - minX + 2 * MARGIN_MM,
      height: maxY - minY + 2 * MARGIN_MM,
    },
  };
}

/**
 * Hole-to-hole distance along a seam for count-controlled templates
 * (`options.holeCount`): measured on the template with the fewest panels
 * (the circle), whose holes run at one even pitch all the way round.
 * Undefined for other templates.
 */
export function holeCountGapMm(
  topo: PanelTopology,
  settings: LaserSettings,
  options: LaserTemplateOptions,
): number | undefined {
  if (!options.holeCount) return undefined;
  const cls = [...groupPanelsByCongruence(topo)].sort(
    (a, b) => a.panelIds.length - b.panelIds.length,
  )[0];
  if (!cls) return undefined;
  const { holes } = buildLaserTemplate(topo, cls, settings, options);
  if (holes.length < 2) return undefined;
  return Math.hypot(holes[1].x - holes[0].x, holes[1].y - holes[0].y);
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
  flatten: FlattenOptions = {},
): PanelFlat {
  if (panel.vertexIndices.length > 6) {
    const symmetrized = symmetrizeWavyPanel(panel, topo, flatten);
    if (symmetrized) return alignPrincipalAxis(symmetrized);
  }
  return alignPrincipalAxis(flattenPanelUnscaled(panel, topo));
}

/**
 * Rotate a flat outline so its principal axis lies horizontal: the
 * developments come out at arbitrary headings (the Spiral's crescent
 * lands tilted), which makes the preview ruler and the SVG bounding box
 * measure a slanted box instead of the panel. Pure rotation about the
 * centroid — every length, hole distance, and mating property is
 * untouched.
 */
function alignPrincipalAxis(flat: PanelFlat): PanelFlat {
  const pts = flat.corners;
  const n = pts.length;
  if (n < 3) return flat;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x / n;
    cy += p.y / n;
  }
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const rotated = pts.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  });
  // principal axis horizontal should mean width >= height; if the
  // near-isotropic case landed tall, quarter-turn it.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rotated) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const finalPts =
    maxX - minX >= maxY - minY
      ? rotated
      : rotated.map((p) => ({ x: p.y, y: -p.x }));
  return { corners: finalPts, sagittaRatios: flat.sagittaRatios };
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

/**
 * Replace rounded (Minkowski) arcs at convex polygon corners with sharp
 * miter points. The miter is computed from the seam polygon's chord
 * directions (not the offset curve tangents), so it produces a clean V
 * regardless of edge curvature. A tight arc zone (1.15× biteDepth)
 * preserves the curved offset edges right up to the corner transition.
 */
function sharpenOffsetCorners(
  cutPoints: Vec2[],
  flat: PanelFlat,
  biteDepth: number,
): Vec2[] {
  const { corners } = flat;
  const nc = corners.length;
  if (nc < 3 || cutPoints.length < 3) return cutPoints;

  let signedArea = 0;
  for (let i = 0; i < nc; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % nc];
    signedArea += a.x * b.y - b.x * a.y;
  }
  const ccw = signedArea > 0;
  const CROSS_THRESH = 0.42;

  const np = cutPoints.length;
  const arcRadius = biteDepth * 1.5;
  const LOOK = 6;
  const tags = new Int32Array(np).fill(-1);
  const miterInserts = new Map<number, Vec2>();

  for (let i = 0; i < nc; i++) {
    const prev = corners[(i - 1 + nc) % nc];
    const curr = corners[i];
    const next = corners[(i + 1) % nc];
    const d1x = curr.x - prev.x, d1y = curr.y - prev.y;
    const d2x = next.x - curr.x, d2y = next.y - curr.y;
    const len1 = Math.hypot(d1x, d1y);
    const len2 = Math.hypot(d2x, d2y);
    if (len1 < 1e-9 || len2 < 1e-9) continue;
    const e1x = d1x / len1, e1y = d1y / len1;
    const e2x = d2x / len2, e2y = d2y / len2;

    const cross = e1x * e2y - e1y * e2x;
    const isConvex = ccw ? cross > CROSS_THRESH : cross < -CROSS_THRESH;
    if (!isConvex) continue;

    let apexIdx = -1, apexDist = Infinity;
    for (let pi = 0; pi < np; pi++) {
      const d = Math.hypot(cutPoints[pi].x - curr.x, cutPoints[pi].y - curr.y);
      if (d < apexDist) { apexDist = d; apexIdx = pi; }
    }
    if (apexIdx < 0) continue;

    let wing1 = -1;
    for (let steps = 1; steps < np / 2; steps++) {
      const pi = ((apexIdx - steps) % np + np) % np;
      if (Math.hypot(cutPoints[pi].x - curr.x, cutPoints[pi].y - curr.y) > arcRadius) {
        wing1 = pi; break;
      }
    }
    let wing2 = -1;
    for (let steps = 1; steps < np / 2; steps++) {
      const pi = (apexIdx + steps) % np;
      if (Math.hypot(cutPoints[pi].x - curr.x, cutPoints[pi].y - curr.y) > arcRadius) {
        wing2 = pi; break;
      }
    }
    if (wing1 < 0 || wing2 < 0) continue;

    // Tangent at wing1: direction the curve is heading INTO the arc zone
    const w1b = ((wing1 - LOOK) % np + np) % np;
    const t1x = cutPoints[wing1].x - cutPoints[w1b].x;
    const t1y = cutPoints[wing1].y - cutPoints[w1b].y;

    // Tangent at wing2: direction from the curve INTO the arc zone (reversed)
    const w2b = (wing2 + LOOK) % np;
    const t2x = cutPoints[wing2].x - cutPoints[w2b].x;
    const t2y = cutPoints[wing2].y - cutPoints[w2b].y;

    // Miter = intersection of rays from each wing along their tangent
    const rayCross = t1x * t2y - t1y * t2x;
    if (Math.abs(rayCross) < 1e-9) continue;
    const dwx = cutPoints[wing2].x - cutPoints[wing1].x;
    const dwy = cutPoints[wing2].y - cutPoints[wing1].y;
    const t = (dwx * t2y - dwy * t2x) / rayCross;
    const s = (dwx * t1y - dwy * t1x) / rayCross;
    if (t < 0 || s < 0) continue;
    const miter: Vec2 = {
      x: cutPoints[wing1].x + t * t1x,
      y: cutPoints[wing1].y + t * t1y,
    };

    const miterDist = Math.hypot(miter.x - curr.x, miter.y - curr.y);
    if (miterDist > biteDepth * 2.5 || miterDist < apexDist * 0.8) continue;

    let pi = (wing1 + 1) % np;
    for (let steps = 0; steps < np; steps++) {
      if (pi === wing2) break;
      tags[pi] = i;
      pi = (pi + 1) % np;
    }
    miterInserts.set(wing1, miter);
  }

  const result: Vec2[] = [];
  for (let idx = 0; idx < np; idx++) {
    if (tags[idx] === -1) {
      result.push(cutPoints[idx]);
      const m = miterInserts.get(idx);
      if (m) result.push(m);
    }
  }
  return result.length >= 3 ? result : cutPoints;
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

/** Gap between the cut line and an edge-length label, millimeters. */
const EDGE_LABEL_GAP_MM = 1.6;

/**
 * Length of each seam run along the seam outline, and a label point at the
 * run's midpoint pushed `labelOffset` outward. Each outline segment
 * belongs to the run of its starting sample.
 */
function measureRuns(
  outline: OutlineSample[],
  runs: number[][],
  labelOffset: number,
): { lengthMm: number; labelAt: Vec2 }[] {
  const runOfEdge = new Map<number, number>();
  runs.forEach((run, r) => run.forEach((e) => runOfEdge.set(e, r)));
  type Seg = { i: number; a: OutlineSample; b: OutlineSample; len: number };
  const segs = runs.map(() => [] as Seg[]);
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const r = runOfEdge.get(a.edgeIndex);
    if (r === undefined) return;
    segs[r].push({ i, a, b, len: Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) });
  });
  return segs.map((collected) => {
    const lengthMm = collected.reduce((s, x) => s + x.len, 0);
    // A run can wrap past the outline's origin, collecting as two pieces
    // (its tail first): rotate to start after the index gap, so the walk
    // to its midpoint follows the boundary.
    const gap = collected.findIndex((x, k) => k > 0 && x.i !== collected[k - 1].i + 1);
    const list = gap > 0 ? [...collected.slice(gap), ...collected.slice(0, gap)] : collected;
    let half = lengthMm / 2;
    let at = list[0]?.a ?? outline[0];
    for (const x of list) {
      if (half <= x.len) {
        const t = x.len > 0 ? half / x.len : 0;
        at = {
          ...x.a,
          p: { x: x.a.p.x + (x.b.p.x - x.a.p.x) * t, y: x.a.p.y + (x.b.p.y - x.a.p.y) * t },
        };
        break;
      }
      half -= x.len;
    }
    return {
      lengthMm,
      labelAt: { x: at.p.x + at.nOut.x * labelOffset, y: at.p.y + at.nOut.y * labelOffset },
    };
  });
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
interface Span {
  /** Arc-length start of an unstitched short run on the seam outline. */
  s0: number;
  len: number;
}

/** A stitched edge's extension past one corner: the corner's arc position and the offset to the tip. */
interface CornerExtension {
  s: number;
  offset: Vec2;
}

/**
 * Grow the seam outline to meet stitched-edge extensions: each unstitched
 * span between two extended corners slides out to join the extension
 * tips, its displacement blending linearly from the start tip's offset to
 * the end tip's, so the edge keeps its shape and the outline stays
 * continuous (the stitched edge runs straight on into its tip).
 */
function extendEdgeEnds(
  samples: OutlineSample[],
  spans: Span[],
  extensions: CornerExtension[],
): OutlineSample[] {
  if (extensions.length === 0 || spans.length === 0) return samples;
  // Full perimeter, closing segment included — the same arc-length basis
  // placeStitchHoles uses, so spans that wrap past the origin match.
  const last = samples[samples.length - 1];
  const total = last.s + Math.hypot(samples[0].p.x - last.p.x, samples[0].p.y - last.p.y);
  const near = (a: number, b: number) => {
    const d = Math.abs(((a - b) % total + total) % total);
    return Math.min(d, total - d) < 1e-6;
  };
  const offsetAt = (s: number) => extensions.find((e) => near(e.s, s))?.offset;
  return samples.map((sm) => {
    for (const span of spans) {
      const t = ((sm.s - span.s0) % total + total) % total;
      // Tolerance: on a span wrapping past the origin, its closing corner
      // can land a rounding error past span.len and must still move.
      if (t > span.len + 1e-6) continue;
      const a = offsetAt(span.s0);
      const b = offsetAt(span.s0 + span.len);
      if (!a || !b) continue;
      const f = span.len > 0 ? t / span.len : 0;
      return {
        ...sm,
        p: { x: sm.p.x + a.x + (b.x - a.x) * f, y: sm.p.y + a.y + (b.y - a.y) * f },
      };
    }
    return sm;
  });
}

/**
 * Extend the fabric past each UNSTITCHED short edge: the span's samples
 * translate rigidly outward by the extension along the span's mean
 * normal — the short edge slides straight out, in its own direction
 * only. Samples outside the span (the stitched long edges) do not move,
 * so the cut there stays at plain bite depth right up to the corner;
 * the level-set offset bridges the step with bite-radius-rounded side
 * walls. Stitch line and holes are untouched.
 */
function extendShortEdges(
  samples: OutlineSample[],
  spans: Span[],
  extensionMm: number,
): OutlineSample[] {
  if (extensionMm <= 0 || spans.length === 0) return samples;
  const total = samples[samples.length - 1].s;
  const inSpan = (s: number, span: Span) =>
    (s - span.s0 + total) % total <= span.len;
  const meanNormals = spans.map((span) => {
    let nx = 0;
    let ny = 0;
    for (const sm of samples) {
      if (!inSpan(sm.s, span)) continue;
      nx += sm.nOut.x;
      ny += sm.nOut.y;
    }
    const len = Math.hypot(nx, ny) || 1;
    return { x: nx / len, y: ny / len };
  });
  return samples.map((sm) => {
    for (let i = 0; i < spans.length; i++) {
      if (inSpan(sm.s, spans[i])) {
        return {
          ...sm,
          p: {
            x: sm.p.x + meanNormals[i].x * extensionMm,
            y: sm.p.y + meanNormals[i].y * extensionMm,
          },
        };
      }
    }
    return sm;
  });
}

/**
 * Arc positions (relative to `s0`) of sharp bends strictly inside a
 * seam run — direction changes above 45° measured over a ±1.2mm window
 * on the sampled outline, clustered to the single sharpest sample.
 * These are the star-panel zigzag apexes; sewing needs an anchor hole
 * exactly on each. Bends within 1.5mm of a run end are ignored (the
 * corner hole covers them).
 */
function sharpBendsInRun(
  samples: OutlineSample[],
  s0: number,
  flatSpan: number,
  totalLength: number,
): number[] {
  const WINDOW_MM = 1.2;
  const THRESHOLD_RAD = (45 * Math.PI) / 180;
  const END_MARGIN_MM = 1.5;
  const at = (s: number) => pointAtArcLength(samples, s, totalLength);
  const bends: Array<{ s: number; turn: number }> = [];
  const STEP = 0.4;
  for (let s = END_MARGIN_MM; s <= flatSpan - END_MARGIN_MM; s += STEP) {
    const p0 = at(s0 + s - WINDOW_MM);
    const p1 = at(s0 + s);
    const p2 = at(s0 + s + WINDOW_MM);
    const v1x = p1.x - p0.x;
    const v1y = p1.y - p0.y;
    const v2x = p2.x - p1.x;
    const v2y = p2.y - p1.y;
    const dot = v1x * v2x + v1y * v2y;
    const cross = v1x * v2y - v1y * v2x;
    const turn = Math.abs(Math.atan2(cross, dot));
    if (turn > THRESHOLD_RAD) bends.push({ s, turn });
  }
  // cluster consecutive candidates (within 2mm) to the sharpest one
  const apexes: number[] = [];
  let cluster: Array<{ s: number; turn: number }> = [];
  const flush = () => {
    if (cluster.length === 0) return;
    apexes.push(cluster.reduce((m, c) => (c.turn > m.turn ? c : m)).s);
    cluster = [];
  };
  for (const b of bends) {
    if (cluster.length > 0 && b.s - cluster[cluster.length - 1].s > 2) flush();
    cluster.push(b);
  }
  flush();
  return apexes;
}

function placeStitchHoles(
  topo: PanelTopology,
  cls: PanelClass,
  samples: OutlineSample[],
  mmScale: number,
  settings: LaserSettings,
  options: LaserTemplateOptions = {},
): {
  holes: Vec2[];
  /** Edge-marker holes (HoleCountConvention.markEdge), in the seam allowance. */
  markerHoles: Vec2[];
  edgeHoles: number[];
  unstitchedSpans: Span[];
  cornerExtensions: CornerExtension[];
  runs: number[][];
  /** Per run (same order as `runs`): whether it carries stitch holes. */
  runStitched: boolean[];
} {
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
      neighborId,
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
  const cornerHoles = (isWavy && runs.length > 1) || !!options.cornerHoles;

  const holes: Vec2[] = [];
  const markerHoles: Vec2[] = [];
  const edgeHoles: number[] = [];
  const unstitchedSpans: Span[] = [];
  const centroid = samples.reduce(
    (c, sm) => ({ x: c.x + sm.p.x / samples.length, y: c.y + sm.p.y / samples.length }),
    { x: 0, y: 0 },
  );
  const cornerExtensions: CornerExtension[] = [];
  for (const [runIndex, resolved] of runSpans.entries()) {
    if (!resolved) continue;
    // Short-edge rule, judged on the shared 3D length so both panels of
    // a seam agree: runs under 55% of the longest are unstitched (the
    // proven 32/14-panel convention — soccer hex short edges carry no
    // holes). User-toggleable because it's a convention, not geometry:
    // the Teamgeist's short runs ARE stitched seams and need holes.
    const skipShort =
      !settings.shortEdgeHoles &&
      resolved.len3d < HOLE_MIN_RUN_RATIO * maxLen3d;
    const { s0, flatSpan, patternLen, extras } = resolved;
    if (options.holeCount) {
      // The seam's N − 2 holes sit in even cells — hole k at (k + ½)/(N−2)
      // of the run — on both panels, so they mate hole for hole and the
      // circle's holes run at one even pitch all the way round (adjacent
      // seams meet a full cell apart). The hex's two extras stitch it to
      // the neighbouring hex: its edge extends half a pitch past each
      // corner, straight on along the edge's own direction, and the extras
      // sit on the tips (the outline grows to meet them — see
      // extendEdgeEnds) — exactly one pitch from their neighbours, so the
      // hex's side is uniform at the mating panel's pitch. Hex-hex seams
      // stay unstitched.
      // Only filler-to-non-filler seams are stitched (decided per panel by
      // the template, not by shape class: the 122-panel circle designs
      // have two filler shapes, and seams between them stay unstitched).
      // The filler side takes the corner extras.
      const { isFiller } = options.holeCount;
      const ownFiller = isFiller(topo, cls.representative.id);
      const stitched =
        resolved.neighborId !== null && ownFiller !== isFiller(topo, resolved.neighborId);
      const fillerExtras = ownFiller;
      const n = settings.hexEdgeHoles - 2;
      if (!stitched || n < 2 || flatSpan <= 0) {
        edgeHoles.push(0);
        unstitchedSpans.push({ s0, len: flatSpan });
        continue;
      }
      const at = (sFlat: number) => pointAtArcLength(samples, s0 + sFlat, totalLength);
      const pitch = flatSpan / n;
      // Unit direction leaving the run past its start (dir −1) or end (+1).
      const outward = (sFlat: number, dir: number): Vec2 => {
        const p = at(sFlat);
        const q = at(sFlat - dir * 0.3);
        const len = Math.hypot(p.x - q.x, p.y - q.y) || 1;
        return { x: (p.x - q.x) / len, y: (p.y - q.y) / len };
      };
      // On a very short unstitched side the two tips converge; cap each
      // extension below that side's length so they never cross.
      const neighbourSpan = (offset: number) =>
        runSpans[(runIndex + offset + runSpans.length) % runSpans.length]?.flatSpan ?? Infinity;
      const tip = (sFlat: number, dir: number) => {
        const p = at(sFlat);
        const u = outward(sFlat, dir);
        const ext = Math.min(pitch / 2, 0.9 * neighbourSpan(dir));
        const offset = { x: u.x * ext, y: u.y * ext };
        cornerExtensions.push({ s: s0 + sFlat, offset });
        holes.push({ x: p.x + offset.x, y: p.y + offset.y });
      };
      if (fillerExtras) tip(0, -1);
      for (let k = 0; k < n; k++) holes.push(at((k + 0.5) * pitch));
      if (fillerExtras) tip(flatSpan, 1);
      if (settings.edgeMarker && options.holeCount.markEdge?.(topo, cls.representative.id, resolved.neighborId!)) {
        // Mid-side, pushed out along the outward normal to just inside the cut line.
        const mid = at(flatSpan / 2);
        const t0 = at(flatSpan / 2 - 0.3);
        const t1 = at(flatSpan / 2 + 0.3);
        const tl = Math.hypot(t1.x - t0.x, t1.y - t0.y) || 1;
        let nx = (t1.y - t0.y) / tl;
        let ny = -(t1.x - t0.x) / tl;
        if (nx * (mid.x - centroid.x) + ny * (mid.y - centroid.y) < 0) {
          nx = -nx;
          ny = -ny;
        }
        const out = Math.max(settings.biteDepthMm / 2, settings.biteDepthMm - EDGE_MARKER_INSET_MM);
        markerHoles.push({ x: mid.x + nx * out, y: mid.y + ny * out });
      }
      edgeHoles.push(n + (fillerExtras ? 2 : 0));
      continue;
    }
    if (cornerHoles) {
      const placeFlat = (sFlat: number) => {
        holes.push(pointAtArcLength(samples, s0 + sFlat, totalLength));
      };
      // The junction corner itself (run end = next run's start). Placed
      // even when the run's interior is skipped: each run only marks its
      // own START corner, so skipping a short run entirely would also
      // erase the shared corner — the long edge's LAST stitch.
      placeFlat(0);
      if (skipShort) {
        edgeHoles.push(0);
        unstitchedSpans.push({ s0, len: flatSpan });
        continue;
      }
      // Sharp bends WITHIN the run (the Orbita star's zigzag apexes)
      // are anchor points too: a stitch hole lands exactly on each one,
      // and the pattern spaces evenly between consecutive anchors. The
      // apexes are physical features of the shared seam curve, so both
      // panels of a seam anchor at the same spots. Smooth runs (trionda
      // arms, Teamgeist ovals) have no bends past the threshold and
      // keep plain corner-to-corner spacing.
      const apexes = options.sharpBendAnchors
        ? sharpBendsInRun(samples, s0, flatSpan, totalLength)
        : [];
      const anchors = [0, ...apexes, flatSpan];
      let holeCount = 1; // the start corner placed above
      for (let a = 0; a + 1 < anchors.length; a++) {
        const subLen = anchors[a + 1] - anchors[a];
        if (a > 0) {
          placeFlat(anchors[a]); // the apex itself
          holeCount++;
        }
        const subPattern = (patternLen * subLen) / flatSpan;
        const nInterior = Math.max(0, Math.round(subPattern / spacing) - 1);
        const gap = subLen / (nInterior + 1);
        for (let k = 1; k <= nInterior; k++) {
          placeFlat(anchors[a] + k * gap);
        }
        holeCount += nInterior;
      }
      // As a maker counts one edge: interiors + apexes + both corners.
      edgeHoles.push(holeCount + 1);
      continue;
    }
    if (skipShort) {
      edgeHoles.push(0);
      unstitchedSpans.push({ s0, len: flatSpan });
      continue;
    }
    // Closed single-run seams (Baseball, Spiral): the run IS the whole
    // loop, so the open-run pattern below would leave whatever length
    // remains after (n−1) even gaps as the closure gap — routinely a
    // fraction of the pitch, putting the first and last holes almost on
    // top of each other. Distribute n = round(len/pitch) holes at a
    // perfectly uniform gap around the loop instead.
    if (runs.length === 1) {
      const nLoop = Math.max(1, Math.round(patternLen / spacing));
      const gap = flatSpan / nLoop;
      for (let k = 0; k < nLoop; k++) {
        holes.push(pointAtArcLength(samples, s0 + k * gap, totalLength));
      }
      edgeHoles.push(nLoop);
      continue;
    }
    const usable = patternLen - 2 * cornerMargin;
    if (usable < 1 || flatSpan <= 0) {
      edgeHoles.push(0);
      continue;
    }

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
    edgeHoles.push(n + (extras ? 2 : 0));
  }
  const runStitched = runs.map((_, r) => {
    const s0 = runSpans[r]?.s0;
    return s0 !== undefined && !unstitchedSpans.some((u) => u.s0 === s0);
  });
  return { holes, markerHoles, edgeHoles, unstitchedSpans, cornerExtensions, runs, runStitched };
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
