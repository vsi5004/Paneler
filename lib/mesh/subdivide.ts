import { Vector3 } from "three";
import {
  type Panel,
  type PanelEdge,
  type PanelTopology,
  shapeForVertexCount,
} from "@/lib/types";

/**
 * Subdivide each panel face by:
 *   1. Triangulating the panel — fan-triangulation from the panel centroid
 *      when the panel is star-shaped about it; ear-clipping in a tangent-plane
 *      projection otherwise (concave pinwheel panels like Trionda's, whose fan
 *      lines would reach across their hooked arms into neighbouring panels
 *      and produce overlapping surfaces).
 *   2. Subdividing each resulting triangle into a barycentric grid of `levels`
 *      sub-triangles per edge.
 *
 * The output topology has the same panel set (same IDs, same boundary loops),
 * but each panel internally references a denser vertex pool. The subdivided
 * geometry is what we hand to `projectToSphere` so panel surfaces curve smoothly
 * along the sphere instead of being polygon-chord flat.
 *
 * Panel-boundary vertices are deduplicated across adjacent panels via an edge
 * cache, so projecting later doesn't introduce T-junctions / cracks.
 */
export function subdivideTopology(
  topo: PanelTopology,
  levels: number,
): PanelTopology {
  if (levels < 1) {
    return cloneTopology(topo);
  }

  const newVertices: Vector3[] = topo.vertices.map((v) => v.clone());

  // Count how many panels each vertex appears in — used by the centroid
  // helper to find "junctions" (verts where ≥3 panels meet, i.e. true
  // corner points on the sphere). Densely-sampled wavy boundaries
  // (Trionda's 147-vert panels) have most verts on just 2 panels, with
  // only the true corners shared across 3+. The junction centroid is
  // much closer to the panel's geometric center than the mean of all
  // 147 boundary samples.
  const vertexPanelCount = new Map<number, number>();
  for (const p of topo.panels) {
    for (const v of p.vertexIndices) {
      vertexPanelCount.set(v, (vertexPanelCount.get(v) ?? 0) + 1);
    }
  }

  // Per-vertex barycentric depth: 0 at panel boundary, 1 at centroid.
  // Used by puffPanels() to inflate interior vertices outward.
  // Absent entries default to 0 (boundary / edge vertices).
  const vertexDepth = new Map<number, number>();

  // Cache vertices that live on a panel boundary edge — keyed by the canonical
  // edge (min,max) plus a step index along the edge. Adjacent panels share the
  // same boundary and must therefore share interior-edge vertex indices.
  const edgeVertexCache = new Map<string, number>();

  // Each "subdivided panel" needs a list of triangles (vertex-index triples)
  // for the eventual mesh build. We store those alongside the original panel
  // metadata. Boundary vertices stay in panel.vertexIndices (so panel boundary
  // loops are preserved for adjacent-panel edges and the future SVG unfold).
  const panelTriangles = new Map<string, [number, number, number][]>();

  // For each ORIGINAL panel edge (canonical lo-hi corner-vertex pair), the
  // ordered chain of post-subdivision vertex indices from lo to hi. Used by
  // buildMeshGroup to draw clean panel boundaries without using dihedral
  // thresholds — the within-panel subdivision grid is excluded entirely.
  const boundaryArcs = new Map<string, number[]>();

  for (const panel of topo.panels) {
    const triangles: [number, number, number][] = [];

    const centroid = computeCentroid(
      topo.vertices,
      panel.vertexIndices,
      vertexPanelCount,
    );

    // Fan triangulation is only valid when the panel is star-shaped about
    // the centroid — otherwise fan lines exit the panel and the surface
    // overlaps its neighbours. Concave panels take the ear-clipping path.
    if (!isStarShapedAbout(newVertices, panel.vertexIndices, centroid)) {
      subdivideConcavePanel({
        pool: newVertices,
        loop: panel.vertexIndices,
        center: centroid,
        levels,
        edgeVertexCache,
        boundaryArcs,
        triangles,
      });
      panelTriangles.set(panel.id, triangles);
      continue;
    }

    // Fan-triangulate from the panel centroid: each (corner_i, corner_i+1)
    // edge becomes a parent triangle (centroid, corner_i, corner_i+1).
    const centroidIdx = addVertex(newVertices, centroid);
    vertexDepth.set(centroidIdx, 1);

    // Interior vertices along each fan line (corner → centroid) are shared
    // between the two fan sectors flanking that corner. Without this cache
    // both sectors emitted their own copies at identical positions — the
    // mesh looked watertight but carried duplicated vertices, which wasted
    // memory, split vertex normals along every fan line (faint shading
    // creases), and broke index-based open-edge detection.
    const fanLineCache = new Map<string, number>();

    const boundaryLoop = panel.vertexIndices;
    for (let i = 0; i < boundaryLoop.length; i++) {
      const aIdx = boundaryLoop[i];
      const bIdx = boundaryLoop[(i + 1) % boundaryLoop.length];

      // Subdivide the boundary edge (a→b) into `levels+1` segments. The
      // intermediate vertices are shared with the neighbour panel via the
      // edge cache (keyed by canonical edge, not by panel).
      const boundaryEdgeVerts = subdivideEdge(
        newVertices,
        edgeVertexCache,
        aIdx,
        bIdx,
        levels,
      );

      // Record the canonical lo→hi arc once. Adjacent panel will hit this
      // same edge from the opposite direction; the cache makes it a no-op.
      const arcKey = `${Math.min(aIdx, bIdx)}-${Math.max(aIdx, bIdx)}`;
      if (!boundaryArcs.has(arcKey)) {
        boundaryArcs.set(
          arcKey,
          aIdx < bIdx ? [...boundaryEdgeVerts] : [...boundaryEdgeVerts].reverse(),
        );
      }

      // Build a (levels+1)-row barycentric grid inside the parent triangle:
      //   row 0 is the boundary edge (shared with neighbour panel)
      //   row `levels` collapses to the centroid
      const rows: number[][] = [boundaryEdgeVerts];
      for (let row = 1; row <= levels; row++) {
        const rowVerts: number[] = [];
        const t = row / levels; // 0 at boundary, 1 at centroid
        const segCount = levels - row + 1; // points in this row
        for (let s = 0; s < segCount; s++) {
          if (row === levels) {
            rowVerts.push(centroidIdx);
            continue;
          }
          // First/last points of a row sit on the fan line of aIdx/bIdx —
          // shared with the neighbouring fan sector via the cache.
          const fanKey =
            s === 0
              ? `${aIdx}-${row}`
              : s === segCount - 1
                ? `${bIdx}-${row}`
                : null;
          if (fanKey !== null) {
            const cached = fanLineCache.get(fanKey);
            if (cached !== undefined) {
              rowVerts.push(cached);
              continue;
            }
          }
          const along = segCount === 1 ? 0.5 : s / (segCount - 1);
          const edgePoint = lerp3(
            newVertices[aIdx],
            newVertices[bIdx],
            along,
          );
          const interior = lerp3(edgePoint, newVertices[centroidIdx], t);
          const idx = addVertex(newVertices, interior);
          vertexDepth.set(idx, t);
          if (fanKey !== null) fanLineCache.set(fanKey, idx);
          rowVerts.push(idx);
        }
        rows.push(rowVerts);
      }

      // Emit triangles between consecutive rows.
      for (let row = 0; row < rows.length - 1; row++) {
        const upper = rows[row];
        const lower = rows[row + 1];
        for (let s = 0; s < lower.length; s++) {
          triangles.push([upper[s], upper[s + 1], lower[s]]);
          if (s < lower.length - 1) {
            triangles.push([upper[s + 1], lower[s + 1], lower[s]]);
          }
        }
        // Row 0 (boundary) has 2 more points than row 1, so the strip
        // above misses the last boundary vertex (bIdx corner). Add the
        // closing triangle to prevent pinwheel gaps at panel vertices.
        if (row === 0 && upper.length >= lower.length + 2) {
          triangles.push([
            upper[upper.length - 2],
            upper[upper.length - 1],
            lower[lower.length - 1],
          ]);
        }
      }
    }

    panelTriangles.set(panel.id, triangles);
  }

  // Rebuild edges so the boundary-edge information stays valid against the new
  // vertex pool — endpoint indices haven't moved (the original vertices kept
  // their indices) so edges port over unchanged.
  const newPanels: Panel[] = topo.panels.map((p) => ({
    id: p.id,
    vertexIndices: [...p.vertexIndices],
    shape: shapeForVertexCount(p.vertexIndices.length),
  }));

  const result: PanelTopology & {
    _triangles?: Map<string, [number, number, number][]>;
    _boundaryArcs?: Map<string, number[]>;
    _vertexDepth?: Map<number, number>;
  } = {
    vertices: newVertices,
    panels: newPanels,
    edges: topo.edges.map((e) => ({ ...e })),
  };

  // Attach the triangle index lists + boundary arcs. `buildMeshGroup` reads
  // both — triangles for the panel surfaces, arcs for the seam lines.
  result._triangles = panelTriangles;
  result._boundaryArcs = boundaryArcs;
  result._vertexDepth = vertexDepth;
  return result;
}

