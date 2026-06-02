/**
 * Mesh preprocessing: extract the ball component, translate to origin,
 * scale to unit sphere, validate sphericity, weld duplicate vertices.
 *
 * The output `WeldedMesh` is what every downstream extractor consumes.
 *
 * Why this exists: real soccer ball GLBs aren't unit spheres. They have
 * bevels baked into vertex positions, sit at arbitrary origins, use
 * arbitrary radii, and may contain non-ball components (stands, logos).
 * Naive `setLength(1)` projects vertices from below the bevel surface,
 * which causes the boundary vertices of adjacent panels to fail to meet
 * exactly at junctions — small angular gaps that compound into the
 * visible "spillover" artifacts in our renderer.
 */
import type { Document } from "@gltf-transform/core";
import type { WeldedMesh } from "./types.js";

export interface PreprocessOptions {
  /** Distance threshold for welding vertices (in unit-sphere units). */
  weldEpsilon: number;
}

export interface PreprocessReport {
  source: {
    components: number;
    keptComponentVerts: number;
    droppedComponentVerts: number;
  };
  /** Pre-translation centroid (so a user can locate the original mesh). */
  originalCenter: [number, number, number];
  /** Best-fit sphere radius before scaling (in mesh's native units). */
  bestFitRadius: number;
  /** Vertex-distance distribution after scaling: min, p5, p50, p95, max. */
  radiusDistribution: [number, number, number, number, number];
  /** True iff 95% of verts lie within [0.92, 1.08] post-scale. */
  sphericityOk: boolean;
}

/**
 * Preprocess: take the largest sphere-fitting component, translate to
 * origin, scale to unit, weld near-duplicates. Throws if no component
 * is roughly spherical (sphericity check fails).
 */
