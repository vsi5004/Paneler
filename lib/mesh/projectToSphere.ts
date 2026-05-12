import type { PanelTopology } from "@/lib/types";

/**
 * Project every vertex (corner + interior) onto a sphere of the given radius.
 * After projection, chord edges between corners become piecewise-linear
 * approximations of great-circle arcs — the more subdivisions, the smoother.
 *
 * Mutates the topology in place and returns it for chaining.
 */
export function projectToSphere(
  topo: PanelTopology,
  radius: number,
): PanelTopology {
  for (const v of topo.vertices) {
    if (v.lengthSq() === 0) continue; // skip degenerate zero vectors
    v.setLength(radius);
  }
  return topo;
}
