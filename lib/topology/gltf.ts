import { WebIO, type Document } from "@gltf-transform/core";
import { Vector3 } from "three";
import {
  type Panel,
  type PanelEdge,
  type PanelTopology,
  shapeForVertexCount,
} from "@/lib/types";

/**
 * Per-panel rendering hint extracted from a parsed GLB. Lets the renderer
 * build seam-line geometry or anything else that needs per-panel color/material
 * bookkeeping without re-walking the gltf-transform document.
 */
export interface PanelMaterialRef {
  panelId: string;
  materialName: string;
  /** Linear-space RGBA from the GLB material's baseColorFactor. */
  baseColorLinear: [number, number, number, number];
}

export interface ParsedGlb {
  topology: PanelTopology;
  materials: PanelMaterialRef[];
  /** The parsed gltf-transform Document — kept so save flow can mutate + re-serialize. */
  document: Document;
}

const CORNER_DEDUPE_EPSILON = 1e-4;

/**
 * Parse a GLB ArrayBuffer into a PanelTopology plus the underlying
 * gltf-transform Document (kept so the save flow can mutate baseColorFactor
 * and re-serialize without re-parsing).
 *
 * Each panel is identified by `node.extras.panelId`. Corner vertices for the
 * panel's boundary loop are recovered from `node.extras.cornerLocalIndices`
 * (indices into the primitive's POSITION accessor). Corner positions are
 * deduplicated across panels to build a shared global vertex pool — this is
 * what makes `topo.edges` (which keys on shared vertex indices) work.
 */
export async function parseGlb(bytes: Uint8Array): Promise<ParsedGlb> {
  const doc = await new WebIO().readBinary(bytes);
  return parseDocument(doc);
}

export function parseDocument(doc: Document): ParsedGlb {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) {
    throw new Error("parseGlb: GLB has no scene");
  }

  const globalVertices: Vector3[] = [];
  const panels: Panel[] = [];
  const materials: PanelMaterialRef[] = [];

  // For each panel we'll compute its corner positions in boundary order, then
  // dedupe against globalVertices. Two corners from different panels at the
  // same physical XYZ point share a vertex index — that's how seams work.
  for (const node of scene.listChildren()) {
    const extras = node.getExtras() as Record<string, unknown> | undefined;
    const panelId = extras?.panelId;
    const cornerLocalIndicesRaw = extras?.cornerLocalIndices;
    if (typeof panelId !== "string" || !Array.isArray(cornerLocalIndicesRaw)) {
      continue;
    }
    const cornerLocalIndices = cornerLocalIndicesRaw as number[];

    const mesh = node.getMesh();
    if (!mesh) continue;
    const primitive = mesh.listPrimitives()[0];
    if (!primitive) continue;

    const positionAccessor = primitive.getAttribute("POSITION");
    if (!positionAccessor) continue;
    const positions = positionAccessor.getArray();
    if (!positions) continue;

    const cornerVertexIndices: number[] = [];
    for (const localIdx of cornerLocalIndices) {
      const x = positions[localIdx * 3 + 0];
      const y = positions[localIdx * 3 + 1];
      const z = positions[localIdx * 3 + 2];
      cornerVertexIndices.push(dedupeVertex(globalVertices, x, y, z));
    }

    panels.push({
      id: panelId,
      vertexIndices: cornerVertexIndices,
      shape: shapeForVertexCount(cornerVertexIndices.length),
    });

    const material = primitive.getMaterial();
    if (material) {
      const base = material.getBaseColorFactor() as
        | [number, number, number, number]
        | undefined;
      materials.push({
        panelId,
        materialName: material.getName(),
        baseColorLinear: base ?? [1, 1, 1, 1],
      });
    }
  }

  const edges = buildEdges(panels);

  return {
    topology: { vertices: globalVertices, panels, edges },
    materials,
    document: doc,
  };
}

function dedupeVertex(
  pool: Vector3[],
  x: number,
  y: number,
  z: number,
): number {
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    if (
      Math.abs(p.x - x) < CORNER_DEDUPE_EPSILON &&
      Math.abs(p.y - y) < CORNER_DEDUPE_EPSILON &&
      Math.abs(p.z - z) < CORNER_DEDUPE_EPSILON
    ) {
      return i;
    }
  }
  pool.push(new Vector3(x, y, z));
  return pool.length - 1;
}

function buildEdges(panels: ReadonlyArray<Panel>): PanelEdge[] {
  const edgeMap = new Map<string, PanelEdge>();
  for (const panel of panels) {
    const loop = panel.vertexIndices;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.panelB = panel.id;
      } else {
        edgeMap.set(key, {
          vertexA: Math.min(a, b),
          vertexB: Math.max(a, b),
          panelA: panel.id,
          panelB: null,
        });
      }
    }
  }
  return [...edgeMap.values()];
}
