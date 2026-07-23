import { WebIO, type Document } from "@gltf-transform/core";
import { hexToLinearRgba } from "@/lib/glb/build";
import type { LaserSettings } from "@/lib/laser/types";

/**
 * Mutate the baseColorFactor of a panel's material in-place on the given
 * gltf-transform Document. The panel is identified by either its panelId
 * (which matches a node name + node.extras.panelId) or by an explicit
 * material name (e.g. `panel_001_quad_mat`).
 *
 * Returns true if the color was applied, false if no matching material was
 * found.
 */
export function setMaterialColor(
  doc: Document,
  panelId: string,
  hex: string,
): boolean {
  const targetName = panelId.endsWith("_mat") ? panelId : `${panelId}_mat`;
  for (const material of doc.getRoot().listMaterials()) {
    if (material.getName() === targetName) {
      material.setBaseColorFactor(hexToLinearRgba(hex));
      return true;
    }
  }
  return false;
}

/**
 * Merge laser settings into `asset.extras.paneler`, preserving any
 * existing version/presetId/params. Creates the paneler block when absent
 * (Blender-imported designs have no preset provenance but still persist
 * their laser settings). Mirror of the setMaterialColor pattern: mutate
 * the live document so the next serialize() captures the change — no
 * regeneration involved.
 */
export function setLaserExtras(doc: Document, laser: LaserSettings): void {
  const asset = doc.getRoot().getAsset();
  const extras =
    typeof asset.extras === "object" && asset.extras !== null
      ? (asset.extras as Record<string, unknown>)
      : {};
  const paneler =
    typeof extras.paneler === "object" && extras.paneler !== null
      ? (extras.paneler as Record<string, unknown>)
      : { version: 1 };
  paneler.laser = {
    diameterIn: laser.diameterIn,
    biteDepthMm: laser.biteDepthMm,
    curvaturePct: laser.curvaturePct,
  };
  extras.paneler = paneler;
  asset.extras = extras;
}

/** Browser- and Node-compatible binary GLB serializer. */
export async function serializeDocument(doc: Document): Promise<Uint8Array> {
  return new WebIO().writeBinary(doc);
}
