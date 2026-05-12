import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import type { PanelTopology } from "@/lib/types";
import { getBoundaryArcs, getPanelTriangles } from "./subdivide";

const DEFAULT_PANEL_COLOR = "#c41e3a";
// Push seam-line vertices a hair outside the panel mesh radius so they sit
// strictly in front of the sphere from any camera angle. Without this, lines
// on the back hemisphere were leaking through the front-facing panels and
// the sphere read as semi-transparent.
const SEAM_RADIUS_BOOST = 1.004;

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
  const arcs = getBoundaryArcs(topo);
  const defaultColor = new Color(DEFAULT_PANEL_COLOR);

  // Group panel-boundary segments by panel for the selection-highlight lines,
  // and collect every boundary segment once for the always-visible global
  // seam. Each segment comes from the subdivided boundary arc of an original
  // topology edge — so the within-panel triangle grid never enters the line
  // mesh in the first place (no dihedral-threshold guessing).
  const perPanelSegments = new Map<string, number[]>();
  const globalSegments: number[] = [];

  for (const edge of topo.edges) {
    const lo = Math.min(edge.vertexA, edge.vertexB);
    const hi = Math.max(edge.vertexA, edge.vertexB);
    const arcVerts =
      arcs?.get(`${lo}-${hi}`) ?? [lo, hi];
    for (let i = 0; i < arcVerts.length - 1; i++) {
      const a = topo.vertices[arcVerts[i]];
      const b = topo.vertices[arcVerts[i + 1]];
      const ax = a.x * SEAM_RADIUS_BOOST;
      const ay = a.y * SEAM_RADIUS_BOOST;
      const az = a.z * SEAM_RADIUS_BOOST;
      const bx = b.x * SEAM_RADIUS_BOOST;
      const by = b.y * SEAM_RADIUS_BOOST;
      const bz = b.z * SEAM_RADIUS_BOOST;
      globalSegments.push(ax, ay, az, bx, by, bz);
      for (const panelId of [edge.panelA, edge.panelB]) {
        if (!panelId) continue;
        let arr = perPanelSegments.get(panelId);
        if (!arr) {
          arr = [];
          perPanelSegments.set(panelId, arr);
        }
        arr.push(ax, ay, az, bx, by, bz);
      }
    }
  }

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

    // White outline shown only when this panel is selected. Built from the
    // panel's boundary arcs, so no triangle grid sneaks in.
    const segs = perPanelSegments.get(panel.id);
    if (segs && segs.length > 0) {
      const outlineGeom = new BufferGeometry();
      outlineGeom.setAttribute(
        "position",
        new BufferAttribute(new Float32Array(segs), 3),
      );
      const outline = new LineSegments(
        outlineGeom,
        new LineBasicMaterial({ color: 0xffffff }),
      );
      outline.name = `${panel.id}__outline`;
      outline.userData.outlineFor = panel.id;
      outline.visible = false;
      outline.raycast = () => {};
      mesh.add(outline);
    }

    group.add(mesh);
  }

  // Always-visible global seam mesh.
  if (globalSegments.length > 0) {
    const seamGeom = new BufferGeometry();
    seamGeom.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(globalSegments), 3),
    );
    const seamLines = new LineSegments(
      seamGeom,
      new LineBasicMaterial({ color: 0x111111 }),
    );
    seamLines.name = "__seams";
    seamLines.raycast = () => {};
    group.add(seamLines);
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
