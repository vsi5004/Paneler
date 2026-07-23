import type { PanelFlat, Vec2 } from "./types";

/**
 * Build an SVG path that traces the panel boundary with one quadratic-
 * bezier segment per edge. Control point for each edge sits on the
 * perpendicular bisector of the chord, offset outward (away from the
 * panel centroid) by `2 × sagitta` — because a quadratic bezier
 * evaluated at t=0.5 reaches half the perpendicular distance from
 * chord to control point.
 */
export function buildCurvedPanelPath(flat: PanelFlat): string {
  const { corners, sagittaRatios } = flat;
  const n = corners.length;
  if (n < 3) return "";

  // Panel centroid in flat space — used to flip the outward normal so
  // every edge bulges AWAY from the centre, not into it.
  let cx = 0;
  let cy = 0;
  for (const c of corners) {
    cx += c.x;
    cy += c.y;
  }
  cx /= n;
  cy /= n;

  const parts: string[] = [`M ${corners[0].x} ${corners[0].y}`];
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edgeLen = Math.hypot(dx, dy);
    // Perpendicular to the edge.
    let nx = -dy / edgeLen;
    let ny = dx / edgeLen;
    // Flip if it points toward the centroid — we want OUTward bulge.
    if (nx * (cx - midX) + ny * (cy - midY) > 0) {
      nx = -nx;
      ny = -ny;
    }
    const sagitta = edgeLen * sagittaRatios[i];
    const cpX = midX + nx * 2 * sagitta;
    const cpY = midY + ny * 2 * sagitta;
    parts.push(`Q ${cpX} ${cpY} ${b.x} ${b.y}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** One densely-sampled point on a panel's curved boundary. */
export interface OutlineSample {
  /** Position on the boundary. */
  p: Vec2;
  /** Outward unit normal (away from the panel interior). */
  nOut: Vec2;
  /** Cumulative arc length from the boundary start. */
  s: number;
  /** Index of the originating edge (corner i → corner i+1). */
  edgeIndex: number;
}

/**
 * Sample the panel's curved boundary (same quadratic-bezier construction
 * as `buildCurvedPanelPath`) into points no farther than `maxStep` apart,
 * each carrying its outward unit normal, cumulative arc length, and the
 * edge it came from. The sample at each corner is emitted once, as the
 * first sample of the outgoing edge.
 */
export function sampleOutline(
  flat: PanelFlat,
  maxStep: number,
): OutlineSample[] {
  const { corners, sagittaRatios } = flat;
  const n = corners.length;
  if (n < 3) return [];

  let cx = 0;
  let cy = 0;
  for (const c of corners) {
    cx += c.x;
    cy += c.y;
  }
  cx /= n;
  cy /= n;

  const samples: OutlineSample[] = [];
  let s = 0;
  let prev: Vec2 | null = null;

  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edgeLen = Math.hypot(dx, dy);
    if (edgeLen < 1e-12) continue;
    let nx = -dy / edgeLen;
    let ny = dx / edgeLen;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (nx * (cx - midX) + ny * (cy - midY) > 0) {
      nx = -nx;
      ny = -ny;
    }
    const sagitta = edgeLen * sagittaRatios[i];
    const cpX = midX + nx * 2 * sagitta;
    const cpY = midY + ny * 2 * sagitta;

    // The bezier's length is at least the chord; sample generously so the
    // spacing stays under maxStep even on strongly bulged edges.
    const approxLen = edgeLen + 2 * Math.abs(sagitta);
    const steps = Math.max(2, Math.ceil(approxLen / maxStep));
    // t in [0, 1): the edge's endpoint is the next edge's t=0 sample.
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const omt = 1 - t;
      const px = omt * omt * a.x + 2 * omt * t * cpX + t * t * b.x;
      const py = omt * omt * a.y + 2 * omt * t * cpY + t * t * b.y;
      // Tangent of the quadratic bezier.
      const tx = 2 * omt * (cpX - a.x) + 2 * t * (b.x - cpX);
      const ty = 2 * omt * (cpY - a.y) + 2 * t * (b.y - cpY);
      const tLen = Math.hypot(tx, ty) || 1;
      // Outward normal = tangent rotated so it agrees with the edge's
      // outward side.
      let onx = ty / tLen;
      let ony = -tx / tLen;
      if (onx * nx + ony * ny < 0) {
        onx = -onx;
        ony = -ony;
      }
      if (prev) {
        s += Math.hypot(px - prev.x, py - prev.y);
      }
      const p = { x: px, y: py };
      samples.push({ p, nOut: { x: onx, y: ony }, s, edgeIndex: i });
      prev = p;
    }
  }
  return samples;
}
