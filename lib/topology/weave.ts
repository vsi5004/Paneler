import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";
import { spiralSeamPoints } from "./spiral";

/**
 * "Weave" — two copies of the spiral's pole-to-pole seam wound around
 * PERPENDICULAR axes (one around Z, the same curve rotated to wind
 * around X). The two closed seams cross each other; the sphere falls
 * apart into the enclosed regions, which — colored alternately — read
 * as two spiral ribbons woven over and under each other.
 *
 * Unlike the other presets, the panel decomposition is computed, not
 * authored: crossings are found by great-arc segment intersection, each
 * seam is split into arcs between crossings, and panels are traced as
 * the faces of the resulting graph on the sphere (interior kept to the
 * left, so every face comes out CCW from outside).
 *
 * The crossing count — and with it the panel count — jumps as the twist
 * changes (4 panels at 50%, 14 at 100%, 10 at 125%...). That breaks the
 * frozen-panel-id rule every other slider obeys: painted colors only
 * survive twist moves that stay on one crossing-count plateau. The
 * preset accepts that (it is a dev-only exploratory design) and its
 * slider range is capped where the plateaus are verified stable — see
 * the param comment in presets.ts.
 */

const DEFAULT_TWIST = 1;

export function weave(radius = 1, twist = DEFAULT_TWIST): PanelTopology {
  // Unit-sphere seam curves: A winds around Z, B is A rotated 90° about
  // Y so it winds around X.
  const curveA = spiralSeamPoints(twist, 1);
  const curveB = curveA.map((p) => new Vector3(p.z, p.y, -p.x));

  const crossings = findCrossings(curveA, curveB);
  if (crossings.length < 2 || crossings.length % 2 !== 0) {
    throw new Error(
      `weave: degenerate seam crossing count ${crossings.length} at twist ${twist}`,
    );
  }

  // Global vertex list: crossings first, then arc interior samples.
  const vertices: Vector3[] = crossings.map((c) => c.point.clone());
  const arcs: Arc[] = [
    ...splitCurve(curveA, crossings, "a", vertices),
    ...splitCurve(curveB, crossings, "b", vertices),
  ];

  const faces = traceFaces(crossings.length, arcs, vertices);
  const expected = arcs.length - crossings.length + 2; // Euler: F = E − V + 2
  if (faces.length !== expected) {
    throw new Error(
      `weave: face tracing found ${faces.length} faces, expected ${expected}`,
    );
  }

  const shapeOf = (count: number) => shapeForVertexCount(count);
  const panels = faces.map((loop, i) => ({
    id: panelId(i, shapeOf(loop.length)),
    vertexIndices: loop,
    shape: shapeOf(loop.length),
  }));

  // One PanelEdge per consecutive sample pair along each arc, bounded by
  // the faces on the arc's two sides.
  const edges: PanelEdge[] = [];
  for (const arc of arcs) {
    const pa = panels[arc.faceLeft].id;
    const pb = panels[arc.faceRight].id;
    for (let i = 0; i + 1 < arc.points.length; i++) {
      edges.push({
        vertexA: Math.min(arc.points[i], arc.points[i + 1]),
        vertexB: Math.max(arc.points[i], arc.points[i + 1]),
        panelA: pa,
        panelB: pb,
      });
    }
  }

  for (const v of vertices) v.setLength(radius);
  return { vertices, panels, edges };
}

// -----------------------------------------------------------------------------
// Crossing detection
// -----------------------------------------------------------------------------

interface Crossing {
  point: Vector3; // unit
  paramA: number; // fractional segment index along curve A
  paramB: number;
}

/** Intersection point of two great-arc segments, or null. */
function arcIntersect(
  a0: Vector3,
  a1: Vector3,
  b0: Vector3,
  b1: Vector3,
): Vector3 | null {
  const n1 = new Vector3().crossVectors(a0, a1);
  const n2 = new Vector3().crossVectors(b0, b1);
  const d = new Vector3().crossVectors(n1, n2);
  if (d.lengthSq() < 1e-20) return null;
  d.normalize();
  const within = (p: Vector3, a: Vector3, b: Vector3): boolean => {
    const ab = a.angleTo(b);
    return p.angleTo(a) <= ab + 1e-12 && p.angleTo(b) <= ab + 1e-12;
  };
  for (const cand of [d, d.clone().negate()]) {
    if (within(cand, a0, a1) && within(cand, b0, b1)) return cand.clone();
  }
  return null;
}

function findCrossings(curveA: Vector3[], curveB: Vector3[]): Crossing[] {
  const found: Crossing[] = [];
  const nA = curveA.length;
  const nB = curveB.length;
  for (let i = 0; i < nA; i++) {
    const a0 = curveA[i];
    const a1 = curveA[(i + 1) % nA];
    for (let j = 0; j < nB; j++) {
      const p = arcIntersect(a0, a1, curveB[j], curveB[(j + 1) % nB]);
      if (!p) continue;
      // shared segment endpoints double-report; keep one
      if (found.some((c) => c.point.angleTo(p) < 1e-6)) continue;
      const b0 = curveB[j];
      const b1 = curveB[(j + 1) % nB];
      const tA = a0.angleTo(a1) > 0 ? p.angleTo(a0) / a0.angleTo(a1) : 0;
      const tB = b0.angleTo(b1) > 0 ? p.angleTo(b0) / b0.angleTo(b1) : 0;
      found.push({ point: p, paramA: i + tA, paramB: j + tB });
    }
  }
  return found;
}

