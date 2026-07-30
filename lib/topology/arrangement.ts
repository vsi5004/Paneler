import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";

/**
 * Curve-arrangement engine: a set of closed sampled curves on the unit
 * sphere is intersected (including self-intersections), split into arcs
 * between crossings, and the faces of the resulting embedded graph are
 * traced. The Weave preset and every band-weave design (Celtic knots,
 * spiral-through-gores) are faces of such arrangements.
 *
 * Pipeline:
 *   buildArrangement(curves)  → crossings + arcs
 *   [optional] arcs filtered  → over/under dissolution (removing the
 *                               under strand's arcs inside the over
 *                               band merges faces on re-trace, leaving
 *                               T-junction vertices behind)
 *   traceFaces(arr)           → faces, CCW from outside
 *   arrangementTopology(...)  → PanelTopology
 *
 * Face tracing is valence-agnostic (4-way crossings, 3-way T-junctions
 * after dissolution, 2-way pass-throughs), so dissolution needs no
 * face-merging bookkeeping — just drop arcs and re-trace.
 */

export interface Crossing {
  point: Vector3; // unit
  /** The two curve passes meeting here (same curve twice at a self-crossing). */
  curveA: number;
  paramA: number; // fractional segment index along curveA
  curveB: number;
  paramB: number;
}

export interface ArrangementArc {
  /** Global vertex indices: crossing → interior samples → crossing. */
  points: number[];
  fromCrossing: number;
  toCrossing: number;
  /** Input curve this arc came from. */
  curve: number;
  faceLeft: number; // filled by traceFaces
  faceRight: number;
}

export interface Arrangement {
  /** Crossings first (index = crossing id), then arc interior samples. */
  vertices: Vector3[];
  crossingCount: number;
  crossings: Crossing[];
  arcs: ArrangementArc[];
}

/** Intersection point of two short great-arc segments, or null. */
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

/**
 * Intersect all curve pairs — including each curve with itself — and
 * split every curve into arcs at the crossings. Curves are closed
 * sampled polylines of unit vectors; segments are treated as great
 * arcs. Every curve must participate in at least one crossing (a
 * crossing-free closed curve has no vertex to anchor its arc).
 */
export function buildArrangement(curves: Vector3[][]): Arrangement {
  const crossings: Crossing[] = [];

  for (let ci = 0; ci < curves.length; ci++) {
    for (let cj = ci; cj < curves.length; cj++) {
      const A = curves[ci];
      const B = curves[cj];
      const nA = A.length;
      const nB = B.length;
      for (let i = 0; i < nA; i++) {
        const a0 = A[i];
        const a1 = A[(i + 1) % nA];
        const jStart = ci === cj ? i + 2 : 0;
        for (let j = jStart; j < nB; j++) {
          if (ci === cj && i === 0 && j === nB - 1) continue; // adjacent wrap
          const p = arcIntersect(a0, a1, B[j], B[(j + 1) % nB]);
          if (!p) continue;
          // shared segment endpoints double-report; keep one
          if (crossings.some((c) => c.point.angleTo(p) < 1e-6)) continue;
          const b0 = B[j];
          const b1 = B[(j + 1) % nB];
          const tA = a0.angleTo(a1) > 0 ? p.angleTo(a0) / a0.angleTo(a1) : 0;
          const tB = b0.angleTo(b1) > 0 ? p.angleTo(b0) / b0.angleTo(b1) : 0;
          crossings.push({ point: p, curveA: ci, paramA: i + tA, curveB: cj, paramB: j + tB });
        }
      }
    }
  }

  const vertices: Vector3[] = crossings.map((c) => c.point.clone());
  const arcs: ArrangementArc[] = [];

  for (let ci = 0; ci < curves.length; ci++) {
    // every param on this curve where a crossing sits (self-crossings
    // contribute two stops)
    const stops: { param: number; idx: number }[] = [];
    crossings.forEach((c, idx) => {
      if (c.curveA === ci) stops.push({ param: c.paramA, idx });
      if (c.curveB === ci) stops.push({ param: c.paramB, idx });
    });
    if (stops.length === 0) {
      throw new Error(
        `arrangement: curve ${ci} has no crossings — cannot anchor its arcs`,
      );
    }
    stops.sort((x, y) => x.param - y.param);
    const curve = curves[ci];
    const n = curve.length;
    for (let s = 0; s < stops.length; s++) {
      const from = stops[s];
      const to = stops[(s + 1) % stops.length];
      const points: number[] = [from.idx];
      const start = from.param;
      const end = s + 1 < stops.length ? to.param : to.param + n;
      // interior samples: integer params strictly inside, with a margin
      // so no degenerate slivers of a segment survive next to a crossing
      for (let k = Math.ceil(start + 0.35); k < end - 0.35 + 1e-12; k++) {
        vertices.push(curve[((k % n) + n) % n].clone());
        points.push(vertices.length - 1);
      }
      points.push(to.idx);
      arcs.push({
        points,
        fromCrossing: from.idx,
        toCrossing: to.idx,
        curve: ci,
        faceLeft: -1,
        faceRight: -1,
      });
    }
  }

  return { vertices, crossingCount: crossings.length, crossings, arcs };
}

