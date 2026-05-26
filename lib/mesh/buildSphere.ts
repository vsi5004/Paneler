import { WebIO } from "@gltf-transform/core";

import type { PanelTopology } from "@/lib/types";
import { subdivideTopology, puffPanels } from "@/lib/mesh/subdivide";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { buildGlbDocument, type BuildOptions } from "@/lib/glb/build";

const DEFAULT_RADIUS = 2;
const DEFAULT_TARGET_TRIANGLES = 30_000;
const DEFAULT_PUFF = 0.06;

export interface BuildSphereOptions extends BuildOptions {
  radius?: number;
  puff?: number;
  targetTriangles?: number;
}

/**
 * Full runtime pipeline: topology → subdivide → project → puff → GLB bytes.
 * Same steps the bake script runs at build time, but callable from the client
 * for user-created or uploaded topologies.
 */
export async function buildSphereFromTopology(
  topo: PanelTopology,
  options: BuildSphereOptions = {},
): Promise<Uint8Array> {
  const {
    radius = DEFAULT_RADIUS,
    puff = DEFAULT_PUFF,
    targetTriangles = DEFAULT_TARGET_TRIANGLES,
    ...buildOptions
  } = options;

  const fanTris = topo.panels.reduce(
    (sum, p) => sum + p.vertexIndices.length,
    0,
  );
  const level = Math.ceil(Math.sqrt(targetTriangles / fanTris));

  const subdivided = subdivideTopology(topo, level);
  projectToSphere(subdivided, radius);
  if (puff > 0) {
    puffPanels(subdivided, radius, puff);
  }

  const doc = buildGlbDocument(subdivided, buildOptions);
  return new WebIO().writeBinary(doc);
}