export function preprocessMesh(
  doc: Document,
  opts: PreprocessOptions,
): { mesh: WeldedMesh; report: PreprocessReport; perPrimitive: PrimitiveMeta[] } {
  // ---------------------------------------------------------------------------
  // 1. Gather all primitives in the GLB. We treat each primitive as a
  //    potential "component" because a multi-material soccer ball is often
  //    encoded as one primitive per panel.
  // ---------------------------------------------------------------------------
  const primitives: PrimitiveMeta[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const [primIdx, prim] of mesh.listPrimitives().entries()) {
      const pos = prim.getAttribute("POSITION")?.getArray() as
        | Float32Array
        | undefined;
      const idx = prim.getIndices()?.getArray() as
        | Uint16Array
        | Uint32Array
        | undefined;
      if (!pos || !idx) continue;
      primitives.push({
        meshName: mesh.getName() ?? `mesh_${primIdx}`,
        primIdx,
        positions: pos,
        triangles: idx,
        uvs: prim.getAttribute("TEXCOORD_0")?.getArray() as
          | Float32Array
          | undefined,
        normals: prim.getAttribute("NORMAL")?.getArray() as
          | Float32Array
          | undefined,
        materialName: prim.getMaterial()?.getName() ?? null,
      });
    }
  }

  if (primitives.length === 0) {
    throw new Error("GLB contains no geometry");
  }

  // ---------------------------------------------------------------------------
  // 2. Component filter. For each primitive, compute its bounding-sphere
  //    fit error: median radius (robust) vs the spread of radii. A perfect
  //    sphere has near-zero spread. Drop primitives whose spread > 50% of
  //    the median (they're flat planes, logos, etc.). When we still have
  //    multiple after filtering, KEEP ALL — they're likely per-panel
  //    primitives of the same ball.
  // ---------------------------------------------------------------------------
  type Ranked = PrimitiveMeta & {
    center: [number, number, number];
    medianR: number;
    spread: number;
  };

  const ranked: Ranked[] = primitives.map((p) => {
    const stats = primitiveStats(p.positions);
    return { ...p, ...stats };
  });

  // Global ball center: average primitive centers. If the GLB has one ball
  // split into multiple primitives, all their centers cluster around the
  // same point; if it has a ball + a stand, the centers differ a lot.
  const cluster = clusterCenters(ranked);

  const kept = ranked.filter(
    (p) =>
      p.spread / p.medianR < 0.5 && // it's at least roughly spherical
      vec3Dist(p.center, cluster.center) < cluster.medianClusterDist * 2 + 0.1,
  );
  if (kept.length === 0) {
    throw new Error(
      "No sphere-like component found. Mesh appears to not be a ball.",
    );
  }
  const dropped = ranked.filter((p) => !kept.includes(p));

  const keptVerts = kept.reduce((s, p) => s + p.positions.length / 3, 0);
  const droppedVerts = dropped.reduce(
    (s, p) => s + p.positions.length / 3,
    0,
  );

  // ---------------------------------------------------------------------------
  // 3. Merge kept primitives into a single flat vertex/triangle pool, with
  //    a per-vertex tag for which primitive it came from (needed by the
  //    primitives-mode seam detector).
  // ---------------------------------------------------------------------------
  let totalRawVerts = 0;
  let totalTris = 0;
  const hasUvs = kept.every((p) => p.uvs);
  const hadNormals = kept.every((p) => p.normals);
  for (const k of kept) {
    totalRawVerts += k.positions.length / 3;
    totalTris += k.triangles.length / 3;
  }
  const allPositions = new Float32Array(totalRawVerts * 3);
  const allTris = new Uint32Array(totalTris * 3);
  const allUvs = hasUvs ? new Float32Array(totalRawVerts * 2) : undefined;
  const allNormals = hadNormals
    ? new Float32Array(totalRawVerts * 3)
    : undefined;
  const primOfVert = new Uint32Array(totalRawVerts);

  let vCursor = 0;
  let tCursor = 0;
  const perPrimitive: PrimitiveMeta[] = [];
  for (const [pIdx, k] of kept.entries()) {
    const vBase = vCursor;
    const vCount = k.positions.length / 3;
    allPositions.set(k.positions, vBase * 3);
    if (allUvs && k.uvs) allUvs.set(k.uvs, vBase * 2);
    if (allNormals && k.normals) allNormals.set(k.normals, vBase * 3);
    primOfVert.fill(pIdx, vBase, vBase + vCount);
    for (let t = 0; t < k.triangles.length; t++) {
      allTris[tCursor + t] = k.triangles[t] + vBase;
    }
    perPrimitive.push(k);
    vCursor += vCount;
    tCursor += k.triangles.length;
  }

  // ---------------------------------------------------------------------------
  // 4. Translate to origin (bounding-box center) and scale to unit sphere
  //    (median distance from origin). Median is robust against the bevel
  //    pull-out of ~5-10% of verts on a real ball.
  // ---------------------------------------------------------------------------
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < totalRawVerts; i++) {
    const x = allPositions[i * 3];
    const y = allPositions[i * 3 + 1];
    const z = allPositions[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  for (let i = 0; i < totalRawVerts; i++) {
    allPositions[i * 3] -= cx;
    allPositions[i * 3 + 1] -= cy;
    allPositions[i * 3 + 2] -= cz;
  }

  const radii = new Float64Array(totalRawVerts);
  for (let i = 0; i < totalRawVerts; i++) {
    const x = allPositions[i * 3];
    const y = allPositions[i * 3 + 1];
    const z = allPositions[i * 3 + 2];
    radii[i] = Math.sqrt(x * x + y * y + z * z);
  }
  const sortedR = Float64Array.from(radii).sort();
  const median = percentile(sortedR, 0.5);
  if (median <= 0) throw new Error("Degenerate mesh: median radius is zero");

  const scale = 1 / median;
  for (let i = 0; i < totalRawVerts * 3; i++) allPositions[i] *= scale;
  for (let i = 0; i < totalRawVerts; i++) radii[i] *= scale;

  const sortedRScaled = Float64Array.from(radii).sort();
  const dist: PreprocessReport["radiusDistribution"] = [
    sortedRScaled[0],
    percentile(sortedRScaled, 0.05),
    percentile(sortedRScaled, 0.5),
    percentile(sortedRScaled, 0.95),
    sortedRScaled[sortedRScaled.length - 1],
  ];
  const sphericityOk = dist[1] >= 0.92 && dist[3] <= 1.08;

  // ---------------------------------------------------------------------------
  // 5. Weld vertices by position. Welding AFTER scaling so the epsilon is
  //    in unit-sphere units. Spatial hash for O(N) welding.
  // ---------------------------------------------------------------------------
  const eps = opts.weldEpsilon;
  const cell = eps * 10;
  const bins = new Map<string, number[]>();
  const weldOf = new Int32Array(totalRawVerts);
  const weldedPositions: number[] = [];

  function binKey(x: number, y: number, z: number): string {
    return `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  }

  for (let i = 0; i < totalRawVerts; i++) {
    const x = allPositions[i * 3];
    const y = allPositions[i * 3 + 1];
    const z = allPositions[i * 3 + 2];
    const bx = Math.floor(x / cell);
    const by = Math.floor(y / cell);
    const bz = Math.floor(z / cell);
    let found = -1;
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = bins.get(`${bx + dx},${by + dy},${bz + dz}`);
          if (!arr) continue;
          for (const j of arr) {
            const dx2 = weldedPositions[j * 3] - x;
            const dy2 = weldedPositions[j * 3 + 1] - y;
            const dz2 = weldedPositions[j * 3 + 2] - z;
            if (dx2 * dx2 + dy2 * dy2 + dz2 * dz2 < eps * eps) {
              found = j;
              break outer;
            }
          }
        }
      }
    }
    if (found === -1) {
      found = weldedPositions.length / 3;
      weldedPositions.push(x, y, z);
      const key = binKey(x, y, z);
      const arr = bins.get(key);
      if (arr) arr.push(found);
      else bins.set(key, [found]);
    }
    weldOf[i] = found;
  }
  const weldedVertCount = weldedPositions.length / 3;

  // After welding, snap each WELDED vertex to the unit sphere — this
  // collapses the bevel offset (~5-10% radial wobble) onto an exact unit
  // sphere. Curves extracted from this geometry will lie cleanly on the
  // sphere, so downstream subdivision interpolations work as expected.
  for (let i = 0; i < weldedVertCount; i++) {
    const x = weldedPositions[i * 3];
    const y = weldedPositions[i * 3 + 1];
    const z = weldedPositions[i * 3 + 2];
    const r = Math.sqrt(x * x + y * y + z * z) || 1;
    weldedPositions[i * 3] = x / r;
    weldedPositions[i * 3 + 1] = y / r;
    weldedPositions[i * 3 + 2] = z / r;
  }

  return {
    mesh: {
      positions: Float32Array.from(weldedPositions),
      triangles: allTris,
      weldOf,
      uvs: allUvs,
      normals: allNormals,
      source: {
        rawVertices: totalRawVerts,
        weldedVertices: weldedVertCount,
        triangles: totalTris,
        hasUvs,
        hadNormals,
      },
    },
    report: {
      source: {
        components: primitives.length,
        keptComponentVerts: keptVerts,
        droppedComponentVerts: droppedVerts,
      },
      originalCenter: [cx, cy, cz],
      bestFitRadius: median,
      radiusDistribution: dist,
      sphericityOk,
    },
    perPrimitive,
  };
}

// ============================================================================
// Helpers
// ============================================================================

export interface PrimitiveMeta {
  meshName: string;
  primIdx: number;
  positions: Float32Array;
  triangles: Uint16Array | Uint32Array;
  uvs?: Float32Array;
  normals?: Float32Array;
  materialName: string | null;
}

function primitiveStats(positions: Float32Array): {
  center: [number, number, number];
  medianR: number;
  spread: number;
} {
  const n = positions.length / 3;
  let sx = 0,
    sy = 0,
    sz = 0;
  for (let i = 0; i < n; i++) {
    sx += positions[i * 3];
    sy += positions[i * 3 + 1];
    sz += positions[i * 3 + 2];
  }
  const center: [number, number, number] = [sx / n, sy / n, sz / n];
  const radii = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] - center[0];
    const y = positions[i * 3 + 1] - center[1];
    const z = positions[i * 3 + 2] - center[2];
    radii[i] = Math.sqrt(x * x + y * y + z * z);
  }
  const sorted = Float64Array.from(radii).sort();
  const medianR = percentile(sorted, 0.5);
  // Spread: half the inter-quartile range, normalized would risk div-by-zero
  // on a perfect sphere so we just use absolute IQR.
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const spread = q3 - q1;
  return { center, medianR, spread };
}

function clusterCenters(items: Array<{ center: [number, number, number] }>): {
  center: [number, number, number];
  medianClusterDist: number;
} {
  if (items.length === 1) {
    return { center: items[0].center, medianClusterDist: 0 };
  }
  // Simple median-of-axes is robust enough — soccer balls won't have
  // many components clustered in weird ways.
  const xs = items.map((p) => p.center[0]).sort((a, b) => a - b);
  const ys = items.map((p) => p.center[1]).sort((a, b) => a - b);
  const zs = items.map((p) => p.center[2]).sort((a, b) => a - b);
  const center: [number, number, number] = [
    xs[Math.floor(xs.length / 2)],
    ys[Math.floor(ys.length / 2)],
    zs[Math.floor(zs.length / 2)],
  ];
  const dists = items
    .map((p) => vec3Dist(p.center, center))
    .sort((a, b) => a - b);
  return {
    center,
    medianClusterDist: dists[Math.floor(dists.length / 2)],
  };
}

function vec3Dist(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
