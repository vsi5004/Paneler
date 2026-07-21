import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";

// Number of sample points along the seam. The subdivider will further break
// each consecutive pair into `SUBDIVISION_LEVELS` segments at runtime, so
// the visible seam is much smoother than this count suggests. 96 keeps the
// steeper equator crossings of high-roundness seams well resolved (and puts
// samples exactly on the wave peaks: t = π/4 is sample 12), while staying
// coarse enough that fan-triangulation doesn't blow up the triangle count.
const SEAM_SAMPLES = 96;

// Default latitude amplitude of the seam wave, in radians. The seam
// oscillates between ±amplitude around the equator twice per revolution
// (frequency = 2 → two "humps", classic baseball/tennis-ball shape).
// π/4 ≈ 0.785 puts each hump roughly halfway to a pole.
const DEFAULT_SEAM_AMPLITUDE = Math.PI / 4;

// Default peak-flattening for the seam wave (see `seamRoundness` below).
const DEFAULT_SEAM_ROUNDNESS = 0.6;

// Roundness → tanh gain. At the top of the range the wave is strongly
// plateaued (square-ish); beyond ~3 further gain barely changes the shape.
const MAX_ROUNDNESS_GAIN = 3;

/**
 * "Baseball" — two-panel cover separated by a wavy seam. Each panel has a
 * single closed boundary (sample points along a smooth curve on the sphere)
 * instead of the discrete corners of a Goldberg-style polyhedron. After
 * subdivision + projection the seam reads as a smooth curved boundary,
 * which is the point of including this template: it exercises the
 * curved-edge path through the renderer + flat unfold.
 *
 * Seam parameterization (on the unit sphere):
 *
 *   longitude(t) = t                                  t ∈ [0, 2π)
 *   latitude(t)  = A · g(sin 2t)
 *   g(u)         = tanh(k·u) / tanh(k)                (g(u) = u when k = 0)
 *
 * `seamAmplitude` A is the maximum latitude the seam reaches (radians,
 * [0, π/2)). `seamRoundness` ∈ [0, 1] maps to the tanh gain k and flattens
 * the wave's peaks: the seam then spends more arc hugging its extreme
 * latitude, which widens the turnarounds and rounds the panel lobes. At
 * roundness 0 the profile is the pure sine — whose peaks sharpen toward
 * cusps at high amplitude because meridians converge near the poles — and
 * higher roundness compensates by plateauing exactly where the sine would
 * kink.
 *
 * Amplitude 0 gives a straight equator seam (two hemispheres) regardless of
 * roundness; the subdivider's signed-area centroid fallback places each
 * panel's fan center on its hemisphere pole (see computeCentroid). π/2 would
 * pinch at the poles, so the preset caps below it.
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
  seamRoundness = DEFAULT_SEAM_ROUNDNESS,
): PanelTopology {
  const k = Math.max(0, seamRoundness) * MAX_ROUNDNESS_GAIN;
  const shape_ = (u: number): number =>
    k < 1e-6 ? u : Math.tanh(k * u) / Math.tanh(k);

  const vertices: Vector3[] = [];
  for (let i = 0; i < SEAM_SAMPLES; i++) {
    const theta = (i / SEAM_SAMPLES) * 2 * Math.PI;
    const phi = seamAmplitude * shape_(Math.sin(2 * theta));
    const x = Math.cos(phi) * Math.cos(theta);
    const y = Math.cos(phi) * Math.sin(theta);
    const z = Math.sin(phi);
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
