import { Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";
import { spiralSeamPoints } from "./spiral";
import {
  bandWeave,
  bandWeaveRoles,
  greatCircle,
  roleColors,
  STRAND_COLORS,
} from "./bandWeave";

/**
 * "Gore Weave" — a spiral ribbon woven through a 4-panel orange-slice
 * ball. The background is the classic 4-gore cover (two full meridian
 * great circles); the strand is the apple-peel spiral given WIDTH, and
 * at successive gore-seam crossings it alternates: seam over (the seam
 * cuts the ribbon into two panels and runs through) / ribbon over (the
 * seam stops at the ribbon's edges and the ribbon panel runs unbroken).
 *
 * The gore seams meet at the poles; a full pole-to-pole spiral would
 * bury those 4-way corners inside the band and degenerate the crossing
 * regions. The ribbon's latitude range is therefore COMPRESSED so its
 * edge keeps a fixed clearance from the poles — the apple-peel shape
 * survives, the hairpin turnarounds happen below the pole, and the
 * poles stay clean gore corners.
 *
 * Like the Weave, the crossing count — and the panel count — changes
 * with twist, so painted colors survive only within a twist plateau.
 * The design ships pre-colored (ribbon vs gores) via defaultColors.
 */
export function goreWeave(
  radius = 1,
  twist = 1,
  widthDeg = 18,
): PanelTopology {
  const width = (widthDeg * Math.PI) / 180;
  const POLE_GAP = (8 * Math.PI) / 180; // band edge to pole clearance
  const scale = (Math.PI / 2 - POLE_GAP - width / 2) / (Math.PI / 2);

  const center = spiralSeamPoints(twist, 1).map((p) => {
    const lat = Math.asin(Math.min(1, Math.max(-1, p.z)));
    const lat2 = lat * scale;
    const horiz = Math.hypot(p.x, p.y);
    const f = horiz > 1e-12 ? Math.cos(lat2) / horiz : 0;
    return new Vector3(p.x * f, p.y * f, Math.sin(lat2));
  });

  const { topology } = bandWeave(
    [
      { center, width },
      // the two meridian circles bounding the 4 gores (seams, width 0)
      { center: greatCircle(new Vector3(0, 1, 0)), width: 0 },
      { center: greatCircle(new Vector3(1, 0, 0)), width: 0 },
    ],
    radius,
  );
  return topology;
}

/** Pre-colored: the ribbon in knotwork red, gores in parchment. */
export function goreWeaveColors(topo: PanelTopology): Record<string, string> {
  const roles = bandWeaveRoles.get(topo);
  return roles ? roleColors(topo, roles, STRAND_COLORS) : {};
}
