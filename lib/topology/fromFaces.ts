import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelShape,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";

/**
 * Build a PanelTopology from raw vertex coordinates and face index loops.
 * Vertices are normalized onto a sphere of the given radius (default 1) so
 * the rest of the pipeline can rely on `|v| === radius` for every vertex.
 *
 * `idFor` overrides the default `panelId(idx, shape)` naming. Parameterized
 * generators use it to freeze panel ids to the default-shape names so a panel
 * keeps the same id (and therefore its painted color) while a shape parameter
 * morphs it, e.g. a degenerate hexagon staying `panel_001_triangle`.
 */
export function topologyFromFaces(
  rawVertices: ReadonlyArray<readonly [number, number, number]>,
  faces: ReadonlyArray<ReadonlyArray<number>>,
  radius = 1,
  idFor?: (index: number, shape: PanelShape) => string,
): PanelTopology {
  const vertices = rawVertices.map(([x, y, z]) => {
    const v = new Vector3(x, y, z);
    v.setLength(radius);
    return v;
  });

  const panels = faces.map((vertexIndices, idx) => {
    const shape = shapeForVertexCount(vertexIndices.length);
    return {
      id: idFor ? idFor(idx, shape) : panelId(idx, shape),
      vertexIndices: [...vertexIndices],
      shape,
    };
  });

  // Build edges by walking each panel's boundary. Each undirected edge appears
  // in at most two panels; we record both sides.
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
