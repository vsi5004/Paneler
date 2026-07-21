import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";

// Number of sample points along the seam. The subdivider will further break
// each consecutive pair into `SUBDIVISION_LEVELS` segments at runtime, so
// the visible seam is much smoother than this count suggests. 60 is a good
// balance — fine enough that the wavy curve reads as smooth before
// subdivision, coarse enough that fan-triangulation from the centroid
// doesn't blow up the per-panel triangle count.
const SEAM_SAMPLES = 60;

// Default latitude amplitude of the seam wave, in radians. The seam
// oscillates between ±amplitude around the equator twice per revolution
// (frequency = 2 → two "humps", classic baseball/tennis-ball shape).
// π/4 ≈ 0.785 puts each hump roughly halfway to a pole.
const DEFAULT_SEAM_AMPLITUDE = Math.PI / 4;

/**
 * "Baseball" — two-panel cover separated by a wavy seam. Each panel has a
 * single closed boundary (~60 sample points along a sinusoidal curve on the
 * sphere) instead of the discrete corners of a Goldberg-style polyhedron.
 * After subdivision + projection the seam reads as a smooth curved boundary,
 * which is the point of including this template: it exercises the
 * curved-edge path through the renderer + flat unfold.
 *
 * Seam parameterization — the classical tennis-ball curve (Fourier form):
 *
 *   x = a·cos t + b·cos 3t
 *   y = a·sin t − b·sin 3t      with a + b = 1, t ∈ [0, 2π)
 *   z = 2√(ab)·sin 2t
 *
 * The curve lies exactly on the unit sphere: x² + y² + z² = (a + b)² = 1.
 * Compared to the earlier `latitude = A·sin(2·longitude)` wave, its lobes
 * stay round at high amplitude instead of sharpening into cusps (meridians
 * converge near the poles, so a sine wave in lat/long space gets pointier
 * the higher it swings).
 *
 * `seamAmplitude` is the maximum latitude the seam reaches (radians,
 * [0, π/2)). The peak of z is 2√(ab), so sin(amplitude) = 2√(ab) with
 * a + b = 1 gives the closed form a = cos²(amplitude/2), b = sin²(amplitude/2).
 * 0 → equator seam (two hemispheres, b = 0); π/4 → classic baseball; π/2
 * would pinch at the poles (a = b), so the preset caps below it. At 0 the
 * subdivider's signed-area centroid fallback places each panel's fan center
 * on its hemisphere pole (see computeCentroid).
 *
 * Panel A (call it "north") walks the seam in ascending t (CCW from outside
 * the +Y hemisphere as seen looking down −Y). Panel B ("south") walks it in
 * descending t for its own CCW. Both panels share every seam vertex; the
 * topology has one edge per consecutive pair, with panelA/panelB set so
 * adjacency works for the unfold BFS.
 */
export function baseball(
  radius = 1,
  seamAmplitude = DEFAULT_SEAM_AMPLITUDE,
): PanelTopology {
  const a = Math.cos(seamAmplitude / 2) ** 2;
  const b = Math.sin(seamAmplitude / 2) ** 2;
  const zScale = 2 * Math.sqrt(a * b);
  const vertices: Vector3[] = [];
  for (let i = 0; i < SEAM_SAMPLES; i++) {
    const t = (i / SEAM_SAMPLES) * 2 * Math.PI;
    const x = a * Math.cos(t) + b * Math.cos(3 * t);
    const y = a * Math.sin(t) - b * Math.sin(3 * t);
    const z = zScale * Math.sin(2 * t);
    const v = new Vector3(x, y, z);
    v.setLength(radius);
    vertices.push(v);
  }

  // Both panels' boundaries are the same N seam vertices, but traversed in
  // opposite directions so each reads CCW from its own hemisphere's outside.
  const indicesAsc: number[] = [];
  for (let i = 0; i < SEAM_SAMPLES; i++) indicesAsc.push(i);
  const indicesDesc = [...indicesAsc].reverse();

  const shape = shapeForVertexCount(SEAM_SAMPLES); // > 6 → "polygon"
  const panels = [
    { id: panelId(0, shape), vertexIndices: indicesAsc, shape },
    { id: panelId(1, shape), vertexIndices: indicesDesc, shape },
  ];

  const edges: PanelEdge[] = [];
  for (let i = 0; i < SEAM_SAMPLES; i++) {
    const a = i;
    const b = (i + 1) % SEAM_SAMPLES;
    edges.push({
      vertexA: Math.min(a, b),
      vertexB: Math.max(a, b),
      panelA: panels[0].id,
      panelB: panels[1].id,
    });
  }

  return { vertices, panels, edges };
}
