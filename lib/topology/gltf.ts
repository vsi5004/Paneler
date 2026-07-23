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
  /**
   * Contents of `asset.extras.paneler`. `presetId` + `params` are preset
   * provenance (drive the Shape sliders; absent for custom Blender-exported
   * GLBs). `laser` is the user's laser-template settings — it can exist with
   * or without preset provenance, since templates derive from topology.
   */
  design?: {
    presetId?: string;
    params: Record<string, number>;
    laser?: {
      diameterIn: number;
      biteDepthMm: number;
      curvaturePct: number;
      showHoles: boolean;
      holeSpacingMm: number;
      cornerMarginMm: number;
    };
  };
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
    design: parseDesignExtras(doc),
  };
}

/**
 * Read `asset.extras.paneler` defensively — hand-edited GLBs may hold junk.
 * Returns an object when the extras carry EITHER preset provenance OR a
 * valid laser block (a Blender import with saved laser settings has no
 * presetId); undefined when neither is present.
 */
function parseDesignExtras(
  doc: Document,
): ParsedGlb["design"] {
  const extras = doc.getRoot().getAsset().extras;
  if (typeof extras !== "object" || extras === null) return undefined;
  const paneler = (extras as Record<string, unknown>).paneler;
  if (typeof paneler !== "object" || paneler === null) return undefined;
  const { presetId, params, laser } = paneler as Record<string, unknown>;

  const cleanParams: Record<string, number> = {};
  if (typeof params === "object" && params !== null) {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        cleanParams[key] = value;
      }
    }
  }

  let cleanLaser:
    | {
        diameterIn: number;
        biteDepthMm: number;
        curvaturePct: number;
        showHoles: boolean;
        holeSpacingMm: number;
        cornerMarginMm: number;
      }
    | undefined;
  if (typeof laser === "object" && laser !== null) {
    const {
      diameterIn,
      biteDepthMm,
      curvaturePct,
      showHoles,
      holeSpacingMm,
      cornerMarginMm,
    } = laser as Record<string, unknown>;
    if (
      typeof diameterIn === "number" &&
      Number.isFinite(diameterIn) &&
      typeof biteDepthMm === "number" &&
      Number.isFinite(biteDepthMm)
    ) {
      cleanLaser = {
        diameterIn,
        biteDepthMm,
        // Added after the first laser release — backfill for GLBs saved
        // without it.
        curvaturePct:
          typeof curvaturePct === "number" && Number.isFinite(curvaturePct)
            ? curvaturePct
            : 100,
        // Backfills for GLBs saved before each field existed.
        showHoles: typeof showHoles === "boolean" ? showHoles : true,
        holeSpacingMm:
          typeof holeSpacingMm === "number" && Number.isFinite(holeSpacingMm)
            ? holeSpacingMm
            : 2.5,
        cornerMarginMm:
          typeof cornerMarginMm === "number" && Number.isFinite(cornerMarginMm)
            ? cornerMarginMm
            : 0,
      };
    }
  }

  const cleanPresetId = typeof presetId === "string" ? presetId : undefined;
  if (cleanPresetId === undefined && cleanLaser === undefined) {
    return undefined;
  }
  return { presetId: cleanPresetId, params: cleanParams, laser: cleanLaser };
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
