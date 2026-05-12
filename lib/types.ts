import type { Vector3 } from "three";

export type PanelShape =
  | "triangle"
  | "quad"
  | "pentagon"
  | "hexagon"
  | "polygon";

export interface Panel {
  /** Stable ID across the lifetime of the topology, e.g. "panel_001_pentagon". */
  id: string;
  /** Ordered loop of indices into PanelTopology.vertices, defining the panel boundary. */
  vertexIndices: number[];
  shape: PanelShape;
}

export interface PanelEdge {
  vertexA: number;
  vertexB: number;
  panelA: string;
  panelB: string | null;
}

export interface PanelTopology {
  vertices: Vector3[];
  panels: Panel[];
  edges: PanelEdge[];
}

export function shapeForVertexCount(n: number): PanelShape {
  if (n === 3) return "triangle";
  if (n === 4) return "quad";
  if (n === 5) return "pentagon";
  if (n === 6) return "hexagon";
  return "polygon";
}

export function panelId(index: number, shape: PanelShape): string {
  return `panel_${String(index + 1).padStart(3, "0")}_${shape}`;
}

// -----------------------------------------------------------------------------
// Design state types (ported from Footbag-3D-Visualizer)
// -----------------------------------------------------------------------------

export type PanelColors = Record<string, string>;

export interface Design {
  /** Schema version. Bump for breaking changes to encoded designs. */
  version: 1;
  modelType: string;
  panelColors: PanelColors;
}

export interface PaletteEntry {
  id: string;
  label: string;
  color: string;
}
