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

  // Cache vertices that live on a panel boundary edge — keyed by the canonical
  // edge (min,max) plus a step index along the edge. Adjacent panels share the
  // same boundary and must therefore share interior-edge vertex indices.
  const edgeVertexCache = new Map<string, number>();

  // Each "subdivided panel" needs a list of triangles (vertex-index triples)
  // for the eventual mesh build. We store those alongside the original panel
  // metadata. Boundary vertices stay in panel.vertexIndices (so panel boundary
  // loops are preserved for adjacent-panel edges and the future SVG unfold).
  const panelTriangles = new Map<string, [number, number, number][]>();

  for (const panel of topo.panels) {
    const triangles: [number, number, number][] = [];

    // Fan-triangulate from the panel centroid: each (corner_i, corner_i+1)
    // edge becomes a parent triangle (centroid, corner_i, corner_i+1).
    const centroidIdx = addVertex(
      newVertices,
      computeCentroid(topo.vertices, panel.vertexIndices),
    );

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
            rowVerts.push(addVertex(newVertices, interior));
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

  const result: PanelTopology & { _triangles?: Map<string, [number, number, number][]> } = {
    vertices: newVertices,
    panels: newPanels,
    edges: topo.edges.map((e) => ({ ...e })),
  };

  // Attach the triangle index lists. `buildMeshGroup` reads this.
  result._triangles = panelTriangles;
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
  const c = new Vector3();
  for (const idx of indices) c.add(vertices[idx]);
  c.divideScalar(indices.length);
  return c;
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
