import type { PanelTopology } from "@/lib/types";
import { importedBallTopology } from "./importedBall";
import { ORBITA_VERTICES, ORBITA_FACES } from "./orbita-data";

/**
 * Orbita (LaLiga 2022-23) — 12 congruent zigzag panels.
 *
 * The source model only encodes 6 UV islands (each merging a panel
 * pair); scripts/split-orbita.ts reconstructs the true 12-panel layout
 * by splitting each cube-morphology face along its inscribed-tetrahedron
 * diagonal, with the seam shape copied from the existing boundary
 * curves (the design is symmetric, so the "spoke" transplants exactly).
 */
export function orbita(radius = 1): PanelTopology {
  return importedBallTopology(ORBITA_VERTICES, ORBITA_FACES, radius);
}
