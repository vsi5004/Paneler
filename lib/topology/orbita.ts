import type { PanelTopology } from "@/lib/types";
import { importedBallTopology } from "./importedBall";
import { ORBITA_VERTICES, ORBITA_FACES } from "./orbita-data";

/**
 * Orbita (LaLiga 2022-23) — 12 congruent star-shaped pentagon panels
 * on a dodecahedron (20 vertices, 30 zigzag seams).
 *
 * The source model's UV islands merge panel pairs, hiding 6 of the 30
 * seams; scripts/split-orbita.ts reconstructs them exactly as rigid
 * rotated copies of the extracted seams via each panel's C5 symmetry
 * (all dodecahedron edges are congruent).
 */
export function orbita(radius = 1): PanelTopology {
  return importedBallTopology(ORBITA_VERTICES, ORBITA_FACES, radius);
}
