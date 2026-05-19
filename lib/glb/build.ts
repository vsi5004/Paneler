import { Document } from "@gltf-transform/core";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";
import { getPanelTriangles, getBoundaryArcs } from "@/lib/mesh/subdivide";
import { buildPanelUVArray } from "@/lib/mesh/panelUVs";

const SEAM_RADIUS_BOOST = 1.004;
const SEAM_NODE_NAME = "__seams";

const DEFAULT_BASE_COLOR: [number, number, number, number] = [0.92, 0.92, 0.92, 1];

export interface BuildOptions {
  /** Friendly name for the glTF asset (e.g. preset slug or design name). */
  assetName?: string;
  /** Per-panel sRGB hex colors, e.g. {"panel_001_pentagon": "#ff0033"}. */
  panelColors?: Record<string, string>;
}

/**
 * Convert a (subdivided + projected) PanelTopology into a `@gltf-transform/core`
 * Document with one mesh primitive per panel, one Material per primitive (not
 * shared), and the canonical panelId stored on `node.extras.panelId` plus the
 * material name (`<panelId>_mat`).
 *
 * Indexed per-panel geometry: each primitive carries only the vertices it
 * actually uses. Adjacent panels' shared seam corners are duplicated across
 * primitives — that's the no-welding decision. Vertex normals are omitted;
 * runtime loader computes them.
 */
