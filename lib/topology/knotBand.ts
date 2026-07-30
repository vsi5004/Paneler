import { Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";
import {
  bandWeave,
  bandWeaveRoles,
  roleColors,
  STRAND_COLORS,
} from "./bandWeave";

/**
 * Single-strand knot bands: the projection of a (p,q) torus knot onto
 * the sphere,
 *
 *   longitude(t) = p·t,   latitude(t) = A·cos(q·t),   t ∈ [0, 2π)
 *
 * winds p times around the polar axis while the latitude oscillates q
 * times, self-crossing q·(p−1) times — the minimal alternating diagram
 * of the (p,q) torus knot. Given band WIDTH and alternating over/under
 * (torus knots are alternating, so the parity always solves), the
 * strand reads as authentic knotwork:
 *
 *   (2,3) → the TRIQUETRA: 3 crossings, 3-fold symmetry, the Celtic
 *           trinity knot wrapped around the ball.
 *   (3,4) → the TURK'S HEAD: 8 crossings, the sailor's woven ball.
 *
 * Crossing structure is fixed by (p,q), so the width and reach sliders
 * never change the panel count — frozen panel ids are safe here, unlike
 * the Weave/Gore-Weave twist sliders.
 */
export function torusKnotBand(
  radius: number,
  p: number,
  q: number,
  latAmpDeg: number,
  widthDeg: number,
): PanelTopology {
  const A = (latAmpDeg * Math.PI) / 180;
  const width = (widthDeg * Math.PI) / 180;

  // sample count scaled with the curve's length (p wraps, q swings)
  const samples = Math.max(512, 128 * (p + q));
  const center: Vector3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * 2 * Math.PI;
    const lon = p * t;
    const lat = A * Math.cos(q * t);
    center.push(
      new Vector3(
        Math.cos(lat) * Math.cos(lon),
        Math.cos(lat) * Math.sin(lon),
        Math.sin(lat),
      ),
    );
  }

  const { topology } = bandWeave([{ center, width }], radius);
  return topology;
}

/** Pre-colored: the strand in one knotwork color, parchment background. */
export function knotBandColors(topo: PanelTopology): Record<string, string> {
  const roles = bandWeaveRoles.get(topo);
  return roles ? roleColors(topo, roles, STRAND_COLORS) : {};
}