/**
 * Trace the faces of the (possibly arc-filtered) arrangement. Standard
 * rotation-system traversal: at each crossing, outgoing directions are
 * sorted CCW around the outward normal; a face keeps its interior on
 * the LEFT, so after arriving on a half-edge the walk continues on the
 * clockwise neighbor of that half-edge's twin. Every orbit is a face (a
 * sphere has no outer face). Returns each face as a vertex-index loop,
 * CCW from outside, and fills each arc's faceLeft/faceRight.
 */
export function traceFaces(arr: Arrangement): number[][] {
  const { arcs, vertices, crossingCount } = arr;
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
    if (outgoing[v].length === 0) continue; // all arcs dissolved away
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

/**
 * Assemble a PanelTopology from a traced arrangement. Vertices are
 * compacted to those actually used (dissolution orphans interior
 * samples of removed arcs); when nothing was removed the mapping is the
 * identity, preserving the original vertex order.
 */
export function arrangementTopology(
  arr: Arrangement,
  faces: number[][],
  radius: number,
): PanelTopology {
  const remap = new Map<number, number>();
  const vertices: Vector3[] = [];
  const mapped = (vi: number): number => {
    let m = remap.get(vi);
    if (m === undefined) {
      m = vertices.length;
      vertices.push(arr.vertices[vi].clone().setLength(radius));
      remap.set(vi, m);
    }
    return m;
  };

  // Crossings first (in id order), then arc interiors in arc order —
  // exactly the creation order, so the mapping is the identity when no
  // arcs were removed.
  for (let c = 0; c < arr.crossingCount; c++) {
    if (arr.arcs.some((a) => a.fromCrossing === c || a.toCrossing === c)) {
      mapped(c);
    }
  }
  for (const arc of arr.arcs) {
    for (let i = 1; i + 1 < arc.points.length; i++) mapped(arc.points[i]);
  }

  const panels = faces.map((loop, i) => {
    const vertexIndices = loop.map(mapped);
    const shape = shapeForVertexCount(vertexIndices.length);
    return { id: panelId(i, shape), vertexIndices, shape };
  });

  const edges: PanelEdge[] = [];
  for (const arc of arr.arcs) {
    const pa = panels[arc.faceLeft].id;
    const pb = panels[arc.faceRight].id;
    for (let i = 0; i + 1 < arc.points.length; i++) {
      const a = mapped(arc.points[i]);
      const b = mapped(arc.points[i + 1]);
      edges.push({
        vertexA: Math.min(a, b),
        vertexB: Math.max(a, b),
        panelA: pa,
        panelB: pb,
      });
    }
  }

  return { vertices, panels, edges };
}
