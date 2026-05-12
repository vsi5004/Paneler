import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import type { PanelTopology } from "@/lib/types";
import { getPanelTriangles } from "./subdivide";

const DEFAULT_PANEL_COLOR = "#c41e3a";

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

    const mesh = new Mesh(geometry, material);
    mesh.name = panel.id;
    mesh.userData.panelId = panel.id;
    mesh.userData.shape = panel.shape;
    mesh.userData.originalColor = `#${defaultColor.getHexString()}`;
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