function cloneTopology(topo: PanelTopology): PanelTopology {
  return {
    vertices: topo.vertices.map((v) => v.clone()),
    panels: topo.panels.map((p) => ({ ...p, vertexIndices: [...p.vertexIndices] })),
    edges: topo.edges.map((e) => ({ ...e })),
  };
}

function computeCentroid(
  vertices: Vector3[],
  indices: readonly number[],
  vertexPanelCount?: ReadonlyMap<number, number>,
): Vector3 {
  const radius = vertices[indices[0]].length() || 1;

  // If we know which verts are junctions (≥3 panels), prefer their mean.
  // For densely-sampled wavy panels (Trionda's 147-vert boundary, only 3
  // of which are true tetrahedral corners), this gives the actual
  // geometric center of the spherical triangle. The mean-of-all-boundary
  // approach is biased by sampling density along the wavy curves.
  if (vertexPanelCount) {
    const junctions: number[] = [];
    for (const idx of indices) {
      if ((vertexPanelCount.get(idx) ?? 0) >= 3) junctions.push(idx);
    }
    if (junctions.length >= 3) {
      const c = new Vector3();
      for (const idx of junctions) c.add(vertices[idx]);
      c.divideScalar(junctions.length).normalize().multiplyScalar(radius);
      return c;
    }
  }

  // Arithmetic average of boundary corners. For panels that fully circle
  // the sphere (e.g. Baseball's wavy seam, whose ±latitude swings cancel
  // out), this collapses to ≈ 0 and we need a different approach below.
  const naive = new Vector3();
  for (const idx of indices) naive.add(vertices[idx]);
  naive.divideScalar(indices.length);

  if (naive.lengthSq() < 0.04) {
    // Fan-triangulation from origin would spike every parent triangle
    // through the ball's interior and projectToSphere refuses to normalize
    // the zero-length vertex, so the panel renders as garbage. Fall back
    // to the signed-area vector (Σ vᵢ × vᵢ₊₁), which always points to the
    // panel's interior hemisphere regardless of boundary shape — for a
    // CCW-from-outside boundary it's the outward face normal at the
    // panel center.
    const areaVec = new Vector3();
    const cross = new Vector3();
    for (let i = 0; i < indices.length; i++) {
      const a = vertices[indices[i]];
      const b = vertices[indices[(i + 1) % indices.length]];
      cross.crossVectors(a, b);
      areaVec.add(cross);
    }
    if (areaVec.lengthSq() > 0) {
      return areaVec.normalize().multiplyScalar(radius);
    }
  }

  // Project the mean direction onto the sphere surface. Without this, the
  // centroid sits INSIDE the sphere (magnitude 0.3–0.7 for big panels),
  // and the chord-lerp from boundary verts to centroid is heavily biased
  // toward the boundary side after re-projection — interior subdivision
  // points cluster near the seam and adjacent radial slivers overshoot
  // into neighboring panels. With the centroid on the sphere, both
  // endpoints of the chord are unit-radius and the lerp traces a clean
  // great-circle arc.
  return naive.normalize().multiplyScalar(radius);
}

