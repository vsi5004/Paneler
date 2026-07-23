/**
 * Hard-coded laser-template parameters. Values are the user's proven
 * production settings (footbag-templates repo / Footbag-Panel-Generator
 * settings), deliberately not exposed in the UI — only footbag size and
 * bite depth are user-adjustable.
 */

import { SPHERE_RADIUS } from "@/lib/glb/generate";

/** Diameter of each laser-cut stitch hole. */
export const STITCH_HOLE_DIAMETER_MM = 0.2;
/** Nominal hole-to-hole pitch along a seam. */
export const HOLE_SPACING_MM = 2.5;
/**
 * Pair bunching: gap within a hole pair is spacing − bunching (2.1mm),
 * gap between pairs is spacing + bunching (2.9mm). The alternating
 * pattern is reversal-symmetric for even hole counts, which makes the
 * holes on both sides of a shared seam line up.
 */
export const HOLE_BUNCHING_MM = 0.4;
/** Distance of the first/last hole from a panel corner. */
export const CORNER_MARGIN_MM = 0;
/**
 * Seam runs shorter than this fraction of the panel's longest run get no
 * stitch holes — the truncation families' hex-hex "short edges" (proven
 * physical templates use short/long ratios of 0.25–0.4 with unholed
 * short edges). Equal-edged panels are unaffected.
 */
export const HOLE_MIN_RUN_RATIO = 0.55;

export const DEFAULT_BITE_DEPTH_MM = 2;
export const DEFAULT_DIAMETER_IN = 1.8;
export const MIN_DIAMETER_IN = 1.5;
export const MAX_DIAMETER_IN = 2.5;
export const MIN_BITE_DEPTH_MM = 0.5;
export const MAX_BITE_DEPTH_MM = 4;
/**
 * Edge curvature as a percentage of the true spherical bulge: 100 = the
 * geometric sagitta of each edge's great-circle arc (default), 0 =
 * straight polygon edges, >100 = extra bow. Reference: the proven
 * footbag-templates pentagons (curveRadius 40mm on 17.5mm sides) sit at
 * ≈55% of spherical.
 */
export const DEFAULT_CURVATURE_PCT = 100;
export const MIN_CURVATURE_PCT = 0;
export const MAX_CURVATURE_PCT = 150;

/**
 * Empirical gather/fabric correction on linear panel dimensions.
 *
 * Real footbags gather fabric and sit loose, so proven panel sizes are
 * much larger than rigid sphere geometry predicts. Calibrated from the
 * footbag-templates repo (README "Sizes and Gather" + per-size JSONs),
 * 32-panel series. The repo's listed pentagon sides are CUT outlines
 * with the stitch line inset by the bite (2mm; 2.2mm at 2.0in), so the
 * comparison is seam line vs seam line:
 *
 *   K = (cutSide − 2·bite·tan36°) / ((D_mm/2) / 2.478)
 *
 *   1.6in: (15.5 − 2.91) / 8.20 = 1.54
 *   1.7in: (16.5 − 2.91) / 8.71 = 1.56
 *   1.8in: (17.5 − 2.91) / 9.22 = 1.58
 *   2.0in: (19.0 − 3.20) / 10.25 = 1.54
 *
 * Stable across the size range → a single constant. Calibrated on
 * 32-panel bags only; other panel counts extrapolate (adjust here if a
 * test bag comes out off-size).
 */
export const GATHER_CORRECTION = 1.55;

/** Millimeters of physical fabric per topology sphere unit. */
export function mmPerUnit(diameterIn: number): number {
  return ((diameterIn * 25.4) / 2 / SPHERE_RADIUS) * GATHER_CORRECTION;
}

/** Fresh default settings object (new designs, missing extras). */
export function defaultLaserSettings(): {
  diameterIn: number;
  biteDepthMm: number;
  curvaturePct: number;
  showHoles: boolean;
} {
  return {
    diameterIn: DEFAULT_DIAMETER_IN,
    biteDepthMm: DEFAULT_BITE_DEPTH_MM,
    curvaturePct: DEFAULT_CURVATURE_PCT,
    showHoles: true,
  };
}

// SVG conventions (LightBurn/LaserWeb map colors to operations).
export const CUT_COLOR = "#000000";
export const HOLE_COLOR = "#ff0000";
export const CUT_STROKE_MM = 0.17;
export const HOLE_STROKE_MM = 0.1;
export const MARGIN_MM = 10;

/** Sampling density for outline offsetting / hole placement. */
export const SAMPLE_STEP_MM = 0.4;
