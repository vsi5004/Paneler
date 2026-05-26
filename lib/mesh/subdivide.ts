import { Vector3 } from "three";
import {
  type Panel,
  type PanelEdge,
  type PanelTopology,
  shapeForVertexCount,
} from "@/lib/types";

/**
 * Subdivide each panel face by:
 *   1. Fan-triangulating from the panel centroid.
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

    // Fan-triangulate from the panel centroid: each (corner_i, corner_i+1)
    // edge becomes a parent triangle (centroid, corner_i, corner_i+1).
    const centroidIdx = addVertex(
      newVertices,
      computeCentroid(topo.vertices, panel.vertexIndices),
    );
    vertexDepth.set(centroidIdx, 1);

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
          const along = segCount === 1 ? 0.5 : s / (segCount - 1);
          const edgePoint = lerp3(
            newVertices[aIdx],
            newVertices[bIdx],
            along,
          );
          const interior = lerp3(edgePoint, newVertices[centroidIdx], t);
          if (row === levels) {
            rowVerts.push(centroidIdx);
          } else {
            const idx = addVertex(newVertices, interior);
            vertexDepth.set(idx, t);
            rowVerts.push(idx);
          }
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

function computeCentroid(vertices: Vector3[], indices: readonly number[]): Vector3 {
  // Arithmetic average works for convex panels on the sphere (Goldberg /
  // Platonic faces): the average vector points well inside the panel and has
  // a magnitude close to the sphere radius.
  const naive = new Vector3();
  for (const idx of indices) naive.add(vertices[idx]);
  naive.divideScalar(indices.length);

  // For non-convex or great-circle-ish boundaries (e.g. the Baseball
  // template's wavy seam, whose ±latitude swings cancel out), the arithmetic
  // average collapses toward the sphere center. Fan-triangulation from
  // origin spikes every parent triangle through the ball's interior and
  // projectToSphere refuses to normalize the zero-length vertex, so the
  // panel renders as garbage. Fall back to the signed-area vector
  // (Σ vᵢ × vᵢ₊₁), which always points to the panel's interior hemisphere
  // regardless of boundary shape — for a CCW-from-outside boundary it's the
  // outward face normal at the panel center.
  if (naive.lengthSq() < 0.04) {
    const radius = vertices[indices[0]].length() || 1;
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
  return naive;
}

function addVertex(pool: Vector3[], v: Vector3): number {
  pool.push(v);
  return pool.length - 1;
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
 * Vertices near the panel boundary ramp up steeply over the
 * `bevelWidth` zone (0–1 fraction of the boundary-to-centroid depth),
 * then plateau at full puff height across the interior.
 *
 * Must be called AFTER `projectToSphere` so vertices are already on
 * the sphere. Mutates the topology in place.
 */
export function puffPanels(
  topo: PanelTopology,
  radius: number,
  puff: number,
  bevelWidth = 0.25,
): PanelTopology {
  const depthMap = (topo as PanelTopology & {
    _vertexDepth?: Map<number, number>;
  })._vertexDepth;
  if (!depthMap || puff === 0) return topo;

  for (let i = 0; i < topo.vertices.length; i++) {
    const depth = depthMap.get(i) ?? 0;
    if (depth <= 0) continue;
    // Ramp from 0→1 within the bevel zone, then flat at 1 for the interior
    const t = Math.min(depth / bevelWidth, 1);
    const s = 1 - (1 - t) * (1 - t); // convex quarter-circle profile
    topo.vertices[i].setLength(radius * (1 + puff * s));
  }
  return topo;
}
