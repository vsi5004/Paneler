import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";
import { TRIONDA_VERTICES, TRIONDA_FACES } from "./trionda-data";

/**
 * Trionda 2026 — imported via scripts/import-ball-topology.ts.
 *
 * Boundary curves extracted from the source GLB and downsampled with
 * spherical RDP. Each panel is a closed loop of welded-vertex indices.
 */
export function trionda(radius = 1): PanelTopology {
  const vertices = TRIONDA_VERTICES.map(([x, y, z]) => {
    const v = new Vector3(x, y, z);
    v.setLength(radius);
    return v;
  });

  const panels = TRIONDA_FACES.map((vertexIndices, idx) => {
    const shape = shapeForVertexCount(vertexIndices.length);
    return {
      id: panelId(idx, shape),
      vertexIndices: [...vertexIndices],
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
