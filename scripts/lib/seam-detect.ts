/**
 * Seam edge detection. Three modes:
 *
 *   - `uv-seams`: single mesh, panel boundaries from UV-coord discontinuities
 *     at shared welded edges (the artist split UVs at panel edges for clean
 *     texturing). This is what the Trionda GLB needs.
 *
 *   - `hard-edges`: single mesh, panel boundaries from face-normal
 *     discontinuities (artist authored hard edges along panel boundaries).
 *     Common in older soccer ball models without texture-baked UVs.
 *
 *   - `primitives`: pre-split mesh, each glTF primitive is one panel.
 *     The "seams" are the edges that only appear in ONE primitive's triangle
 *     list when the global mesh is merged.
 *
 * Auto-detect tries primitives → uv-seams → hard-edges in that order,
 * picking the first that produces a non-trivial seam graph (≥1 junction).
 */
import type {
  ExtractionMode,
  SeamEdge,
  SeamGraph,
  WeldedMesh,
} from "./types.js";
import type { PrimitiveMeta } from "./mesh-preprocess.js";

export interface SeamDetectOptions {
  /** Quantize step for UV coords — collapses floating-point noise. */
  uvQuantize?: number;
  /** Min angle (degrees) between adjacent face normals to count as a seam. */
  hardEdgeThresholdDeg?: number;
}

export interface SeamDetectResult {
  graph: SeamGraph;
  modeUsed: ExtractionMode;
  /** Per-mode telemetry for the verification report. */
  notes: string[];
}

/** Run detection in the requested mode (or auto). Throws if nothing works. */
export function detectSeams(
  mesh: WeldedMesh,
  primitives: PrimitiveMeta[],
  mode: "auto" | ExtractionMode,
  options: SeamDetectOptions = {},
): SeamDetectResult {
  const order: ExtractionMode[] =
    mode === "auto"
      ? ["primitives", "uv-seams", "hard-edges"]
      : [mode];

  const notes: string[] = [];
  for (const m of order) {
    const result = runMode(mesh, primitives, m, options);
    if (result) {
      notes.push(`Using mode=${m}: ${result.graph.junctions.size} junctions found`);
      if (mode === "auto") {
        notes.unshift(
          `Auto-detect tried ${order.slice(0, order.indexOf(m) + 1).join(" → ")}`,
        );
      }
      return { ...result, modeUsed: m, notes: [...notes, ...result.notes] };
    }
    notes.push(`Mode ${m} produced no usable seam graph`);
  }

  throw new Error(
    `No extraction mode produced a usable seam graph.\n` +
      `Tried: ${order.join(", ")}.\n` +
      `If the mesh has hard edges along panel boundaries, try` +
      ` --mode hard-edges --hard-edge-threshold 15.\n` +
      `If junctions need manual placement, try --override-junctions <file.json>.`,
  );
}

function runMode(
  mesh: WeldedMesh,
  primitives: PrimitiveMeta[],
  mode: ExtractionMode,
  options: SeamDetectOptions,
): Omit<SeamDetectResult, "modeUsed"> | null {
  let edges: SeamEdge[];
  const notes: string[] = [];
  switch (mode) {
    case "uv-seams":
      if (!mesh.uvs) return null;
      edges = detectUvSeams(mesh, options.uvQuantize ?? 10000);
      break;
    case "hard-edges":
      edges = detectHardEdges(
        mesh,
        (options.hardEdgeThresholdDeg ?? 30) * (Math.PI / 180),
      );
      break;
    case "primitives":
      if (primitives.length < 2) return null;
      edges = detectPrimitiveSeams(mesh, primitives);
      break;
  }
  if (edges.length === 0) return null;
  const graph = buildSeamGraph(edges);
  if (graph.junctions.size === 0) return null;
  notes.push(`${edges.length} seam edges, ${graph.vertices.size} seam verts`);
  return { graph, notes };
}

// ============================================================================
// UV-seam detection (the Trionda path)
// ============================================================================

/**
 * For each welded edge (= edge between two welded vertices that appears in
 * the triangle list), collect the set of (UV-at-lo, UV-at-hi) pairs from
 * every triangle that uses that edge. If we see more than one distinct
 * UV-pair across triangles, the edge sits on a UV seam — the artist split
 * the vertex there for texturing, which always indicates a panel boundary.
 *
 * Quantizing UVs is essential: float noise on the same UV coord produces
 * artifact "seams" along every triangle edge.
 */
