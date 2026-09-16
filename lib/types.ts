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

/**
 * NOTE: the shape suffix is cosmetic/grouping only — never rebuild a panel's
 * id from its current `shape`. Parameterized presets (see truncationFamily.ts)
 * freeze ids to the default shape so painted colors survive shape-parameter
 * changes even when a panel's true shape morphs (e.g. triangle → hexagon).
 */
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
  /** Customer's fill style; set by the order form, null otherwise. */
  fill: string | null;
  /**
   * Customer's special requests; set by the order form, null otherwise.
   *
   * There is no `size` beside this on purpose — the finished diameter lives in
   * the GLB as `LaserSettings.diameterIn`, where it drives the laser template
   * scale. A copy here would be free to disagree with the file.
   */
  note: string | null;
  /**
   * On a normal design, the owner's own address. On an order, the CUSTOMER's —
   * which is how the stitcher gets back to them.
   */
  email: string | null;
  starred: boolean;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaletteEntry {
  id: string;
  label: string;
  color: string;
  /**
   * Product line, e.g. "Ultrasuede LX". Catalog colours are named bare ("Red",
   * "Sand") because the designer already groups them under a heading — but an
   * order email has no heading, and "32 x Red" does not tell a stitcher which
   * bolt to reach for.
   */
  line?: string;
  /** Optional fabric-photo thumbnail shown as the swatch background. */
  swatch?: string;
  /**
   * Full-resolution (800px) fabric photo, where one exists. Used by the
   * profile page's fabric shelf, which renders swatches large enough that the
   * Ultrasuede pile is visible and the 64px thumb would go soft.
   */
  swatchLarge?: string;
}

// -----------------------------------------------------------------------------
// Per-user settings (the `users` table)
// -----------------------------------------------------------------------------

/**
 * One fabric in a user's stocked list, as stored in `users.fabrics`.
 *
 * Catalog entries store only a reference, so corrections to a catalog color
 * (as happened with Forest Green) propagate to everyone holding it. Custom
 * entries carry their own values because there's nothing to point at.
 */
export type FabricEntry =
  | { kind: "catalog"; id: string }
  | { kind: "custom"; id: string; label: string; color: string };

/**
 * What the profile endpoints return. Deliberately carries key *metadata* only
 * — never `api_key_hash` or `prev_key_hash`.
 */
export interface ProfileData {
  fabrics: FabricEntry[];
  /** Fill materials the stitcher stocks. Shown as a note on the order form. */
  fillMaterials: string[];
  /** Null until the stitcher first publishes; then stable forever. */
  shopId: string | null;
  displayName: string | null;
  hasAvatar: boolean;
  shopPublished: boolean;
  /** Granted by hand as the DB owner; gates the whole API-key feature. */
  apiKeyEnabled: boolean;
  hasApiKey: boolean;
  apiKeyCreatedAt: string | null;
  apiKeyLastUsed: string | null;
}

// -----------------------------------------------------------------------------
// Shops and order forms
// -----------------------------------------------------------------------------

/** One thing a stitcher will make, pinned to one of their designs. */
export interface OrderItem {
  id: string;
  design_id: string;
  title: string;
  description: string | null;
  /** Finished diameters offered, inches. A subset of ORDER_SIZES. */
  sizes: number[];
  position: number;
  published: boolean;
}

/** A stitcher's shop as the public pages see it. No private columns, ever. */
export interface PublicShop {
  shopId: string;
  displayName: string;
  hasAvatar: boolean;
  fillMaterials: string[];
  /** Resolved from the stitcher's stocked fabrics; the customer's whole palette. */
  fabrics: PaletteEntry[];
  items: OrderItem[];
}

/** What a customer submits. `size` becomes diameterIn inside the GLB. */
export interface OrderSubmission {
  itemId: string;
  size: number;
  fill: string;
  note: string;
}
