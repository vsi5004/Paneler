import {
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import type { PanelTopology } from "@/lib/types";
import { getPanelTriangles } from "./subdivide";

const DEFAULT_PANEL_COLOR = "#c41e3a";
// Dihedral threshold for EdgesGeometry. Subdivided triangles within a panel
// have ~0° angle between them, so any positive threshold filters them out;
// only the panel's outer boundary remains (those edges have just one
// adjacent triangle within the mesh).
const EDGE_THRESHOLD_DEGREES = 1;

/**
 * Convert a (subdivided + sphere-projected) PanelTopology into a renderable
 * THREE.Group: one Mesh per panel, named `panel_<idx>_<shape>`, each with its
 * own cloned MeshStandardMaterial so the designer can recolor independently.
 *
 * Each mesh's BufferGeometry is built from the per-panel triangle list emitted
 * by `subdivideTopology`. If no triangle list is attached (e.g. an
 * un-subdivided topology), each panel is fan-triangulated from its centroid
 * using only its boundary vertices — a fallback for the simplest case.
 *
 * Vertex normals are computed AFTER the topology has been projected, never
 * inherited from a pre-projection mesh.
 */
export function buildMeshGroup(topo: PanelTopology): Group {
  const group = new Group();
  const triLists = getPanelTriangles(topo);
  const defaultColor = new Color(DEFAULT_PANEL_COLOR);

  for (const panel of topo.panels) {
    let triangles = triLists?.get(panel.id);
    if (!triangles) {
      triangles = fanTriangulate(panel.vertexIndices);
    }

    const geometry = buildPanelGeometry(topo, triangles);

    const material = new MeshStandardMaterial({
      color: defaultColor.clone(),
      metalness: 0,
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    // Generate per-panel UVs after projection so the (future) suede texture
    // has correct grain direction. Each panel gets a unique deterministic
    // rotation so stripes don't align across the sphere.
    generatePanelUVs(geometry, panel.id);

    const mesh = new Mesh(geometry, material);
    mesh.name = panel.id;
    mesh.userData.panelId = panel.id;
    mesh.userData.shape = panel.shape;
    mesh.userData.originalColor = `#${defaultColor.getHexString()}`;

    // Per-panel boundary line, hidden by default. Visibility is toggled by
    // PanelerCanvas when a panel is selected. Excluded from raycasting so
    // clicks pass through to the underlying mesh.
    const edges = new EdgesGeometry(geometry, EDGE_THRESHOLD_DEGREES);
    const line = new LineSegments(
      edges,
      new LineBasicMaterial({ color: 0xffffff }),
    );
    line.name = `${panel.id}__outline`;
    line.userData.outlineFor = panel.id;
    line.visible = false;
    line.raycast = () => {};
    mesh.add(line);

    group.add(mesh);
  }

  return group;
}

function fanTriangulate(
  boundaryLoop: ReadonlyArray<number>,
): [number, number, number][] {
  const triangles: [number, number, number][] = [];
  for (let i = 1; i < boundaryLoop.length - 1; i++) {
    triangles.push([boundaryLoop[0], boundaryLoop[i], boundaryLoop[i + 1]]);
  }
  return triangles;
}

/**
 * Generate UV coordinates for a panel's geometry by projecting positions
 * onto a tangent plane at the panel's centroid. Each panel's UV frame is
 * rotated by a hash of its name so the (optional) suede texture's grain
 * direction varies — without this, all panels show parallel stripes that
 * look obviously fake.
 *
 * Ported from Footbag-3D-Visualizer/FootbagModel.tsx (generatePanelUVs).
 */
function generatePanelUVs(geometry: BufferGeometry, meshName: string): void {
  const pos = geometry.attributes.position;
  if (!pos) return;

  const center = new Vector3();
  const vertex = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i);
    center.add(vertex);
  }
  center.divideScalar(pos.count).normalize();

  const helper =
    Math.abs(center.dot(new Vector3(0, 0, 1))) < 0.9
      ? new Vector3(0, 0, 1)
      : new Vector3(1, 0, 0);
  const baseTanU = new Vector3().crossVectors(center, helper).normalize();
  const baseTanV = new Vector3().crossVectors(center, baseTanU).normalize();

  // Deterministic per-panel rotation angle.
  const hash = meshName
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

  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i);
    uvs[i * 2] = vertex.dot(tanU);
    uvs[i * 2 + 1] = vertex.dot(tanV);
  }
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
}

function buildPanelGeometry(
  topo: PanelTopology,
  triangles: ReadonlyArray<readonly [number, number, number]>,
): BufferGeometry {
  // Build a non-indexed geometry per panel — each panel has its own copies of
  // the boundary vertices so it can be raycast / colored independently. This
  // mirrors the per-panel mesh treatment in Footbag-3D-Visualizer.
  const positions = new Float32Array(triangles.length * 3 * 3);
  let cursor = 0;
  for (const [a, b, c] of triangles) {
    const va = topo.vertices[a];
    const vb = topo.vertices[b];
    const vc = topo.vertices[c];
    positions[cursor++] = va.x;
    positions[cursor++] = va.y;
    positions[cursor++] = va.z;
    positions[cursor++] = vb.x;
    positions[cursor++] = vb.y;
    positions[cursor++] = vb.z;
    positions[cursor++] = vc.x;
    positions[cursor++] = vc.y;
    positions[cursor++] = vc.z;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  // Compute normals AFTER projection — using projected positions, not the
  // original pre-projection topology normals.
  geometry.computeVertexNormals();
  return geometry;
}
