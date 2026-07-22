import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";

// Longest allowed boundary edge, in radians. Import-time RDP downsampling
// keeps very few corners on straight-ish runs (edges up to ~25° survive),
// but the concave-panel mesher needs corners dense enough that a great arc
// between neighbours stays close to the straight chord — long edges folded
// the first grid rows inside-out and opened black gashes along the seams.
const MAX_EDGE_ANGLE = (3 * Math.PI) / 180;

/**
 * Build a PanelTopology from an imported ball's raw vertex + face-loop data
 * (the output of scripts/import-ball-topology.ts). Handles the three steps
 * every imported ball needs:
 *
 *  1. Normalize vertices onto the sphere of the requested radius.
 *  2. Re-densify long boundary edges with great-arc midpoints, cached per
 *     edge so both adjacent panels share the inserted vertices and the
 *     topology stays watertight.
 *  3. Build panels (ids frozen to import order) and the shared edge list.
 */
export function importedBallTopology(
  rawVertices: ReadonlyArray<readonly [number, number, number]>,
  faces: ReadonlyArray<ReadonlyArray<number>>,
  radius = 1,
): PanelTopology {
  const vertices = rawVertices.map(([x, y, z]) => {
    const v = new Vector3(x, y, z);
    v.setLength(radius);
    return v;
  });

  const insertedCache = new Map<string, number[]>();
  const densify = (loop: readonly number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      out.push(a);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}-${hi}`;
      let inserted = insertedCache.get(key);
      if (!inserted) {
        inserted = [];
        const va = vertices[lo];
        const vb = vertices[hi];
        const angle = va.angleTo(vb);
        const extra = Math.max(0, Math.ceil(angle / MAX_EDGE_ANGLE) - 1);
        for (let s = 1; s <= extra; s++) {
          const v = va
            .clone()
            .lerp(vb, s / (extra + 1))
            .setLength(radius);
          inserted.push(vertices.push(v) - 1);
        }
        insertedCache.set(key, inserted);
      }
      out.push(...(a === lo ? inserted : [...inserted].reverse()));
    }
    return out;
  };

  const panels = faces.map((vertexIndices, idx) => {
    const shape = shapeForVertexCount(vertexIndices.length);
    return {
      id: panelId(idx, shape),
      vertexIndices: densify(vertexIndices),
      shape,
    };
  });

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

  return { vertices, panels, edges: [...edgeMap.values()] };
}