function addVertex(pool: Vector3[], v: Vector3): number {
  pool.push(v);
  return pool.length - 1;
}

/**
 * Is the panel star-shaped about `center` (as seen on the sphere)? True iff
 * the boundary's azimuth around the center direction winds monotonically —
 * fan lines from the center then stay inside the panel. Pinwheel-arm panels
 * reverse azimuth dozens of times and need real triangulation instead.
 */
function isStarShapedAbout(
  pool: Vector3[],
  loop: readonly number[],
  center: Vector3,
): boolean {
  const n = center.clone().normalize();
  if (n.lengthSq() === 0) return true; // degenerate center; fan fallback
  const helper =
    Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const e1 = helper.clone().sub(n.clone().multiplyScalar(helper.dot(n))).normalize();
  const e2 = n.clone().cross(e1);

  let windSign = 0;
  let prevAz: number | null = null;
  for (let i = 0; i <= loop.length; i++) {
    const v = pool[loop[i % loop.length]];
    const az = Math.atan2(v.dot(e2), v.dot(e1));
    if (prevAz !== null) {
      let delta = az - prevAz;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      const sign = Math.abs(delta) > 1e-12 ? Math.sign(delta) : 0;
      if (sign !== 0) {
        if (windSign === 0) windSign = sign;
        else if (sign !== windSign) return false;
      }
    }
    prevAz = az;
  }
  return true;
}

