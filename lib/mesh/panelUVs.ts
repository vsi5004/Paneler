import { BufferAttribute, type BufferGeometry, Vector3 } from "three";

/**
 * Generate UV coordinates for a panel's geometry by projecting positions onto
 * a tangent plane at the panel's centroid. Each panel's UV frame is rotated by
 * a hash of its id so the (optional) suede texture's grain direction varies
 * across the sphere — without this, all panels show parallel stripes and the
 * surface reads as obviously fake.
 *
 * Ported from the old `buildMeshGroup.generatePanelUVs` (and originally from
 * Footbag-3D-Visualizer/FootbagModel.tsx). Pure function of `positions` +
 * `panelId`; same input always yields the same UVs.
 */
export function buildPanelUVArray(
  positions: ArrayLike<number>,
  vertexCount: number,
  panelId: string,
): Float32Array {
  const center = new Vector3();
  const vertex = new Vector3();
  for (let i = 0; i < vertexCount; i++) {
    vertex.set(
      positions[i * 3 + 0],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
    );
    center.add(vertex);
  }
  center.divideScalar(vertexCount).normalize();

  const helper =
    Math.abs(center.dot(new Vector3(0, 0, 1))) < 0.9
      ? new Vector3(0, 0, 1)
      : new Vector3(1, 0, 0);
  const baseTanU = new Vector3().crossVectors(center, helper).normalize();
  const baseTanV = new Vector3().crossVectors(center, baseTanU).normalize();

  const hash = panelId
    .split("")
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const angle = (hash % 360) * (Math.PI / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tanU = new Vector3()
    .addScaledVector(baseTanU, cos)
    .addScaledVector(baseTanV, sin);
  const tanV = new Vector3()
    .addScaledVector(baseTanU, -sin)
    .addScaledVector(baseTanV, cos);

  const uvs = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i++) {
    vertex.set(
      positions[i * 3 + 0],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
    );
    uvs[i * 2] = vertex.dot(tanU);
    uvs[i * 2 + 1] = vertex.dot(tanV);
  }
  return uvs;
}

/** Three.js-side wrapper: read positions from a BufferGeometry and write UVs back. */
export function generatePanelUVsOnGeometry(
  geometry: BufferGeometry,
  panelId: string,
): void {
  const pos = geometry.attributes.position;
  if (!pos) return;
  const uvs = buildPanelUVArray(
    pos.array as ArrayLike<number>,
    pos.count,
    panelId,
  );
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
}
