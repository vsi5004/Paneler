import { Vector3 } from "three";
import {
  type Panel,
  type PanelEdge,
  type PanelShape,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";

// -----------------------------------------------------------------------------
// Icosahedron base topology (the seed for all Goldberg polyhedra)
// -----------------------------------------------------------------------------

const PHI = (1 + Math.sqrt(5)) / 2;

const ICO_VERTICES: ReadonlyArray<readonly [number, number, number]> = [
  [-1, PHI, 0], //  0
  [1, PHI, 0], //   1
  [-1, -PHI, 0], // 2
  [1, -PHI, 0], //  3
  [0, -1, PHI], //  4
  [0, 1, PHI], //   5
  [0, -1, -PHI], // 6
  [0, 1, -PHI], //  7
  [PHI, 0, -1], //  8
  [PHI, 0, 1], //   9
  [-PHI, 0, -1], // 10
  [-PHI, 0, 1], //  11
];

// Triangle faces of the icosahedron, vertices in CCW order from outside.
const ICO_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

// -----------------------------------------------------------------------------
// goldberg(1, 1) — truncated icosahedron, 32 panels (12 pentagons + 20 hexagons)
// -----------------------------------------------------------------------------

/**
 * GP(1,1) — the truncated icosahedron, a.k.a. the classic soccer ball pattern.
 *
 * Construction: place trisection points along every icosahedron edge. Each
 * original face becomes a hexagon (from its 6 trisection points); each original
 * vertex becomes a pentagon (from the 5 trisection points "near" it on the
 * edges incident to that vertex). Vertices are then projected to the sphere.
 *
 * 60 vertices, 32 panels, 90 edges.
 */
export function goldberg11(radius = 1): PanelTopology {
  const baseVerts = ICO_VERTICES.map(([x, y, z]) => new Vector3(x, y, z));

  // Collect the unique undirected edges of the icosahedron and the trisection
  // points along each. trisectionIdx[edgeKey] = [nearLoIdx, nearHiIdx] where
  // "nearLo" is closer to the lo-indexed endpoint.
  const trisectionIdx = new Map<string, [number, number]>();
  // For each (vertex, neighbour) ordered pair, the index of the trisection
  // point ON that edge that is NEAR `vertex`. Used both for hexagon and
  // pentagon construction.
  const nearVertex = new Map<string, number>();

  const newVerts: Vector3[] = [];

  function edgeKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  function nearKey(vertex: number, neighbour: number): string {
    return `${vertex}->${neighbour}`;
  }

  function ensureTrisection(a: number, b: number): [number, number] {
    const key = edgeKey(a, b);
    const cached = trisectionIdx.get(key);
    if (cached) return cached;

    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const vLo = baseVerts[lo];
    const vHi = baseVerts[hi];

    const nearLo = vLo.clone().lerp(vHi, 1 / 3); // 1/3 of the way to hi → "near lo"
    const nearHi = vLo.clone().lerp(vHi, 2 / 3); // 2/3 of the way to hi → "near hi"

    const nearLoIdx = newVerts.length;
    newVerts.push(nearLo);
    const nearHiIdx = newVerts.length;
    newVerts.push(nearHi);

    trisectionIdx.set(key, [nearLoIdx, nearHiIdx]);
    nearVertex.set(nearKey(lo, hi), nearLoIdx);
    nearVertex.set(nearKey(hi, lo), nearHiIdx);
    return [nearLoIdx, nearHiIdx];
  }

  // Walk every face once to populate all trisections.
  for (const face of ICO_FACES) {
    ensureTrisection(face[0], face[1]);
    ensureTrisection(face[1], face[2]);
    ensureTrisection(face[2], face[0]);
  }

  // Build the 20 hexagonal panels (one per icosahedron face).
  const hexagons: number[][] = [];
  for (const [i, j, k] of ICO_FACES) {
    // Walking the face CCW from outside: i → j → k. The hexagon's 6 corners
    // are the 6 trisection points along the 3 edges, ordered so neighbouring
    // panels share consecutive pairs of vertices.
    hexagons.push([
      nearVertex.get(nearKey(i, j))!,
      nearVertex.get(nearKey(j, i))!,
      nearVertex.get(nearKey(j, k))!,
      nearVertex.get(nearKey(k, j))!,
      nearVertex.get(nearKey(k, i))!,
      nearVertex.get(nearKey(i, k))!,
    ]);
  }

  // Build the 12 pentagonal panels (one per icosahedron vertex).
  // For each vertex V, gather the 5 trisection points "near V" (one per
  // incident edge) and order them cyclically by angle in V's tangent plane.
  const neighboursByVertex = new Map<number, Set<number>>();
  for (const [a, b, c] of ICO_FACES) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as Array<[number, number]>) {
      if (!neighboursByVertex.has(u)) neighboursByVertex.set(u, new Set());
      if (!neighboursByVertex.has(v)) neighboursByVertex.set(v, new Set());
      neighboursByVertex.get(u)!.add(v);
      neighboursByVertex.get(v)!.add(u);
    }
  }

  const pentagons: number[][] = [];
  for (let v = 0; v < baseVerts.length; v++) {
    const neighbours = [...neighboursByVertex.get(v)!];
    const center = baseVerts[v];
    // Tangent-plane reference frame at V.
    const radial = center.clone().normalize();
    // Pick an arbitrary direction perpendicular to `radial` as the +x of the
    // tangent plane; the cross with radial gives +y.
    const refDir = Math.abs(radial.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const xAxis = refDir.clone().cross(radial).normalize();
    const yAxis = radial.clone().cross(xAxis).normalize();

    const sorted = neighbours
      .map((n) => {
        const idx = nearVertex.get(nearKey(v, n))!;
        const dir = newVerts[idx].clone().sub(center);
        const ang = Math.atan2(dir.dot(yAxis), dir.dot(xAxis));
        return { idx, ang };
      })
      .sort((a, b) => a.ang - b.ang)
      .map((e) => e.idx);

    pentagons.push(sorted);
  }

  // Compose the final PanelTopology.
  const panels: Panel[] = [];
  let panelIndex = 0;
  for (const loop of pentagons) {
    panels.push({
      id: panelId(panelIndex++, "pentagon"),
      vertexIndices: loop,
      shape: "pentagon",
    });
  }
  for (const loop of hexagons) {
    panels.push({
      id: panelId(panelIndex++, "hexagon"),
      vertexIndices: loop,
      shape: "hexagon",
    });
  }

  // Project all vertices to the sphere now so radius is consistent with other
  // presets at the time of return (downstream pipeline will project again
  // after subdivision; idempotent).
  for (const v of newVerts) v.setLength(radius);

  // Walk panel boundaries to build the edge adjacency table.
  const edgeMap = new Map<string, PanelEdge>();
  for (const panel of panels) {
    const loop = panel.vertexIndices;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.panelB = panel.id;
      } else {
        edgeMap.set(key, {
          vertexA: Math.min(a, b),
          vertexB: Math.max(a, b),
          panelA: panel.id,
          panelB: null,
        });
      }
    }
  }

  return { vertices: newVerts, panels, edges: [...edgeMap.values()] };
}