/**
 * Ear-clip a simple 2D polygon (indices into `pts`). Returns triangles as
 * index triples with the polygon's own winding. O(n²) — panels have at most
 * a few hundred corners.
 */
function earClip2D(
  pts: ReadonlyArray<{ x: number; y: number }>,
): [number, number, number][] {
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  let area = 0;
  let scale = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
    scale += Math.hypot(b.x - a.x, b.y - a.y);
  }
  // Cross-product epsilon proportional to the squared average edge length —
  // fixed epsilons misclassify the near-collinear corner runs of densely
  // sampled boundaries.
  const avgEdge = scale / pts.length;
  const eps = avgEdge * avgEdge * 1e-6;

  // Work CCW and EMIT CCW: the caller relies on counter-clockwise output
  // (in a right-handed tangent basis, planar CCW = outward-facing on the
  // sphere). Per-triangle 3D orientation checks are noise for sliver ears.
  const idx = [...Array(pts.length).keys()];
  if (area < 0) idx.reverse();

  const tris: [number, number, number][] = [];
  const emit = (a: number, b: number, c: number) => tris.push([a, b, c]);

  while (idx.length > 3) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ip = idx[(i - 1 + idx.length) % idx.length];
      const ic = idx[i];
      const inx = idx[(i + 1) % idx.length];
      const A = pts[ip];
      const B = pts[ic];
      const C = pts[inx];
      if (cross(A, B, C) < -eps) continue; // true reflex corner
      let contains = false;
      for (const j of idx) {
        if (j === ip || j === ic || j === inx) continue;
        const P = pts[j];
        // Only STRICTLY interior points block an ear — collinear boundary
        // neighbours sitting exactly on an ear edge are fine to clip past.
        if (
          cross(A, B, P) > eps &&
          cross(B, C, P) > eps &&
          cross(C, A, P) > eps
        ) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      emit(ip, ic, inx);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Numerical stalemate (nearly-collinear runs): clip the most convex
      // corner anyway rather than looping forever.
      let best = 0;
      let bestCross = -Infinity;
      for (let i = 0; i < idx.length; i++) {
        const c = cross(
          pts[idx[(i - 1 + idx.length) % idx.length]],
          pts[idx[i]],
          pts[idx[(i + 1) % idx.length]],
        );
        if (c > bestCross) {
          bestCross = c;
          best = i;
        }
      }
      emit(
        idx[(best - 1 + idx.length) % idx.length],
        idx[best],
        idx[(best + 1) % idx.length],
      );
      idx.splice(best, 1);
    }
  }
  emit(idx[0], idx[1], idx[2]);
  return tris;
}

/**
 * Subdivide a concave panel: project its corner loop onto a Lambert
 * azimuthal plane at the panel center, ear-clip the resulting simple
 * polygon, refine every ear as a barycentric grid IN THE PLANE, and map
 * grid points back to the sphere through the inverse projection.
 *
 * Refining in the plane matters: the ear partition is only guaranteed
 * non-overlapping in 2D, and Lambert is a bijection between the plane
 * and the sphere cap — so the mapped surface cannot fold. (Refining ears
 * with straight 3D lerps instead re-introduced overlaps, because an
 * ear's 2D-straight edge and the 3D great arc between the same corners
 * are different curves for large ears.)
 *
 * Panel-boundary edges are the one exception: their chains come from the
 * shared 3D `edgeVertexCache`, so they match neighbouring panels
 * vertex-for-vertex. Boundary corners are dense, so the (second-order)
 * difference between those arcs and the 2D-straight edges is far smaller
 * than a grid cell and cannot fold the first row.
 */
