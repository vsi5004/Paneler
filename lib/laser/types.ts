import type { Panel } from "@/lib/types";
import type { Vec2 } from "@/lib/flatten/types";

/** User-adjustable laser settings; everything else is in constants.ts. */
export interface LaserSettings {
  /** Finished footbag diameter, inches. */
  diameterIn: number;
  /** Distance from the cut edge to the stitch line, millimeters. */
  biteDepthMm: number;
  /** Edge curvature, percent of the true spherical bulge (100 = spherical). */
  curvaturePct: number;
  /**
   * Per-panel-type curvature overrides, keyed by the type's label
   * ("Hexagon A", "Pentagon"); types without an entry use `curvaturePct`.
   */
  curvatureByType: Record<string, number>;
  /** Include stitch holes in previews and exported SVGs. */
  showHoles: boolean;
  /** Nominal hole-to-hole pitch along a seam, millimeters. */
  holeSpacingMm: number;
  /** Empty space between each hole row's ends and the panel corners, mm. */
  cornerMarginMm: number;

  /**
   * Extra fabric beyond the cut line along UNSTITCHED short edges,
   * millimeters (0 = off). Widens the strip behind the corner stitch so
   * it can't pull out; ignored when short-edge holes are on (nothing is
   * unstitched then).
   */
  shortEdgeExtensionMm: number;
  /**
   * Hole short seam runs too (runs under 55% of the panel's longest).
   * Off = the proven 32/14-panel convention (soccer hex short edges are
   * unstitched); on = every run holed (Teamgeist-style balls whose short
   * runs are real stitched seams).
   */
  shortEdgeHoles: boolean;
  /** Replace rounded arc joins at convex cut-outline corners with straight bevels. */
  sharpCorners: boolean;
  /**
   * Holes on each circle-facing hex edge, for templates whose hole counts
   * are set directly (the 32-panel circle soccers): even, at least 4. The
   * circle's side of the seam gets this minus the 2 corner extras.
   * Ignored by templates that place holes by `holeSpacingMm`.
   */
  hexEdgeHoles: number;
  /**
   * Cut the edge-marker hole on templates whose hole convention marks a
   * side (HoleCountConvention.markEdge — the 92-panel small hex).
   */
  edgeMarker: boolean;
}

/** A group of congruent panels that share one template. */
export interface PanelClass {
  key: string;
  /** Display label, e.g. "Pentagon", "Hexagon A", "Panel". */
  label: string;
  cornerCount: number;
  /** All panels in this class; badge count = length. */
  panelIds: string[];
  /** The panel whose geometry builds the template. */
  representative: Panel;
}

/** A ready-to-render/export template. All coordinates in millimeters. */
export interface LaserTemplate {
  classKey: string;
  label: string;
  /** How many of this panel the design needs. */
  count: number;
  /** Seam-line outline (stitch line) as an SVG path. */
  seamPath: string;
  /** Cut outline (seam offset outward by bite depth) as an SVG path. */
  cutPath: string;
  /** Stitch hole centers, on the seam line. */
  holes: Vec2[];
  /**
   * Extra holes marking a side (e.g. the 92-panel small hex's shorter
   * pentagon side), in the seam allowance near the cut edge. Cut with the
   * stitch holes; not stitch holes themselves.
   */
  markerHoles: Vec2[];
  /**
   * Holes per seam run (boundary order) as a maker counts them along one
   * edge: pattern holes plus both endpoint corner anchors / extras.
   * 0 = deliberately unstitched short edge.
   */
  edgeHoles: number[];
  /**
   * Each seam run's length along the seam (stitch) line — stitched runs as
   * cut (corner extensions included), unstitched short runs as on the ball
   * — with a point just outside the cut line for its label. Preview only;
   * not exported.
   */
  edgeLengths: { lengthMm: number; labelAt: Vec2 }[];
  /** Bounding box including margin. */
  bounds: { minX: number; minY: number; width: number; height: number };
}
