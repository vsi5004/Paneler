import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";

// Number of sample points along the seam. The subdivider will further break
// each consecutive pair into `SUBDIVISION_LEVELS` segments at runtime, so
// the visible seam is much smoother than this count suggests.
const SEAM_SAMPLES = 96;

// Default latitude amplitude of the seam, in radians. π/4 puts the seam's
// humps halfway to the poles — the classic baseball proportions.
const DEFAULT_SEAM_AMPLITUDE = Math.PI / 4;

/**
 * "Baseball" — two-panel cover separated by the classical baseball seam.
 * Each panel has a single closed boundary (sample points along a smooth
 * curve on the sphere) instead of the discrete corners of a Goldberg-style
 * polyhedron. After subdivision + projection the seam reads as a smooth
 * curved boundary, which is the point of including this template: it
 * exercises the curved-edge path through the renderer + flat unfold.
 *
 * Seam construction — the equidistant ("medial") curve used in real
 * baseball cover design: each panel has a geodesic spine arc, the two
 * spines are perpendicular and antipodal —
 *
 *   spine A: in the xz-plane, centered on +z, half-length ℓ
 *   spine B: in the yz-plane, centered on −z, half-length ℓ
 *
 * — and the seam is the locus of points equally distant from both arcs.
 * Panel A is everything closer to spine A, panel B the rest; the ball's
 * symmetry (rotate 90° about z, flip z) swaps the spines, so the panels
 * are congruent by construction. The equidistant locus is smooth, and its
 * turnarounds are round at every amplitude: near a spine endpoint the
 * seam is the point-vs-arc equidistant curve, a parabola-like vertex —
 * never a cusp (unlike a sine wave in lat/long, whose peaks sharpen as
 * meridians converge) and never a plateau with shoulder corners (unlike
 * peak-flattened waves).
 *
 * `seamAmplitude` is the maximum latitude the seam reaches (radians,
 * [0, π/2)); the spine half-length ℓ that realizes it is solved
 * numerically. Amplitude 0 collapses both spines to the poles and the
 * seam to the equator (two hemispheres) — the subdivider's signed-area
 * centroid fallback places each panel's fan center on its hemisphere pole
 * (see computeCentroid).
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
  const halfLength = spineHalfLengthForAmplitude(seamAmplitude);

  const vertices: Vector3[] = [];
  for (let i = 0; i < SEAM_SAMPLES; i++) {
    const theta = (i / SEAM_SAMPLES) * 2 * Math.PI;
    const phi = seamLatitude(theta, halfLength);
    const v = new Vector3(
      Math.cos(phi) * Math.cos(theta),
      Math.cos(phi) * Math.sin(theta),
      Math.sin(phi),
    );
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

// -----------------------------------------------------------------------------
// Equidistant-seam math
// -----------------------------------------------------------------------------

/**
 * Angular distance from unit point `p` to the geodesic arc lying in the
 * great circle with unit normal `n`, centered on unit direction `c` (in the
 * circle's plane) with the given half-angle. If p's projection onto the
 * circle falls within the arc, the distance is to the circle; otherwise to
 * the nearer endpoint (endpoints are `c` rotated ±halfAngle toward `e`,
 * where `e = n × c` spans the circle with `c`).
 */
function distToArc(
  p: Vector3,
  n: Vector3,
  c: Vector3,
  e: Vector3,
  halfAngle: number,
): number {
  const pc = p.dot(c);
  const pe = p.dot(e);
  // Angle of p's in-plane projection along the circle, measured from c.
  const footAngle = Math.atan2(pe, pc);
  if (Math.abs(footAngle) <= halfAngle) {
    // asin of the out-of-plane component = distance to the great circle.
    return Math.abs(Math.asin(Math.min(1, Math.max(-1, p.dot(n)))));
  }
  const endAngle = footAngle > 0 ? halfAngle : -halfAngle;
  const endpoint = _end
    .copy(c)
    .multiplyScalar(Math.cos(endAngle))
    .addScaledVector(e, Math.sin(endAngle));
  return Math.acos(Math.min(1, Math.max(-1, p.dot(endpoint))));
}

// Scratch vectors — seamLatitude runs inside bisection loops.
const _end = new Vector3();
const _p = new Vector3();

// Spine A: xz-plane (normal +y), centered on +z, spanned toward +x.
const SPINE_A_N = new Vector3(0, 1, 0);
const SPINE_A_C = new Vector3(0, 0, 1);
const SPINE_A_E = new Vector3(1, 0, 0);
// Spine B: yz-plane (normal +x), centered on −z, spanned toward +y.
const SPINE_B_N = new Vector3(1, 0, 0);
const SPINE_B_C = new Vector3(0, 0, -1);
const SPINE_B_E = new Vector3(0, 1, 0);

/**
 * Latitude of the equidistant seam at the given longitude, found by
 * bisection: north of the seam is closer to spine A, south to spine B.
 * Exported for the Knot preset, which twists this same seam.
 */
export function seamLatitude(theta: number, halfLength: number): number {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const balance = (phi: number): number => {
    const cosP = Math.cos(phi);
    _p.set(cosP * cosT, cosP * sinT, Math.sin(phi));
    return (
      distToArc(_p, SPINE_A_N, SPINE_A_C, SPINE_A_E, halfLength) -
      distToArc(_p, SPINE_B_N, SPINE_B_C, SPINE_B_E, halfLength)
    );
  };
  let lo = -Math.PI / 2 + 1e-9; // near −z: closer to spine B → balance > 0
  let hi = Math.PI / 2 - 1e-9; // near +z: closer to spine A → balance < 0
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    if (balance(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Spine half-length whose equidistant seam reaches the requested maximum
 * latitude. Closed form: at the trough (longitude 0, beside spine A's
 * endpoint) the balance is (π/2 − ℓ + |φ|) − (π/2 − |φ|) = 0 → |φ| = ℓ/2,
 * and by the ball's symmetry the peak at longitude π/2 matches. Valid for
 * ℓ < π, i.e. any amplitude below π/2 — the spine arcs wrap past the
 * equator for amplitudes above 45°, just like real baseball cover spines.
 */
export function spineHalfLengthForAmplitude(amplitude: number): number {
  return 2 * amplitude;
}