function subdivideConcavePanel({
  pool,
  loop,
  center,
  levels,
  edgeVertexCache,
  boundaryArcs,
  triangles,
}: {
  pool: Vector3[];
  loop: readonly number[];
  center: Vector3;
  levels: number;
  edgeVertexCache: Map<string, number>;
  boundaryArcs: Map<string, number[]>;
  triangles: [number, number, number][];
}): void {
  const sphereRadius = pool[loop[0]].length() || 1;

  // Subdivide + record all boundary edges first (shared with neighbours).
  for (let i = 0; i < loop.length; i++) {
    const aIdx = loop[i];
    const bIdx = loop[(i + 1) % loop.length];
    const chain = subdivideEdge(pool, edgeVertexCache, aIdx, bIdx, levels);
    const arcKey = `${Math.min(aIdx, bIdx)}-${Math.max(aIdx, bIdx)}`;
    if (!boundaryArcs.has(arcKey)) {
      boundaryArcs.set(
        arcKey,
        aIdx < bIdx ? [...chain] : [...chain].reverse(),
      );
    }
  }

  // Lambert azimuthal projection of the corner loop about the center.
  const n = center.clone().normalize();
  const helper =
    Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const e1 = helper.clone().sub(n.clone().multiplyScalar(helper.dot(n))).normalize();
  const e2 = n.clone().cross(e1);
  const pts = loop.map((vi) => {
    const u = pool[vi].clone().normalize();
    const cosD = Math.min(1, Math.max(-1, u.dot(n)));
    const az = u.clone().sub(n.clone().multiplyScalar(cosD));
    const azLen = az.length();
    const r = 2 * Math.sin(Math.acos(cosD) / 2);
    return {
      x: azLen > 1e-12 ? (r * az.dot(e1)) / azLen : 0,
      y: azLen > 1e-12 ? (r * az.dot(e2)) / azLen : 0,
    };
  });

  // Inverse Lambert: planar point → point on the sphere (at sphereRadius).
  const toSphere = (x: number, y: number): Vector3 => {
    const r = Math.hypot(x, y);
    if (r < 1e-12) return n.clone().multiplyScalar(sphereRadius);
    const d = 2 * Math.asin(Math.min(1, r / 2));
    return n
      .clone()
      .multiplyScalar(Math.cos(d))
      .addScaledVector(e1, (Math.sin(d) * x) / r)
      .addScaledVector(e2, (Math.sin(d) * y) / r)
      .multiplyScalar(sphereRadius);
  };

  const posOfGlobal = new Map<number, number>();
  loop.forEach((g, i) => posOfGlobal.set(g, i));

  // Chains for ear edges. Boundary edges (consecutive loop corners) reuse
  // the global 3D cache; internal ear edges are refined in the plane and
  // cached per panel so both flanking ears share identical vertices.
  const internalChains = new Map<string, number[]>();
  const chainFor = (posA: number, posB: number): number[] => {
    const gA = loop[posA];
    const gB = loop[posB];
    const nLoop = loop.length;
    const consecutive =
      posB === (posA + 1) % nLoop || posA === (posB + 1) % nLoop;
    if (consecutive) {
      return subdivideEdge(pool, edgeVertexCache, gA, gB, levels);
    }
    const lo = Math.min(gA, gB);
    const hi = Math.max(gA, gB);
    const key = `${lo}-${hi}`;
    let chain = internalChains.get(key);
    if (!chain) {
      const a2 = pts[posOfGlobal.get(lo)!];
      const b2 = pts[posOfGlobal.get(hi)!];
      chain = [lo];
      for (let s = 1; s <= levels; s++) {
        const t = s / (levels + 1);
        chain.push(
          addVertex(pool, toSphere(a2.x + (b2.x - a2.x) * t, a2.y + (b2.y - a2.y) * t)),
        );
      }
      chain.push(hi);
      internalChains.set(key, chain);
    }
    return gA === lo ? chain : [...chain].reverse();
  };

  for (const ear of earClip2D(pts)) {
    // earClip2D emits CCW in the plane; with the right-handed (e1, e2, n)
    // basis that is outward-facing on the sphere, so the grid winding below
    // is outward for every ear — including slivers, where a per-ear 3D
    // normal check would be numerical noise.
    const [pa, pb, pc] = ear;

    const L = levels + 1; // segments per edge
    const chainAB = chainFor(pa, pb);
    const chainAC = chainFor(pa, pc);
    const chainBC = chainFor(pb, pc);
    const A2 = pts[pa];
    const B2 = pts[pb];
    const C2 = pts[pc];

    // grid[r][s]: r rows toward C (row r has L - r + 1 points), s along A→B.
    const grid: number[][] = [];
    for (let r = 0; r <= L; r++) {
      const row: number[] = [];
      const width = L - r;
      for (let s = 0; s <= width; s++) {
        let idx: number;
        if (r === 0) idx = chainAB[s];
        else if (s === 0) idx = chainAC[r];
        else if (s === width) idx = chainBC[r];
        else {
          const wa = (L - r - s) / L;
          const wb = s / L;
          const wc = r / L;
          idx = addVertex(
            pool,
            toSphere(
              wa * A2.x + wb * B2.x + wc * C2.x,
              wa * A2.y + wb * B2.y + wc * C2.y,
            ),
          );
        }
        row.push(idx);
      }
      grid.push(row);
    }

    for (let r = 0; r < L; r++) {
      const upper = grid[r];
      const lower = grid[r + 1];
      for (let s = 0; s < lower.length; s++) {
        triangles.push([upper[s], upper[s + 1], lower[s]]);
        if (s < lower.length - 1) {
          triangles.push([upper[s + 1], lower[s + 1], lower[s]]);
        }
      }
    }
  }
}