function detectUvSeams(mesh: WeldedMesh, uvQuant: number): SeamEdge[] {
  const { triangles, weldOf, uvs } = mesh;
  if (!uvs) return [];

  const edgeUvSets = new Map<string, Set<string>>();

  function quantUv(origVert: number): string {
    return `${Math.round(uvs![origVert * 2] * uvQuant)},${Math.round(uvs![origVert * 2 + 1] * uvQuant)}`;
  }

  function record(va: number, vb: number) {
    const wa = weldOf[va];
    const wb = weldOf[vb];
    if (wa === wb) return;
    const swap = wa > wb;
    const lo = swap ? wb : wa;
    const hi = swap ? wa : wb;
    const uvLo = swap ? quantUv(vb) : quantUv(va);
    const uvHi = swap ? quantUv(va) : quantUv(vb);
    const key = `${lo}-${hi}`;
    const sig = `${uvLo}|${uvHi}`;
    const set = edgeUvSets.get(key);
    if (set) set.add(sig);
    else edgeUvSets.set(key, new Set([sig]));
  }

  const triCount = triangles.length / 3;
  for (let t = 0; t < triCount; t++) {
    const a = triangles[t * 3];
    const b = triangles[t * 3 + 1];
    const c = triangles[t * 3 + 2];
    record(a, b);
    record(b, c);
    record(c, a);
  }

  const edges: SeamEdge[] = [];
  for (const [key, sigs] of edgeUvSets) {
    if (sigs.size > 1) {
      const [lo, hi] = key.split("-").map(Number);
      edges.push([lo, hi]);
    }
  }
  return edges;
}

// ============================================================================
// Hard-edge detection (for older meshes without UV seams)
// ============================================================================

/**
 * For each welded edge appearing in exactly 2 triangles, compare the two
 * triangles' face normals. If the angle between them exceeds the threshold,
 * the artist authored a hard edge there — almost always a panel boundary.
 *
 * Edges that appear in 1 or >2 triangles are also flagged as seams (mesh
 * boundary or non-manifold; both indicate panel-relevant features).
 */
function detectHardEdges(mesh: WeldedMesh, thresholdRad: number): SeamEdge[] {
  const { triangles, weldOf, positions } = mesh;
  const cosThreshold = Math.cos(thresholdRad);

  // Map each welded edge → list of triangle indices using it.
  const edgeTris = new Map<string, number[]>();
  const triCount = triangles.length / 3;

  function edgeKey(wa: number, wb: number): string {
    return wa < wb ? `${wa}-${wb}` : `${wb}-${wa}`;
  }

  for (let t = 0; t < triCount; t++) {
    const a = weldOf[triangles[t * 3]];
    const b = weldOf[triangles[t * 3 + 1]];
    const c = weldOf[triangles[t * 3 + 2]];
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (u === v) continue;
      const k = edgeKey(u, v);
      const arr = edgeTris.get(k);
      if (arr) arr.push(t);
      else edgeTris.set(k, [t]);
    }
  }

  // Precompute face normals at the welded level.
  const triNormals = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const ai = weldOf[triangles[t * 3]] * 3;
    const bi = weldOf[triangles[t * 3 + 1]] * 3;
    const ci = weldOf[triangles[t * 3 + 2]] * 3;
    const ax = positions[ai],
      ay = positions[ai + 1],
      az = positions[ai + 2];
    const bx = positions[bi] - ax,
      by = positions[bi + 1] - ay,
      bz = positions[bi + 2] - az;
    const cx = positions[ci] - ax,
      cy = positions[ci + 1] - ay,
      cz = positions[ci + 2] - az;
    let nx = by * cz - bz * cy;
    let ny = bz * cx - bx * cz;
    let nz = bx * cy - by * cx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    triNormals[t * 3] = nx;
    triNormals[t * 3 + 1] = ny;
    triNormals[t * 3 + 2] = nz;
  }

  const edges: SeamEdge[] = [];
  for (const [key, tris] of edgeTris) {
    if (tris.length === 1 || tris.length > 2) {
      // Mesh boundary or non-manifold — always a seam.
      const [lo, hi] = key.split("-").map(Number);
      edges.push([lo, hi]);
      continue;
    }
    const t1 = tris[0];
    const t2 = tris[1];
    const d =
      triNormals[t1 * 3] * triNormals[t2 * 3] +
      triNormals[t1 * 3 + 1] * triNormals[t2 * 3 + 1] +
      triNormals[t1 * 3 + 2] * triNormals[t2 * 3 + 2];
    if (d < cosThreshold) {
      const [lo, hi] = key.split("-").map(Number);
      edges.push([lo, hi]);
    }
  }
  return edges;
}

// ============================================================================
// Primitive-mode detection (each glTF primitive is one panel)
// ============================================================================

/**
 * When the artist authored the ball as one mesh per panel, the panel
 * boundaries are the edges where two ADJACENT primitives meet — i.e.
 * welded edges where the two adjacent triangles came from different
 * primitives.
 *
 * Note: this relies on the welding step having merged shared boundary
 * vertices across primitives (which happens naturally because primitives
 * sharing a panel edge have coincident vertices there).
 */
