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
// Design state types
//
// Geometry + per-panel colors live in the GLB blob (in R2 in kube mode, on the
// user's disk in GH Pages mode). This type is metadata only — the queryable
// fields that mirror what the GLB contains, plus the bookkeeping the designs
// nav needs (name, starred, timestamps).
// -----------------------------------------------------------------------------

/**
 * Live-in-React-state mirror of each panel's material color, keyed by panel
 * id (`panel_NNN_<shape>`). Kept in parallel with the gltf-transform Document's
 * baseColorFactor entries so the canvas re-renders without re-parsing the GLB
 * on every paint stroke.
 */
export type PanelColors = Record<string, string>;

/**
 * Per-design metadata stored in Postgres. The GLB bytes themselves live in R2
 * at `designs/{id}.glb`. The mirror fields (panel_count, shape_signature,
 * palette_hash, glb_etag, glb_size_bytes, thumbnail_key) are recomputed
 * client-side after every save.
 */
export interface DesignMeta {
  id: string;
  name: string;
  glb_key: string;
  glb_etag: string | null;
  glb_size_bytes: number | null;
  thumbnail_key: string | null;
  panel_count: number | null;
  shape_signature: string | null;
  palette_hash: string | null;
  source: string | null;
  template_slug: string | null;
  starred: boolean;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaletteEntry {
  id: string;
  label: string;
  color: string;
}