function lerp3(a: Vector3, b: Vector3, t: number): Vector3 {
  return a.clone().lerp(b, t);
}

function subdivideEdge(
  pool: Vector3[],
  cache: Map<string, number>,
  aIdx: number,
  bIdx: number,
  levels: number,
): number[] {
  // Canonical key: smaller-index first.
  const lo = Math.min(aIdx, bIdx);
  const hi = Math.max(aIdx, bIdx);
  const forward = aIdx === lo;

  const out: number[] = [aIdx];
  for (let i = 1; i < levels + 1; i++) {
    const t = i / (levels + 1);
    const key = `${lo}-${hi}-${i}`;
    let idx = cache.get(key);
    if (idx === undefined) {
      const v = lerp3(pool[lo], pool[hi], t);
      idx = addVertex(pool, v);
      cache.set(key, idx);
    }
    out.push(idx);
  }
  out.push(bIdx);

  // If caller asked for a→b but cache stored lo→hi, the intermediate sequence
  // is the same set of vertices but consumed in reverse.
  if (!forward) {
    const first = out[0];
    const last = out[out.length - 1];
    const middle = out.slice(1, -1).reverse();
    return [first, ...middle, last];
  }
  return out;
}

/**
 * Triangle index list, attached non-enumerably-ish to the topology returned by
 * `subdivideTopology`. Re-exported as a helper so `buildMeshGroup` can read it
 * without a type cast at every call site.
 */
export function getPanelTriangles(
  topo: PanelTopology,
): Map<string, [number, number, number][]> | undefined {
  return (topo as PanelTopology & {
    _triangles?: Map<string, [number, number, number][]>;
  })._triangles;
}

/**
 * Per-original-edge ordered vertex chains (post-subdivision). Keys are the
 * canonical `${min}-${max}` of the two ORIGINAL corner-vertex indices; values
 * walk from lo to hi inclusive. Used by `buildMeshGroup` to draw panel
 * boundaries without picking up the within-panel triangle grid.
 */
export function getBoundaryArcs(
  topo: PanelTopology,
): Map<string, number[]> | undefined {
  return (topo as PanelTopology & {
    _boundaryArcs?: Map<string, number[]>;
  })._boundaryArcs;
}

