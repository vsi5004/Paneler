import { WebIO, type Document } from "@gltf-transform/core";
import { hexToLinearRgba } from "@/lib/glb/build";

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

/** Browser- and Node-compatible binary GLB serializer. */
export async function serializeDocument(doc: Document): Promise<Uint8Array> {
  return new WebIO().writeBinary(doc);
}
