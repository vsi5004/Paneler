import { Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";
import { spiralSeamPoints } from "./spiral";
import {
  buildArrangement,
  traceFaces,
  arrangementTopology,
} from "./arrangement";

/**
 * "Weave" — two copies of the spiral's pole-to-pole seam wound around
 * PERPENDICULAR axes (one around Z, the same curve rotated to wind
 * around X). The two closed seams cross each other; the sphere falls
 * apart into the enclosed regions, which — colored alternately — read
 * as two spiral ribbons woven over and under each other.
 *
 * The panel decomposition is computed by the curve-arrangement engine
 * (lib/topology/arrangement.ts): crossings → arcs → traced faces.
 *
 * The crossing count — and with it the panel count — jumps as the twist
 * changes (4 panels at 50%, 14 at 100%, 10 at 125%...). That breaks the
 * frozen-panel-id rule every other slider obeys: painted colors only
 * survive twist moves that stay on one crossing-count plateau. The
 * preset accepts that (it is a dev-only exploratory design) and its
 * slider range is capped where the plateaus are verified stable — see
 * the param comment in presets.ts.
 */

const DEFAULT_TWIST = 1;

export function weave(radius = 1, twist = DEFAULT_TWIST): PanelTopology {
  // Unit-sphere seam curves: A winds around Z, B is A rotated 90° about
  // Y so it winds around X.
  const curveA = spiralSeamPoints(twist, 1);
  const curveB = curveA.map((p) => new Vector3(p.z, p.y, -p.x));

  const arr = buildArrangement([curveA, curveB]);
  if (arr.crossingCount < 2 || arr.crossingCount % 2 !== 0) {
    throw new Error(
      `weave: degenerate seam crossing count ${arr.crossingCount} at twist ${twist}`,
    );
  }

  const faces = traceFaces(arr);
  const expected = arr.arcs.length - arr.crossingCount + 2; // Euler: F = E − V + 2
  if (faces.length !== expected) {
    throw new Error(
      `weave: face tracing found ${faces.length} faces, expected ${expected}`,
    );
  }

  return arrangementTopology(arr, faces, radius);
}