/**
 * Inflate panel interiors outward to create a beveled-edge puff.
 * Vertices ramp up over a bevel zone next to the panel boundary, then
 * plateau at full puff height across the interior.
 *
 * The bevel is driven by each vertex's TRUE angular distance to its
 * panel's (subdivided) boundary, with the bevel width scaled to
 * `bevelWidth` × the panel's inradius (the deepest interior distance).
 * The earlier fraction-of-fan-line depth broke on large wavy panels: a
 * fan line from the centroid can pass right next to a boundary segment
 * it doesn't terminate on, so fully-puffed vertices landed within a
 * degree of the seam and the seams read as knife-slit trenches (visible
 * as a distorted silhouette on the high-amplitude Baseball).
 *
 * Must be called AFTER `projectToSphere` so vertices are already on
 * the sphere. Mutates the topology in place.
 */
/** Widest the puff's edge bevel gets, regardless of panel size (radians). */
const MAX_BEVEL_ANGLE = 0.12; // ≈ 6.9°

export function puffPanels(
  topo: PanelTopology,
  radius: number,
  puff: number,
  bevelWidth = 0.25,
): PanelTopology {
  if (puff === 0) return topo;
  const triLists = getPanelTriangles(topo);
  const arcs = getBoundaryArcs(topo);
  if (!triLists || !arcs) return topo;

  // Flat unit-vector array for tight inner loops.
  const count = topo.vertices.length;
  const ux = new Float64Array(count);
  const uy = new Float64Array(count);
  const uz = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const v = topo.vertices[i];
    const len = v.length() || 1;
    ux[i] = v.x / len;
    uy[i] = v.y / len;
    uz[i] = v.z / len;
  }

  // Panel id → subdivided boundary vertex indices (all its edges' chains).
  const boundaryOf = new Map<string, number[]>();
  for (const edge of topo.edges) {
    const lo = Math.min(edge.vertexA, edge.vertexB);
    const hi = Math.max(edge.vertexA, edge.vertexB);
    const chain = arcs.get(`${lo}-${hi}`) ?? [lo, hi];
    for (const pid of [edge.panelA, edge.panelB]) {
      if (!pid) continue;
      let list = boundaryOf.get(pid);
      if (!list) {
        list = [];
        boundaryOf.set(pid, list);
      }
      list.push(...chain);
    }
  }

  for (const panel of topo.panels) {
    const triangles = triLists.get(panel.id);
    const boundary = boundaryOf.get(panel.id);
    if (!triangles || !boundary || boundary.length === 0) continue;

    const members = new Set<number>();
    for (const tri of triangles) {
      members.add(tri[0]);
      members.add(tri[1]);
      members.add(tri[2]);
    }

    // Max cosine to any boundary vertex = min angular distance.
    const bn = boundary.length;
    const bx = new Float64Array(bn);
    const by = new Float64Array(bn);
    const bz = new Float64Array(bn);
    for (let j = 0; j < bn; j++) {
      const idx = boundary[j];
      bx[j] = ux[idx];
      by[j] = uy[idx];
      bz[j] = uz[idx];
    }

    const memberList = [...members];
    const dists = new Float64Array(memberList.length);
    let maxDist = 0;
    for (let m = 0; m < memberList.length; m++) {
      const vi = memberList[m];
      const x = ux[vi];
      const y = uy[vi];
      const z = uz[vi];
      let best = -1;
      for (let j = 0; j < bn; j++) {
        const d = x * bx[j] + y * by[j] + z * bz[j];
        if (d > best) best = d;
      }
      const dist = Math.acos(Math.min(1, Math.max(-1, best)));
      dists[m] = dist;
      if (dist > maxDist) maxDist = dist;
    }

    if (maxDist <= 0) continue;
    // Cap the bevel at an absolute angular width. Proportional-only sizing
    // breaks on giant panels (the Baseball covers half the sphere): 25% of
    // its inradius is a ~15° soft shoulder, which turns the ball into
    // pillowy lobe domes instead of a sphere with stitched grooves. With
    // the cap, everything beyond the groove sits at uniform full puff.
    const bevelAngle = Math.min(bevelWidth * maxDist, MAX_BEVEL_ANGLE);
    for (let m = 0; m < memberList.length; m++) {
      const dist = dists[m];
      if (dist <= 0) continue;
      // Ramp from 0→1 within the bevel zone, then flat at 1 for the interior
      const t = Math.min(dist / bevelAngle, 1);
      const s = 1 - (1 - t) * (1 - t); // convex quarter-circle profile
      topo.vertices[memberList[m]].setLength(radius * (1 + puff * s));
    }
  }
  return topo;
}
