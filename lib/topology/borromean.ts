import { Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";
import {
  bandWeave,
  bandWeaveRoles,
  greatCircle,
  roleColors,
  STRAND_COLORS,
} from "./bandWeave";

/**
 * "Borromean" — three great-circle bands in mutually perpendicular
 * planes, woven alternately: no two rings are linked, but the three
 * together are (the medieval/Celtic Borromean rings). Each ring crosses
 * the other two at 4 crossings, going over-under-over-under, so it is
 * cut into exactly 2 panels (at its under crossings) that each run
 * unbroken through an over crossing.
 *
 * 14 panels at every band width: 8 background triangles + 3×2 ring
 * segments — the width slider never changes the crossing structure
 * until the bands touch (at 90° separation between crossing regions
 * the arrangement is safe far beyond the slider range).
 */
export function borromean(radius = 1, widthDeg = 20): PanelTopology {
  const width = (widthDeg * Math.PI) / 180;
  const { topology } = bandWeave(
    [
      { center: greatCircle(new Vector3(0, 0, 1)), width },
      { center: greatCircle(new Vector3(1, 0, 0)), width },
      { center: greatCircle(new Vector3(0, 1, 0)), width },
    ],
    radius,
  );
  return topology;
}

/** Pre-colored: one color per ring, parchment background. */
export function borromeanColors(topo: PanelTopology): Record<string, string> {
  const roles = bandWeaveRoles.get(topo);
  return roles ? roleColors(topo, roles, STRAND_COLORS) : {};
}