// -----------------------------------------------------------------------------
// Class I Goldberg polyhedra — GP(m, 0)
// -----------------------------------------------------------------------------
//
// The trisub (triangular subdivide) and dual operators below are TypeScript
// adaptations of routines from Anselm Levskaya's MIT-licensed Polyhédronisme
// project (https://github.com/levskaya/polyhedronisme,
// `topo_operators.js`). The data structures have been rewritten to use
// Paneler's PanelTopology format. See NOTICE in the repo root.
//
// Composition: goldbergClassI(m) = sphericalize ∘ dual ∘ trisub_m ∘ icosahedron
//
// Panel counts:
//   m=1 → 12 pentagons      (dodecahedron, identical to dodecahedron preset)
//   m=2 → 12 pent + 30 hex  (42 panels)
//   m=3 → 12 pent + 80 hex  (92 panels)
//   m=4 → 12 pent + 150 hex (162 panels)
//
// The general formula: 12 pentagons + 10(m² - 1) hexagons. Pentagons sit
// around each of the 12 original icosahedron vertices (which remain
// valence-5). Every other dual vertex is valence-6 → hexagon.

interface TriMesh {
  vertices: Vector3[];
  faces: number[][]; // each face is a list of vertex indices
}

function icoTriMesh(): TriMesh {
  return {
    vertices: ICO_VERTICES.map(([x, y, z]) => new Vector3(x, y, z)),
    faces: ICO_FACES.map((f) => [...f]),
  };
}