function detectPrimitiveSeams(
  mesh: WeldedMesh,
  primitives: PrimitiveMeta[],
): SeamEdge[] {
  // Build primOfOrigVert: for each ORIGINAL vertex index in the merged
  // mesh, which primitive did it come from?
  let cursor = 0;
  const primOf = new Uint32Array(mesh.weldOf.length);
  for (const [pIdx, p] of primitives.entries()) {
    const n = p.positions.length / 3;
    primOf.fill(pIdx, cursor, cursor + n);
    cursor += n;
  }
  // Build primsOfWeldedVert: which primitive(s) does each welded vertex
  // belong to?
  const primsOfWelded = new Map<number, Set<number>>();
  for (let i = 0; i < mesh.weldOf.length; i++) {
    const w = mesh.weldOf[i];
    const p = primOf[i];
    const set = primsOfWelded.get(w);
    if (set) set.add(p);
    else primsOfWelded.set(w, new Set([p]));
  }

  // A welded edge is a seam IFF both endpoints have more than one
  // associated primitive AND there's any pair of primitives that share
  // both endpoints (i.e. the edge sits on the shared boundary).
  const seen = new Set<string>();
  const edges: SeamEdge[] = [];
  const triCount = mesh.triangles.length / 3;

  function edgeKey(wa: number, wb: number): string {
    return wa < wb ? `${wa}-${wb}` : `${wb}-${wa}`;
  }

  for (let t = 0; t < triCount; t++) {
    const a = mesh.weldOf[mesh.triangles[t * 3]];
    const b = mesh.weldOf[mesh.triangles[t * 3 + 1]];
    const c = mesh.weldOf[mesh.triangles[t * 3 + 2]];
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (u === v) continue;
      const k = edgeKey(u, v);
      if (seen.has(k)) continue;
      const setU = primsOfWelded.get(u);
      const setV = primsOfWelded.get(v);
      if (!setU || !setV) continue;
      // Intersection cardinality > 1 → two primitives share both endpoints.
      let shared = 0;
      for (const p of setU) {
        if (setV.has(p)) shared++;
        if (shared >= 2) break;
      }
      if (shared >= 2) {
        seen.add(k);
        const [lo, hi] = k.split("-").map(Number);
        edges.push([lo, hi]);
      }
    }
  }
  return edges;
}

// ============================================================================
// Graph construction
// ============================================================================

function buildSeamGraph(edges: SeamEdge[]): SeamGraph {
  const adjacency = new Map<number, Set<number>>();
  const vertices = new Set<number>();
  for (const [a, b] of edges) {
    vertices.add(a);
    vertices.add(b);
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }
  const junctions = new Set<number>();
  for (const [v, neighbors] of adjacency) {
    if (neighbors.size >= 3) junctions.add(v);
  }
  return { edges, vertices, adjacency, junctions };
}

/** Replace the auto-detected junctions with a user-specified list (advanced).
 *  Each provided position snaps to the closest welded vertex. */
export function overrideJunctions(
  mesh: WeldedMesh,
  graph: SeamGraph,
  overrides: Array<[number, number, number]>,
): SeamGraph {
  const newJunctions = new Set<number>();
  for (const [ox, oy, oz] of overrides) {
    let best = -1;
    let bestD2 = Infinity;
    for (const v of graph.vertices) {
      const dx = mesh.positions[v * 3] - ox;
      const dy = mesh.positions[v * 3 + 1] - oy;
      const dz = mesh.positions[v * 3 + 2] - oz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = v;
      }
    }
    if (best >= 0) newJunctions.add(best);
  }
  return { ...graph, junctions: newJunctions };
}

/** Trace seam curves between junctions (walks degree-2 chains). */
export function traceCurveSegments(graph: SeamGraph): Array<{
  a: number;
  b: number;
  path: number[];
}> {
  const { adjacency, junctions } = graph;
  const segments: Array<{ a: number; b: number; path: number[] }> = [];
  const visited = new Set<string>();

  function edgeKey(u: number, v: number): string {
    return u < v ? `${u}-${v}` : `${v}-${u}`;
  }

  for (const start of junctions) {
    for (const first of adjacency.get(start) ?? []) {
      if (visited.has(edgeKey(start, first))) continue;
      const path: number[] = [start, first];
      visited.add(edgeKey(start, first));
      let prev = start;
      let curr = first;
      while (!junctions.has(curr)) {
        const next = [...(adjacency.get(curr) ?? [])].find((n) => n !== prev);
        if (next === undefined) break;
        visited.add(edgeKey(curr, next));
        path.push(next);
        prev = curr;
        curr = next;
      }
      segments.push({ a: start, b: curr, path });
    }
  }
  return segments;
}
