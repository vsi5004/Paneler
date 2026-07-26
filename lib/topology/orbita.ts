import type { PanelTopology } from "@/lib/types";
import { importedBallTopology } from "./importedBall";
import { ORBITA_VERTICES, ORBITA_FACES } from "./orbita-data";

/**
 * Orbita — imported via scripts/import-ball-topology.ts.
 *
 * Boundary curves extracted from the source GLB and downsampled with
 * spherical RDP. Normalization, boundary re-densification, and edge
 * building are shared with every imported ball — see importedBall.ts.
 */
export function orbita(radius = 1): PanelTopology {
  return importedBallTopology(ORBITA_VERTICES, ORBITA_FACES, radius);
}
