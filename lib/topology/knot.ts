import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";
import { seamLatitude, spineHalfLengthForAmplitude } from "./baseball";

/**
 * "Knot" — the baseball's two-panel equidistant seam with a spiral twist
 * layered on top: every point is rotated about the polar axis by an angle
 * that depends only on its latitude,
 *
 *   lon' = lon + twist · 2π · cos²(latitude)
 *
 * so the equator shears a full `twist` turns against the (fixed) poles.
 * The baseball's two lobes wind around the ball and the single seam
 * traces a knot-like path — but it remains one simple closed curve at
 * any twist (a latitude-wise rotation is a homeomorphism of the sphere,
 * so it can never introduce self-crossings).
 *
 * Panel congruence: the baseball's panel swap is S(φ, λ) = (−φ, λ+π/2)
 * (flip z, quarter-turn about z). A twist field f(φ) commutes with S
 * exactly when f(−φ) = f(φ) — hence the even cos² profile. The twisted
 * panels stay congruent by construction, so one template cuts both.
 *
 * Like the spiral, each panel wraps the ball (grain direction turns with
 * the lobe) — but here the two panels' spines wrap PERPENDICULAR axes,
 * so directional fabric stretch that shows up as oblateness in the
 * single-axis spiral should average out across the two panels.
 *
 * The twist creates hairpin turnarounds where the seam sweeps latitude
 * quickly, so sampling is uniform in seam arc length (a longitude-uniform
 * sampling starves the hairpins), like the spiral.
 *
 * Two hard-won constraints bound the parameters:
 *
 * - CUTTABILITY. The panels' flat developments self-overlap (the S-wing
 *   curls back over the body — no cuttable template exists) once the
 *   lobes wind too far. Measured over amplitude × twist via ARAP
 *   development + boundary self-crossing count: at the baseball's π/4
 *   amplitude the limit is ~25% twist; at 30% amplitude (skinnier
 *   lobes) clean through 60%. Hence amplitude is FIXED at 30% and the
 *   twist slider capped at 60%.
 *
 * - MIRROR PANELS. Of the tennis-ball seam's panel-swapping symmetries,
 *   only the improper rotoreflection S4 commutes with an even twist
 *   field; the proper C2' swaps anti-commute. So (unlike the spiral,
 *   whose panels swap by a proper rotation) the twisted panels are
 *   congruent only as MIRROR images: cut the second panel with the
 *   template flipped face-down.
 *
 * The sin²φ ("pole-max") twist profile is not a second design: since
 * sin² = 1 − cos², it is this same ball rigidly rotated and mirrored.
 */

/** Seam max latitude 27° (= 30% of the way to the pole) — see above. */
const DEFAULT_KNOT_AMPLITUDE = 0.3 * (Math.PI / 2);
export function knot(
  radius = 1,
  twist = 0.4,
  amplitude = DEFAULT_KNOT_AMPLITUDE,
): PanelTopology {
  const halfLength = spineHalfLengthForAmplitude(amplitude);

  const pointAt = (theta: number): Vector3 => {
    const phi = seamLatitude(theta, halfLength);
    const lon = theta + twist * 2 * Math.PI * Math.cos(phi) * Math.cos(phi);
    return new Vector3(
      Math.cos(phi) * Math.cos(lon),
      Math.cos(phi) * Math.sin(lon),
      Math.sin(phi),
    );
  };

  // Dense pass to measure arc length, then resample uniformly along it.
  const DENSE = 4096;
  const dense: Vector3[] = [];
  for (let i = 0; i < DENSE; i++) {
    dense.push(pointAt((i / DENSE) * 2 * Math.PI));
  }
  const cum: number[] = [0];
  let arc = 0;
  for (let i = 0; i < DENSE; i++) {
    arc += dense[i].distanceTo(dense[(i + 1) % DENSE]);
    cum.push(arc);
  }

  const samples = Math.max(96, Math.round(24 * arc));
  const vertices: Vector3[] = [];
  for (let k = 0; k < samples; k++) {
    const s = (k / samples) * arc;
    // invert the cumulative table
    let lo = 0;
    let hi = DENSE;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const f = cum[hi] > cum[lo] ? (s - cum[lo]) / (cum[hi] - cum[lo]) : 0;
    vertices.push(pointAt(((lo + f) / DENSE) * 2 * Math.PI).setLength(radius));
  }

  const n = vertices.length;
  const indicesAsc = Array.from({ length: n }, (_, i) => i);
  const indicesDesc = [...indicesAsc].reverse();

  const shape = shapeForVertexCount(n); // > 6 → "polygon"
  const panels = [
    { id: panelId(0, shape), vertexIndices: indicesAsc, shape },
    { id: panelId(1, shape), vertexIndices: indicesDesc, shape },
  ];

  const edges: PanelEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = i;
    const b = (i + 1) % n;
    edges.push({
      vertexA: Math.min(a, b),
      vertexB: Math.max(a, b),
      panelA: panels[0].id,
      panelB: panels[1].id,
    });
  }

  return { vertices, panels, edges };
}
