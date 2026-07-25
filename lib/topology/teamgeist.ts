import type { PanelTopology } from "@/lib/types";
import { importedBallTopology } from "./importedBall";
import { TEAMGEIST_VERTICES, TEAMGEIST_FACES } from "./teamgeist-data";

/**
 * Teamgeist — imported via scripts/import-ball-topology.ts.
 *
 * Boundary curves extracted from the source GLB and downsampled with
 * spherical RDP. Normalization, boundary re-densification, and edge
 * building are shared with every imported ball — see importedBall.ts.
 */
export function teamgeist(radius = 1): PanelTopology {
  return importedBallTopology(TEAMGEIST_VERTICES, TEAMGEIST_FACES, radius);
}