export function buildGlbDocument(
  topo: PanelTopology,
  options: BuildOptions = {},
): Document {
  const triLists = getPanelTriangles(topo);
  if (!triLists) {
    throw new Error(
      "buildGlbDocument: topology has no _triangles map. Run subdivideTopology first.",
    );
  }

  const doc = new Document();
  const asset = doc.getRoot().getAsset();
  asset.generator = "paneler-bake";
  if (options.assetName) {
    asset.extras = { name: options.assetName };
  }

  const buffer = doc.createBuffer();
  const scene = doc.createScene(options.assetName ?? "paneler");

  for (const panel of topo.panels) {
    const triangles = triLists.get(panel.id);
    if (!triangles || triangles.length === 0) continue;

    // Build a panel-local vertex pool by remapping global indices.
    const localOf = new Map<number, number>();
    const localPositions: number[] = [];
    const localIndices: number[] = [];
    for (const tri of triangles) {
      for (const globalIdx of tri) {
        let localIdx = localOf.get(globalIdx);
        if (localIdx === undefined) {
          const v = topo.vertices[globalIdx];
          localIdx = localPositions.length / 3;
          localPositions.push(v.x, v.y, v.z);
          localOf.set(globalIdx, localIdx);
        }
        localIndices.push(localIdx);
      }
    }

    // Smooth shading needs normals; suede texture needs UVs. We bake both
    // into the GLB so other glTF tooling renders the templates correctly and
    // the runtime can skip the recomputation step. Normals are computed via
    // Three.js' BufferGeometry pass so we share the same algorithm the
    // renderer would have produced from a missing-normal fallback.
    const positionTyped = new Float32Array(localPositions);
    const indexTyped = new Uint32Array(localIndices);
    const tempGeom = new BufferGeometry();
    tempGeom.setAttribute("position", new BufferAttribute(positionTyped, 3));
    tempGeom.setIndex(new BufferAttribute(indexTyped, 1));
    tempGeom.computeVertexNormals();
    // Copy into a fresh Float32Array so its buffer type is the strict
    // `ArrayBuffer` gltf-transform's setArray expects (Three.js' attribute
    // .array is typed as `ArrayBufferLike` which TS rejects).
    const normalTyped = new Float32Array(
      (tempGeom.attributes.normal as BufferAttribute).array as Float32Array,
    );
    const uvTyped = new Float32Array(
      buildPanelUVArray(
        positionTyped,
        positionTyped.length / 3,
        panel.id,
      ),
    );

    const positionAccessor = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(positionTyped)
      .setBuffer(buffer);

    const normalAccessor = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(normalTyped)
      .setBuffer(buffer);

    const uvAccessor = doc
      .createAccessor()
      .setType("VEC2")
      .setArray(uvTyped)
      .setBuffer(buffer);

    const indexAccessor = doc
      .createAccessor()
      .setType("SCALAR")
      .setArray(indexTyped)
      .setBuffer(buffer);

    const materialName = `${panel.id}_mat`;
    const baseColor =
      options.panelColors?.[panel.id] !== undefined
        ? hexToLinearRgba(options.panelColors[panel.id]!)
        : DEFAULT_BASE_COLOR;
    const material = doc
      .createMaterial(materialName)
      .setBaseColorFactor(baseColor)
      .setMetallicFactor(0)
      .setRoughnessFactor(0.85);

    const primitive = doc
      .createPrimitive()
      .setAttribute("POSITION", positionAccessor)
      .setAttribute("NORMAL", normalAccessor)
      .setAttribute("TEXCOORD_0", uvAccessor)
      .setIndices(indexAccessor)
      .setMaterial(material);

    const mesh = doc.createMesh(panel.id).addPrimitive(primitive);

    // Record local indices of the panel's *corner* vertices (the original
    // pre-subdivision boundary loop) so the parser can reconstruct
    // PanelTopology.panel.vertexIndices on load. The unfold algorithm needs
    // these — interior subdivided vertices are irrelevant to it.
    const cornerLocalIndices: number[] = [];
    for (const cornerGlobalIdx of panel.vertexIndices) {
      const local = localOf.get(cornerGlobalIdx);
      if (local === undefined) {
        throw new Error(
          `buildGlbDocument: corner ${cornerGlobalIdx} of ${panel.id} not present in local pool`,
        );
      }
      cornerLocalIndices.push(local);
    }

    const node = doc
      .createNode(panel.id)
      .setMesh(mesh)
      .setExtras({
        panelId: panel.id,
        shape: panel.shape,
        cornerLocalIndices,
      });

    scene.addChild(node);
  }

  // Bake seam lines as a LINES primitive following each topology edge's
  // subdivided boundary arc (one segment per arc step). Pushed slightly
  // outside the sphere so seams sit in front of the panel meshes from
  // every angle (mirrors the SEAM_RADIUS_BOOST trick in buildMeshGroup).
  const arcs = getBoundaryArcs(topo);
  const seamSegments: number[] = [];
  for (const edge of topo.edges) {
    const lo = Math.min(edge.vertexA, edge.vertexB);
    const hi = Math.max(edge.vertexA, edge.vertexB);
    const arcVerts = arcs?.get(`${lo}-${hi}`) ?? [lo, hi];
    for (let i = 0; i < arcVerts.length - 1; i++) {
      const a = topo.vertices[arcVerts[i]];
      const b = topo.vertices[arcVerts[i + 1]];
      seamSegments.push(
        a.x * SEAM_RADIUS_BOOST,
        a.y * SEAM_RADIUS_BOOST,
        a.z * SEAM_RADIUS_BOOST,
        b.x * SEAM_RADIUS_BOOST,
        b.y * SEAM_RADIUS_BOOST,
        b.z * SEAM_RADIUS_BOOST,
      );
    }
  }
  if (seamSegments.length > 0) {
    const seamPos = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array(seamSegments))
      .setBuffer(buffer);
    const seamMat = doc
      .createMaterial(`${SEAM_NODE_NAME}_mat`)
      .setBaseColorFactor([0.067, 0.067, 0.067, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(1);
    const seamPrim = doc
      .createPrimitive()
      .setAttribute("POSITION", seamPos)
      .setMode(1) // glTF LINES
      .setMaterial(seamMat);
    const seamMesh = doc.createMesh(SEAM_NODE_NAME).addPrimitive(seamPrim);
    const seamNode = doc
      .createNode(SEAM_NODE_NAME)
      .setMesh(seamMesh)
      .setExtras({ kind: "seams" });
    scene.addChild(seamNode);
  }

  return doc;
}

/** sRGB hex `#rrggbb` → linear-space `[r,g,b,1]` for glTF baseColorFactor. */
export function hexToLinearRgba(hex: string): [number, number, number, number] {
  const s = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), 1];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Inverse of hexToLinearRgba — used by the parser/save path. */
export function linearRgbaToHex(rgba: readonly number[]): string {
  const [r, g, b] = rgba;
  return (
    "#" +
    [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)]
      .map((c) => Math.max(0, Math.min(255, Math.round(c * 255))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// Re-export for the bake script's convenience.
export { Vector3 };