/**
 * Triangular subdivision (Goldberg-Coxeter u_n operator on a triangle mesh).
 *
 * Each face (V0, V1, V2) gets n² sub-triangles laid out on a barycentric grid:
 * vertices at v_ij = V0 + (i/n)(V1-V0) + (j/n)(V2-V0) for i+j ≤ n. Faces are
 * emitted as upward-pointing and downward-pointing sub-triangles, then
 * vertices are deduplicated by position (so face boundaries are shared
 * between adjacent faces, no T-junctions).
 *
 * Adapted from polyhedronisme's `trisub`.
 */
function trisub(mesh: TriMesh, n: number): TriMesh {
  // n=1 is a no-op (returns same topology).
  if (n < 2) return { vertices: mesh.vertices.map((v) => v.clone()), faces: mesh.faces.map((f) => [...f]) };

  // Sanity: only triangular meshes.
  for (const f of mesh.faces) {
    if (f.length !== 3) {
      throw new Error("trisub requires a triangular mesh");
    }
  }

  const allVerts: Vector3[] = [];
  // Per-face barycentric index → flat vertex index in `allVerts`.
  const idx: number[][][] = []; // idx[faceIdx][i][j]

  for (let fn = 0; fn < mesh.faces.length; fn++) {
    const [i1, i2, i3] = mesh.faces[fn];
    const v1 = mesh.vertices[i1];
    const v2 = mesh.vertices[i2];
    const v3 = mesh.vertices[i3];
    const v21 = v2.clone().sub(v1);
    const v31 = v3.clone().sub(v1);

    const grid: number[][] = [];
    for (let i = 0; i <= n; i++) {
      const row: number[] = [];
      for (let j = 0; j + i <= n; j++) {
        const v = v1.clone()
          .add(v21.clone().multiplyScalar(i / n))
          .add(v31.clone().multiplyScalar(j / n));
        row.push(allVerts.length);
        allVerts.push(v);
      }
      grid.push(row);
    }
    idx[fn] = grid;
  }

  // Deduplicate vertices by position. Faces along shared edges must reference
  // the same vertex index — otherwise the dual step produces wrong adjacency.
  const EPSILON = 1e-7;
  const uniqVerts: Vector3[] = [];
  const remap = new Map<number, number>();
  for (let i = 0; i < allVerts.length; i++) {
    let mappedTo = -1;
    for (let j = 0; j < uniqVerts.length; j++) {
      if (allVerts[i].distanceTo(uniqVerts[j]) < EPSILON) {
        mappedTo = j;
        break;
      }
    }
    if (mappedTo === -1) {
      mappedTo = uniqVerts.length;
      uniqVerts.push(allVerts[i]);
    }
    remap.set(i, mappedTo);
  }
  const r = (k: number) => remap.get(k)!;

  // Emit triangle faces per parent face.
  const faces: number[][] = [];
  for (let fn = 0; fn < mesh.faces.length; fn++) {
    const g = idx[fn];
    // Upward-pointing sub-triangles: (i,j) (i+1,j) (i,j+1).
    for (let i = 0; i < n; i++) {
      for (let j = 0; j + i < n; j++) {
        faces.push([r(g[i][j]), r(g[i + 1][j]), r(g[i][j + 1])]);
      }
    }
    // Downward-pointing sub-triangles: (i,j) (i,j+1) (i-1,j+1).
    for (let i = 1; i < n; i++) {
      for (let j = 0; j + i < n; j++) {
        faces.push([r(g[i][j]), r(g[i][j + 1]), r(g[i - 1][j + 1])]);
      }
    }
  }

  return { vertices: uniqVerts, faces };
}

/**
 * Take the geometric+topological dual of a TriMesh:
 *   - Every face becomes a vertex (placed at the face's centroid).
 *   - Every vertex becomes a face (the centroids of incident faces, ordered
 *     cyclically around the original vertex).
 *
 * Result is a PanelTopology with panels named panel_<idx>_<shape>.
 *
 * Adapted from polyhedronisme's `dual`. The cyclic-ordering walk is
 * re-derived here from the standard face-adjacency definition.
 */
