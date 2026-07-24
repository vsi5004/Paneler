import { Vector3 } from "three";
import type { Panel, PanelTopology } from "@/lib/types";
import type { Vec2 } from "./types";
import { subdivideTopology, getPanelTriangles } from "@/lib/mesh/subdivide";

/**
 * As-rigid-as-possible (ARAP) flattening of one panel's curved surface.
 *
 * Azimuthal projections (Lambert) pile their distortion up at the far
 * field — on 96°-radius panels the boundary is displaced by tens of mm,
 * differently in each neighbouring panel's frame, so templates didn't
 * mate and corners came out wrong. ARAP instead spreads the sphere's
 * unavoidable flattening strain evenly across the surface (local
 * rotations fitted per triangle, global least-squares stitch), the way
 * pattern CAD flattens garment panels: boundary lengths come out within
 * ~3% of true, corners land near their spherical angles, and the two
 * developments of a shared seam agree in ARC LENGTH to ~0.2mm — which is
 * what sewing and stitch-hole alignment need. The developed curves do NOT
 * nest flat (each panel's strain bows the seam toward its own interior);
 * that is unavoidable for wide corners — see symmetrizeWavyPanel.
 *
 * Returns the flattened positions of the panel's boundary loop (same
 * order as `panel.vertexIndices`), y-flipped for SVG, in sphere units.
 */
