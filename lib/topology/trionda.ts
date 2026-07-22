import type { PanelTopology } from "@/lib/types";
import { importedBallTopology } from "./importedBall";
import { TRIONDA_VERTICES, TRIONDA_FACES } from "./trionda-data";

/**
 * Trionda 2026 — imported via scripts/import-ball-topology.ts.
 *
 * Boundary curves extracted from the source GLB and downsampled with
 * spherical RDP. Normalization, boundary re-densification, and edge
 * building are shared with every imported ball — see importedBall.ts.
 */
export function trionda(radius = 1): PanelTopology {
  return importedBallTopology(TRIONDA_VERTICES, TRIONDA_FACES, radius);
}
