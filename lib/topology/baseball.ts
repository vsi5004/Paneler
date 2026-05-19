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

// Latitude amplitude of the seam wave, in radians. The seam oscillates
// between ±SEAM_AMPLITUDE around the equator twice per revolution
// (frequency = 2 → two "humps", classic baseball/tennis-ball shape).
// π/4 ≈ 0.785 puts each hump roughly halfway to a pole.
const SEAM_AMPLITUDE = Math.PI / 4;

/**
 * "Baseball" — two-panel cover separated by a wavy seam. Each panel has a
 * single closed boundary (~60 sample points along a sinusoidal curve on the
 * sphere) instead of the discrete corners of a Goldberg-style polyhedron.
 * After subdivision + projection the seam reads as a smooth curved boundary,
 * which is the point of including this template: it exercises the
 * curved-edge path through the renderer + flat unfold.
 *
 * Seam parameterization (on the unit sphere):
 *   longitude(t) = 2π·t                       for t ∈ [0,1)
 *   latitude(t)  = A·sin(2·longitude(t))      A = SEAM_AMPLITUDE
 *
 * Panel A (call it "north") walks the seam in ascending t (CCW from outside
 * the +Y hemisphere as seen looking down −Y). Panel B ("south") walks it in
 * descending t for its own CCW. Both panels share every seam vertex; the
 * topology has one edge per consecutive pair, with panelA/panelB set so
 * adjacency works for the unfold BFS.
 */
export function baseball(radius = 1): PanelTopology {
  const vertices: Vector3[] = [];
  for (let i = 0; i < SEAM_SAMPLES; i++) {
    const theta = (i / SEAM_SAMPLES) * 2 * Math.PI;
    const phi = SEAM_AMPLITUDE * Math.sin(2 * theta);
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