export function arapFlattenBoundary(
  panel: Panel,
  topo: PanelTopology,
): Vec2[] | null {
  const mesh = meshForPanel(panel, topo);
  if (!mesh) return null;
  const { positions3D, triangles, boundaryMeshIndex } = mesh;

  const nV = positions3D.length;
  // --- Reference (isometric) 2D shape per triangle + cotangent weights ---
  const refs: { x: [Vec2, Vec2, Vec2]; w: [number, number, number] }[] = [];
  for (const [a, b, c] of triangles) {
    const A = positions3D[a];
    const B = positions3D[b];
    const C = positions3D[c];
    const AB = B.clone().sub(A);
    const AC = C.clone().sub(A);
    const lenAB = AB.length() || 1e-12;
    const X = AB.clone().divideScalar(lenAB);
    const Zv = new Vector3().crossVectors(AB, AC);
    const Y = new Vector3().crossVectors(Zv, AB).normalize();
    const x: [Vec2, Vec2, Vec2] = [
      { x: 0, y: 0 },
      { x: lenAB, y: 0 },
      { x: AC.dot(X), y: AC.dot(Y) },
    ];
    // Cotangent weight per edge (opposite corner), clamped for stability.
    const cot = (p: Vec2, q: Vec2, r: Vec2) => {
      // angle at p between (q-p) and (r-p)
      const ux = q.x - p.x;
      const uy = q.y - p.y;
      const vx = r.x - p.x;
      const vy = r.y - p.y;
      const dot = ux * vx + uy * vy;
      const cross = Math.abs(ux * vy - uy * vx) || 1e-12;
      return Math.min(20, Math.max(0.05, dot / cross));
    };
    // edges: (a,b) opp c — weight cot at x[2]; (b,c) opp a; (c,a) opp b
    refs.push({
      x,
      w: [cot(x[2], x[0], x[1]), cot(x[0], x[1], x[2]), cot(x[1], x[2], x[0])],
    });
  }

  // --- Initial guess: Lambert azimuthal about the panel center ---
  const center = panelCenter(panel, topo, positions3D, boundaryMeshIndex);
  const helper =
    Math.abs(center.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const tanU = new Vector3().crossVectors(center, helper).normalize();
  const tanV = new Vector3().crossVectors(center, tanU).normalize();
  const sphereRadius = positions3D[0].length() || 1;
  let px: Float64Array = new Float64Array(nV);
  let py: Float64Array = new Float64Array(nV);
  for (let i = 0; i < nV; i++) {
    const u = positions3D[i].clone().normalize();
    const cosD = Math.min(1, Math.max(-1, u.dot(center)));
    const az = u.clone().sub(center.clone().multiplyScalar(cosD));
    const azLen = az.length();
    const r = 2 * Math.sin(Math.acos(cosD) / 2) * sphereRadius;
    px[i] = azLen > 1e-12 ? (r * az.dot(tanU)) / azLen : 0;
    py[i] = azLen > 1e-12 ? (r * az.dot(tanV)) / azLen : 0;
  }

  // --- Laplacian structure (shared by x and y solves) ---
  const Ldiag = new Float64Array(nV);
  const nbr: number[][] = Array.from({ length: nV }, () => []);
  const nbrW: number[][] = Array.from({ length: nV }, () => []);
  const addW = (i: number, j: number, w: number) => {
    const k = nbr[i].indexOf(j);
    if (k >= 0) nbrW[i][k] += w;
    else {
      nbr[i].push(j);
      nbrW[i].push(w);
    }
    Ldiag[i] += w;
  };
  triangles.forEach(([a, b, c], t) => {
    const w = refs[t].w;
    addW(a, b, w[0]);
    addW(b, a, w[0]);
    addW(b, c, w[1]);
    addW(c, b, w[1]);
    addW(c, a, w[2]);
    addW(a, c, w[2]);
  });

  // Pin vertex 0 (translation gauge); rotation is handled by the local step.
  const PIN = 0;
  const applyL = (v: Float64Array, out: Float64Array) => {
    for (let i = 0; i < nV; i++) {
      if (i === PIN) {
        out[i] = v[i];
        continue;
      }
      let s = Ldiag[i] * v[i];
      const ns = nbr[i];
      const ws = nbrW[i];
      for (let k = 0; k < ns.length; k++) {
        const j = ns[k];
        s -= ws[k] * (j === PIN ? 0 : v[j]);
      }
      out[i] = s;
    }
  };
  const cg = (b: Float64Array, x0: Float64Array): Float64Array => {
    const x = Float64Array.from(x0);
    const r = new Float64Array(nV);
    const Ap = new Float64Array(nV);
    applyL(x, Ap);
    for (let i = 0; i < nV; i++) r[i] = b[i] - Ap[i];
    const p = Float64Array.from(r);
    let rs = 0;
    for (let i = 0; i < nV; i++) rs += r[i] * r[i];
    for (let it = 0; it < 250 && rs > 1e-14; it++) {
      applyL(p, Ap);
      let pAp = 0;
      for (let i = 0; i < nV; i++) pAp += p[i] * Ap[i];
      if (pAp <= 0) break;
      const alpha = rs / pAp;
      let rsNew = 0;
      for (let i = 0; i < nV; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        rsNew += r[i] * r[i];
      }
      const beta = rsNew / rs;
      rs = rsNew;
      for (let i = 0; i < nV; i++) p[i] = r[i] + beta * p[i];
    }
    return x;
  };

  // --- Local/global ARAP iterations ---
  const ITER = 20;
  const bx = new Float64Array(nV);
  const by = new Float64Array(nV);
  for (let iter = 0; iter < ITER; iter++) {
    bx.fill(0);
    by.fill(0);
    for (let t = 0; t < triangles.length; t++) {
      const [a, b, c] = triangles[t];
      const { x, w } = refs[t];
      // Best rotation R_t aligning reference edges to current edges.
      let sxx = 0,
        sxy = 0,
        syx = 0,
        syy = 0;
      const acc = (i: number, j: number, xi: Vec2, xj: Vec2, wij: number) => {
        const ex = px[i] - px[j];
        const ey = py[i] - py[j];
        const rx = xi.x - xj.x;
        const ry = xi.y - xj.y;
        sxx += wij * ex * rx;
        sxy += wij * ex * ry;
        syx += wij * ey * rx;
        syy += wij * ey * ry;
      };
      acc(a, b, x[0], x[1], w[0]);
      acc(b, c, x[1], x[2], w[1]);
      acc(c, a, x[2], x[0], w[2]);
      const ang = Math.atan2(syx - sxy, sxx + syy);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const rot = (p: Vec2): Vec2 => ({
        x: p.x * cos - p.y * sin,
        y: p.x * sin + p.y * cos,
      });
      const push = (i: number, j: number, xi: Vec2, xj: Vec2, wij: number) => {
        const e = rot({ x: xi.x - xj.x, y: xi.y - xj.y });
        bx[i] += wij * e.x;
        by[i] += wij * e.y;
        bx[j] -= wij * e.x;
        by[j] -= wij * e.y;
      };
      push(a, b, x[0], x[1], w[0]);
      push(b, c, x[1], x[2], w[1]);
      push(c, a, x[2], x[0], w[2]);
    }
    // Pinned vertex keeps its position.
    bx[PIN] = px[PIN];
    by[PIN] = py[PIN];
    // Move pin contributions of neighbours to the RHS.
    for (let k = 0; k < nbr[PIN].length; k++) {
      const j = nbr[PIN][k];
      if (j === PIN) continue;
      bx[j] += nbrW[PIN][k] * px[PIN];
      by[j] += nbrW[PIN][k] * py[PIN];
    }
    px = cg(bx, px);
    py = cg(by, py);
  }

  // --- Extract boundary loop, y-flipped for SVG ---
  return panel.vertexIndices.map((vi) => {
    const m = boundaryMeshIndex.get(vi)!;
    return { x: px[m], y: -py[m] };
  });
}

function panelCenter(
  panel: Panel,
  topo: PanelTopology,
  positions3D: Vector3[],
  boundaryMeshIndex: Map<number, number>,
): Vector3 {
  const mean = new Vector3();
  for (const vi of panel.vertexIndices) {
    mean.add(positions3D[boundaryMeshIndex.get(vi)!]);
  }
  mean.divideScalar(panel.vertexIndices.length);
  if (mean.length() > 0.1) return mean.normalize();
  const area = new Vector3();
  const cross = new Vector3();
  const loop = panel.vertexIndices;
  for (let i = 0; i < loop.length; i++) {
    const a = positions3D[boundaryMeshIndex.get(loop[i])!];
    const b = positions3D[boundaryMeshIndex.get(loop[(i + 1) % loop.length])!];
    cross.crossVectors(a, b);
    area.add(cross);
  }
  return area.normalize();
}

/**
 * Build a moderate-resolution triangle mesh of one panel on the sphere,
 * with local vertex indexing and a map from the panel's boundary vertex
 * ids (topology indices) to mesh indices.
 */
function meshForPanel(
  panel: Panel,
  topo: PanelTopology,
): {
  positions3D: Vector3[];
  triangles: [number, number, number][];
  boundaryMeshIndex: Map<number, number>;
} | null {
  // Subdivide the WHOLE topology at a modest level (cached per topology —
  // wavy topologies are static; laser settings never rebuild them).
  const sub = subdividedCache.get(topo) ?? subdivideTopology(topo, 2);
  subdividedCache.set(topo, sub);
  const tris = getPanelTriangles(sub)?.get(panel.id);
  if (!tris || tris.length === 0) return null;

  const localOf = new Map<number, number>();
  const positions3D: Vector3[] = [];
  const triangles: [number, number, number][] = [];
  const local = (g: number): number => {
    let l = localOf.get(g);
    if (l === undefined) {
      l = positions3D.length;
      positions3D.push(sub.vertices[g].clone());
      localOf.set(g, l);
    }
    return l;
  };
  for (const [a, b, c] of tris) {
    triangles.push([local(a), local(b), local(c)]);
  }
  // Original boundary vertex indices are preserved by subdivideTopology.
  const boundaryMeshIndex = new Map<number, number>();
  for (const vi of panel.vertexIndices) {
    const l = localOf.get(vi);
    if (l === undefined) return null;
    boundaryMeshIndex.set(vi, l);
  }
  return { positions3D, triangles, boundaryMeshIndex };
}

const subdividedCache = new WeakMap<
  PanelTopology,
  ReturnType<typeof subdivideTopology>
>();
