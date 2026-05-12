import { Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";

/**
 * Pick the panel whose centroid is closest to `+Y` on the sphere — that's
 * the "top of the bag" and becomes the centre of the unfolded net. Aligns
 * with the 3D camera framing (looks down the +Z axis with +Y up) so the
 * panel a user sees at the top of the sphere is the one anchoring the
 * flat view.
 */
export function chooseRoot(topo: PanelTopology): string {
  const up = new Vector3(0, 1, 0);
  let bestId = topo.panels[0]?.id ?? "";
  let bestDot = -Infinity;
  const centroid = new Vector3();
  for (const panel of topo.panels) {
    centroid.set(0, 0, 0);
    for (const vi of panel.vertexIndices) centroid.add(topo.vertices[vi]);
    centroid.divideScalar(panel.vertexIndices.length);
    centroid.normalize();
    const dot = centroid.dot(up);
    if (dot > bestDot) {
      bestDot = dot;
      bestId = panel.id;
    }
  }
  return bestId;
}