// -----------------------------------------------------------------------------
// Curve splitting
// -----------------------------------------------------------------------------

interface Arc {
  /** Global vertex indices, crossing → interior samples → crossing. */
  points: number[];
  fromCrossing: number;
  toCrossing: number;
  faceLeft: number; // filled by traceFaces
  faceRight: number;
}

/**
 * Split a closed sample curve at its crossings into arcs. Interior
 * samples are appended to `vertices`; samples hugging a crossing are
 * dropped so no degenerate slivers of a segment survive.
 */
function splitCurve(
  curve: Vector3[],
  crossings: Crossing[],
  which: "a" | "b",
  vertices: Vector3[],
): Arc[] {
  const n = curve.length;
  const stops = crossings
    .map((c, idx) => ({ param: which === "a" ? c.paramA : c.paramB, idx }))
    .sort((x, y) => x.param - y.param);
  const arcs: Arc[] = [];
  for (let s = 0; s < stops.length; s++) {
    const from = stops[s];
    const to = stops[(s + 1) % stops.length];
    const points: number[] = [from.idx];
    const start = from.param;
    const end = s + 1 < stops.length ? to.param : to.param + n;
    // interior samples: integer params strictly inside (start, end)
    for (let k = Math.ceil(start + 0.35); k < end - 0.35 + 1e-12; k++) {
      const p = curve[((Math.round(k) % n) + n) % n];
      vertices.push(p.clone());
      points.push(vertices.length - 1);
    }
    points.push(to.idx);
    arcs.push({
      points,
      fromCrossing: from.idx,
      toCrossing: to.idx,
      faceLeft: -1,
      faceRight: -1,
    });
  }
  return arcs;
}

// -----------------------------------------------------------------------------
// Face tracing
// -----------------------------------------------------------------------------

/**
 * Trace the faces of the seam graph on the sphere. Standard rotation-
 * system traversal: at each crossing, outgoing directions are sorted CCW
 * around the outward normal; a face keeps its interior on the LEFT, so
 * after arriving on a half-edge the walk continues on the clockwise
 * neighbor of that half-edge's twin. Every orbit is a face (a sphere has
 * no outer face). Returns each face as a vertex-index loop, CCW from
 * outside, and fills each arc's faceLeft/faceRight.
 */
function traceFaces(
  crossingCount: number,
  arcs: Arc[],
  vertices: Vector3[],
): number[][] {
  // Half-edge h = 2·arcIdx (forward) or 2·arcIdx+1 (backward).
  const halfStart = (h: number): number =>
    h % 2 === 0 ? arcs[h >> 1].fromCrossing : arcs[h >> 1].toCrossing;
  const halfPoints = (h: number): number[] => {
    const pts = arcs[h >> 1].points;
    return h % 2 === 0 ? pts : [...pts].reverse();
  };

  // Outgoing tangent direction of a half-edge at its start crossing.
  const outDir = (h: number): Vector3 => {
    const pts = halfPoints(h);
    const origin = vertices[pts[0]];
    // first sample far enough from the crossing to give a stable tangent
    let step = vertices[pts[1]];
    for (let i = 1; i < pts.length && origin.angleTo(step) < 1e-4; i++) {
      step = vertices[pts[i]];
    }
    return step.clone().addScaledVector(origin, -step.dot(origin)).normalize();
  };

  // Rotation system: half-edges out of each crossing, sorted CCW around
  // the outward normal (the crossing position itself).
  const outgoing: number[][] = Array.from({ length: crossingCount }, () => []);
  for (let h = 0; h < arcs.length * 2; h++) outgoing[halfStart(h)].push(h);
  const angleAt: number[] = new Array(arcs.length * 2);
  for (let v = 0; v < crossingCount; v++) {
    const normal = vertices[v];
    const ref = outDir(outgoing[v][0]);
    const refPerp = new Vector3().crossVectors(normal, ref);
    for (const h of outgoing[v]) {
      const d = outDir(h);
      angleAt[h] = Math.atan2(d.dot(refPerp), d.dot(ref));
    }
    outgoing[v].sort((h1, h2) => angleAt[h1] - angleAt[h2]);
  }

  const twin = (h: number): number => (h % 2 === 0 ? h + 1 : h - 1);
  const next = (h: number): number => {
    const v = halfStart(twin(h));
    const ring = outgoing[v];
    const at = ring.indexOf(twin(h));
    return ring[(at - 1 + ring.length) % ring.length]; // clockwise neighbor
  };

  const faceOf: number[] = new Array(arcs.length * 2).fill(-1);
  const faces: number[][] = [];
  for (let h0 = 0; h0 < arcs.length * 2; h0++) {
    if (faceOf[h0] !== -1) continue;
    const faceIdx = faces.length;
    const loop: number[] = [];
    let h = h0;
    do {
      faceOf[h] = faceIdx;
      const pts = halfPoints(h);
      for (let i = 0; i < pts.length - 1; i++) loop.push(pts[i]); // drop end crossing
      h = next(h);
    } while (h !== h0);
    faces.push(loop);
  }

  for (let a = 0; a < arcs.length; a++) {
    arcs[a].faceLeft = faceOf[2 * a];
    arcs[a].faceRight = faceOf[2 * a + 1];
  }
  return faces;
}
