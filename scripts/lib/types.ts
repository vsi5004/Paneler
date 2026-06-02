/**
 * Shared types for the ball-topology importer pipeline.
 *
 * Kept separate from `lib/types.ts` because these are extractor-internal
 * representations (pre-PanelTopology), not part of the runtime contract.
 */

/** A welded vertex pool — flat XYZ array, indices into it for everything else. */
export interface WeldedMesh {
  /** Flat XYZ: `positions[i*3 + 0..2]` is the i-th vertex. */
  positions: Float32Array;
  /** Triangle indices into `positions` (each tri is 3 consecutive entries). */
  triangles: Uint32Array;
  /** Per-original-vertex map back to the welded index. */
  weldOf: Int32Array;
  /** Optional UV coords on the ORIGINAL (unwelded) vertex pool. */
  uvs?: Float32Array;
  /** Per-original-vertex normals on the ORIGINAL (unwelded) pool. May be computed. */
  normals?: Float32Array;
  /** Source mesh stats for the verification report. */
  source: {
    /** Pre-weld vertex count. */
    rawVertices: number;
    /** Post-weld vertex count. */
    weldedVertices: number;
    /** Triangle count. */
    triangles: number;
    /** Whether the original mesh provided UVs. */
    hasUvs: boolean;
    /** Whether the original mesh provided normals (otherwise we computed them). */
    hadNormals: boolean;
  };
}

/** Seam edge between two welded vertices. Order is canonical (lo < hi). */
export type SeamEdge = readonly [number, number];

/** Ordered list of welded-vertex indices along a curve between two junctions. */
export interface CurveSegment {
  /** Junction at the start of the path. */
  a: number;
  /** Junction at the end of the path. */
  b: number;
  /** Vertex chain from `a` to `b` inclusive (degree-2 verts in between). */
  path: number[];
}

/** Extraction mode tag — also used in the verification report. */
export type ExtractionMode = "uv-seams" | "hard-edges" | "primitives";

/** Output of seam detection — input to face enumeration. */
export interface SeamGraph {
  /** All detected seam edges (canonical lo-hi pairs). */
  edges: SeamEdge[];
  /** Vertices that lie on any seam edge. */
  vertices: Set<number>;
  /** Vertex-to-neighbor adjacency along seam edges. */
  adjacency: Map<number, Set<number>>;
  /** Junction vertices (degree ≥ 3). */
  junctions: Set<number>;
}

/** A panel boundary as a single closed loop of welded-vertex indices. */
export type PanelLoop = number[];

/** Configuration for the full importer pipeline. */
export interface ImportOptions {
  glbPath: string;
  slug: string;
  label: string;
  mode: "auto" | ExtractionMode;
  rdpToleranceDegrees: number;
  hardEdgeThresholdDegrees: number;
  weldEpsilon: number;
  noPreview: boolean;
  overrideJunctions?: Array<[number, number, number]>;
}
