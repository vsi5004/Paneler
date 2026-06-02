import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";
import { goldberg11, goldbergClassI } from "./goldberg";
import { baseball } from "./baseball";
import { trionda } from "./trionda";

/**
 * Build a PanelTopology from raw vertex coordinates and face index loops.
 * Vertices are normalized onto a sphere of the given radius (default 1) so
 * the rest of the pipeline can rely on `|v| === radius` for every vertex.
 */
function topologyFromFaces(
  rawVertices: ReadonlyArray<readonly [number, number, number]>,
  faces: ReadonlyArray<ReadonlyArray<number>>,
  radius = 1,
): PanelTopology {
  const vertices = rawVertices.map(([x, y, z]) => {
    const v = new Vector3(x, y, z);
    v.setLength(radius);
    return v;
  });

  const panels = faces.map((vertexIndices, idx) => {
    const shape = shapeForVertexCount(vertexIndices.length);
    return {
      id: panelId(idx, shape),
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

// -----------------------------------------------------------------------------
// Presets
// -----------------------------------------------------------------------------

export function tetrahedron(radius = 1): PanelTopology {
  // 4 vertices, 4 triangular faces. Standard orientation.
  return topologyFromFaces(
    [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ],
    [
      [0, 1, 2],
      [0, 3, 1],
      [0, 2, 3],
      [1, 3, 2],
    ],
    radius,
  );
}

export function cube(radius = 1): PanelTopology {
  // 8 vertices, 6 square faces. Each face listed CCW from outside.
  return topologyFromFaces(
    [
      [-1, -1, -1], // 0
      [1, -1, -1], // 1
      [1, 1, -1], // 2
      [-1, 1, -1], // 3
      [-1, -1, 1], // 4
      [1, -1, 1], // 5
      [1, 1, 1], // 6
      [-1, 1, 1], // 7
    ],
    [
      [0, 3, 2, 1], // -Z
      [4, 5, 6, 7], // +Z
      [0, 1, 5, 4], // -Y
      [2, 3, 7, 6], // +Y
      [1, 2, 6, 5], // +X
      [0, 4, 7, 3], // -X
    ],
    radius,
  );
}

export function octahedron(radius = 1): PanelTopology {
  // 6 vertices, 8 triangular faces (the cube's dual).
  return topologyFromFaces(
    [
      [1, 0, 0], // 0  +X
      [-1, 0, 0], // 1  -X
      [0, 1, 0], // 2  +Y
      [0, -1, 0], // 3  -Y
      [0, 0, 1], // 4  +Z
      [0, 0, -1], // 5  -Z
    ],
    [
      [0, 2, 4],
      [2, 1, 4],
      [1, 3, 4],
      [3, 0, 4],
      [2, 0, 5],
      [1, 2, 5],
      [3, 1, 5],
      [0, 3, 5],
    ],
    radius,
  );
}

export function cuboctahedron(radius = 1): PanelTopology {
  // 12 vertices at midpoints of cube edges, 8 triangle + 6 square faces (14 total).
  return topologyFromFaces(
    [
      [1, 1, 0], // 0
      [1, -1, 0], // 1
      [-1, -1, 0], // 2
      [-1, 1, 0], // 3
      [1, 0, 1], // 4
      [1, 0, -1], // 5
      [-1, 0, -1], // 6
      [-1, 0, 1], // 7
      [0, 1, 1], // 8
      [0, 1, -1], // 9
      [0, -1, -1], // 10
      [0, -1, 1], // 11
    ],
    [
      // 8 triangles (one per cube corner)
      [0, 8, 4],
      [0, 5, 9],
      [1, 4, 11],
      [1, 10, 5],
      [2, 11, 7],
      [2, 6, 10],
      [3, 7, 8],
      [3, 9, 6],
      // 6 squares (one per cube face)
      [0, 4, 1, 5],
      [2, 7, 3, 6],
      [0, 9, 3, 8],
      [1, 11, 2, 10],
      [4, 8, 7, 11],
      [5, 10, 6, 9],
    ],
    radius,
  );
}

export function icosahedron(radius = 1): PanelTopology {
  // 12 vertices using the golden ratio, 20 triangular faces.
  const phi = (1 + Math.sqrt(5)) / 2;
  return topologyFromFaces(
    [
      [-1, phi, 0], // 0
      [1, phi, 0], // 1
      [-1, -phi, 0], // 2
      [1, -phi, 0], // 3
      [0, -1, phi], // 4
      [0, 1, phi], // 5
      [0, -1, -phi], // 6
      [0, 1, -phi], // 7
      [phi, 0, -1], // 8
      [phi, 0, 1], // 9
      [-phi, 0, -1], // 10
      [-phi, 0, 1], // 11
    ],
    [
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
    ],
    radius,
  );
}

export function dodecahedron(radius = 1): PanelTopology {
  // 20 vertices, 12 pentagonal faces. Built as the dual of the icosahedron's
  // face centroids would also work, but explicit construction is simpler here.
  // Vertices grouped into three rectangles plus golden-ratio scaled cube vertices.
  const phi = (1 + Math.sqrt(5)) / 2;
  const invPhi = 1 / phi;
  return topologyFromFaces(
    [
      // Cube vertices (8)
      [1, 1, 1], // 0
      [1, 1, -1], // 1
      [1, -1, 1], // 2
      [1, -1, -1], // 3
      [-1, 1, 1], // 4
      [-1, 1, -1], // 5
      [-1, -1, 1], // 6
      [-1, -1, -1], // 7
      // Rectangle in YZ plane (4)
      [0, invPhi, phi], // 8
      [0, invPhi, -phi], // 9
      [0, -invPhi, phi], // 10
      [0, -invPhi, -phi], // 11
      // Rectangle in XZ plane (4)
      [invPhi, phi, 0], // 12
      [invPhi, -phi, 0], // 13
      [-invPhi, phi, 0], // 14
      [-invPhi, -phi, 0], // 15
      // Rectangle in XY plane (4)
      [phi, 0, invPhi], // 16
      [phi, 0, -invPhi], // 17
      [-phi, 0, invPhi], // 18
      [-phi, 0, -invPhi], // 19
    ],
    [
      [0, 8, 10, 2, 16],
      [0, 16, 17, 1, 12],
      [12, 1, 9, 5, 14],
      [4, 14, 5, 19, 18],
      [4, 18, 6, 10, 8],
      [0, 12, 14, 4, 8],
      [2, 10, 6, 15, 13],
      [2, 13, 3, 17, 16],
      [3, 13, 15, 7, 11],
      [3, 11, 9, 1, 17],
      [5, 9, 11, 7, 19],
      [6, 18, 19, 7, 15],
    ],
    radius,
  );
}

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

export interface PresetEntry {
  id: string;
  label: string;
  panels: number;
  topology: (radius?: number) => PanelTopology;
}

export const PRESETS: PresetEntry[] = [
  { id: "baseball", label: "Baseball", panels: 2, topology: baseball },
  { id: "trionda", label: "Trionda 2026", panels: 4, topology: trionda },
  { id: "tetra", label: "Tetrahedron", panels: 4, topology: tetrahedron },
  { id: "cube", label: "Cube", panels: 6, topology: cube },
  { id: "octa", label: "Octahedron", panels: 8, topology: octahedron },
  { id: "dodeca", label: "Dodecahedron", panels: 12, topology: dodecahedron },
  { id: "cubocta", label: "Cuboctahedron", panels: 14, topology: cuboctahedron },
  { id: "icosa", label: "Icosahedron", panels: 20, topology: icosahedron },
  { id: "soccer", label: "Soccer Ball", panels: 32, topology: goldberg11 },
  { id: "gp2", label: "GP(2,0)", panels: 42, topology: (r?: number) => goldbergClassI(2, r) },
  { id: "gp3", label: "GP(3,0)", panels: 92, topology: (r?: number) => goldbergClassI(3, r) },
  { id: "gp4", label: "GP(4,0)", panels: 162, topology: (r?: number) => goldbergClassI(4, r) },
];