function dualToTopology(mesh: TriMesh): PanelTopology {
  // 1. Face centroids → new vertex pool.
  const centroids: Vector3[] = mesh.faces.map((f) => {
    const c = new Vector3();
    for (const vi of f) c.add(mesh.vertices[vi]);
    return c.divideScalar(f.length);
  });

  // 2. For each input vertex, gather the indices of faces touching it and the
  //    "prev/next" vertex neighbours within each face (used to walk cyclically).
  type Inc = { faceIdx: number; prev: number; next: number };
  const incident: Inc[][] = mesh.vertices.map(() => []);
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi];
    for (let i = 0; i < face.length; i++) {
      const v = face[i];
      const prev = face[(i - 1 + face.length) % face.length];
      const next = face[(i + 1) % face.length];
      incident[v].push({ faceIdx: fi, prev, next });
    }
  }

  // 3. For each input vertex, walk the incident faces in cyclic order. Each
  //    new face's `prev` should equal the previous face's `next`.
  const panels: Panel[] = [];
  for (let v = 0; v < mesh.vertices.length; v++) {
    const incFaces = incident[v];
    if (incFaces.length < 3) continue; // degenerate; skip

    const used = new Set<number>([0]);
    const ordered: Inc[] = [incFaces[0]];
    while (ordered.length < incFaces.length) {
      const last = ordered[ordered.length - 1];
      let found = -1;
      for (let k = 0; k < incFaces.length; k++) {
        if (used.has(k)) continue;
        if (incFaces[k].prev === last.next) {
          found = k;
          break;
        }
      }
      if (found === -1) break; // mesh non-manifold here; bail
      used.add(found);
      ordered.push(incFaces[found]);
    }

    const vertexIndices = ordered.map((o) => o.faceIdx);

    // The cyclic-walk direction depends on the original triangle winding —
    // for some panels it lands CCW-from-outside, for others CW. Normalize
    // here so every panel renders with its front facing out and raycasts
    // hit the near side first (otherwise clicks pass through to the panel
    // on the far hemisphere).
    const a = centroids[vertexIndices[0]];
    const b = centroids[vertexIndices[1]];
    const c = centroids[vertexIndices[2]];
    const ab = b.clone().sub(a);
    const ac = c.clone().sub(a);
    const faceNormal = ab.cross(ac);
    const panelCentroid = new Vector3();
    for (const idx of vertexIndices) panelCentroid.add(centroids[idx]);
    panelCentroid.divideScalar(vertexIndices.length);
    if (faceNormal.dot(panelCentroid) < 0) {
      vertexIndices.reverse();
    }

    const shape: PanelShape = shapeForVertexCount(vertexIndices.length);
    panels.push({
      id: panelId(panels.length, shape),
      vertexIndices,
      shape,
    });
  }

  // 4. Build edge adjacency.
  const edgeMap = new Map<string, PanelEdge>();
  for (const panel of panels) {
    const loop = panel.vertexIndices;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.panelB = panel.id;
      } else {
        edgeMap.set(key, {
          vertexA: Math.min(a, b),
          vertexB: Math.max(a, b),
          panelA: panel.id,
          panelB: null,
        });
      }
    }
  }

  return { vertices: centroids, panels, edges: [...edgeMap.values()] };
}

/**
 * Class I Goldberg GP(m, 0):
 *   - m=1 → dodecahedron (12 pent, 0 hex)
 *   - m=2 → 42 panels    (12 pent, 30 hex)
 *   - m=3 → 92 panels    (12 pent, 80 hex)
 *   - m=4 → 162 panels   (12 pent, 150 hex)
 */
export function goldbergClassI(m: number, radius = 1): PanelTopology {
  if (m < 1 || !Number.isInteger(m)) {
    throw new Error("goldbergClassI(m) requires a positive integer m");
  }

  // Subdivide the icosahedron's triangles m times, sphericalize, take dual.
  const subdivided = trisub(icoTriMesh(), m);
  for (const v of subdivided.vertices) v.setLength(radius);
  const topo = dualToTopology(subdivided);

  // The dual's vertices (face centroids) are off the sphere; project them.
  for (const v of topo.vertices) v.setLength(radius);
  return topo;
}

