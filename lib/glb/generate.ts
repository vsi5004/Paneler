import type { Document } from "@gltf-transform/core";
import {
  presetById,
  resolvePresetParams,
  type PresetParams,
} from "@/lib/topology/presets";
import { subdivideTopology, puffPanels } from "@/lib/mesh/subdivide";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { buildGlbDocument } from "@/lib/glb/build";
import type { PanelColors, PanelTopology } from "@/lib/types";

export const SPHERE_RADIUS = 2;
export const TARGET_TOTAL_TRIANGLES = 30_000;
/** Coarser mesh used while a Shape slider is being dragged. */
export const DRAFT_TOTAL_TRIANGLES = 6_000;
export const PANEL_PUFF = 0.06;

export interface GenerateOptions {
  /** Subdivision budget; defaults to full quality. */
  targetTriangles?: number;
}

function totalFanTriangles(topo: PanelTopology): number {
  return topo.panels.reduce((sum, p) => sum + p.vertexIndices.length, 0);
}

/**
 * Run a preset generator through the full pipeline (topology → subdivide →
 * sphere-project → puff → GLB document) with the given shape param values.
 * Shared by the build-time bake script and the runtime Shape sliders so a
 * regenerated design is bit-compatible with a baked template.
 *
 * The resolved params are embedded in the document's asset extras
 * (`asset.extras.paneler`), which makes the output GLB self-describing: the
 * designer can re-run this with new values, and template defaults are changed
 * by re-baking (or hand-editing) the template GLB.
 */
export function generateTemplateDocument(
  presetId: string,
  params?: PresetParams,
  panelColors?: PanelColors,
  options: GenerateOptions = {},
): Document {
  const preset = presetById(presetId);
  if (!preset) {
    throw new Error(`generateTemplateDocument: unknown preset "${presetId}"`);
  }
  const resolved = resolvePresetParams(preset, params);

  const raw = preset.topology(1, resolved);
  const target = options.targetTriangles ?? TARGET_TOTAL_TRIANGLES;
  const level = Math.max(1, Math.ceil(Math.sqrt(target / totalFanTriangles(raw))));
  const subdivided = subdivideTopology(raw, level);
  projectToSphere(subdivided, SPHERE_RADIUS);
  puffPanels(subdivided, SPHERE_RADIUS, PANEL_PUFF);

  return buildGlbDocument(subdivided, {
    assetName: presetId,
    panelColors,
    design: { presetId, params: resolved },
  });
}
