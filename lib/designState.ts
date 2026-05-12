// Pure-function helpers for design state. Ported from Footbag-3D-Visualizer
// (../Footbag-3D-Visualizer/src/components/footbag-designer/designState.ts) so
// the existing Vitest coverage carries forward and the URL-hash share format
// stays compatible with any links already in the wild.

import type { Design, PanelColors } from "@/lib/types";

/**
 * Extract the shape suffix from a panel ID.
 *   "panel_001_pentagon"        → "pentagon"
 *   "panel_013_hexagon_large"   → "hexagon_large"
 */
export function getPanelShape(panelId: string): string {
  const parts = panelId.split("_");
  return parts.slice(2).join("_");
}

export function applyColor(
  panelColors: PanelColors,
  panelId: string,
  color: string,
): PanelColors {
  return { ...panelColors, [panelId]: color };
}

export function resetPanel(
  panelColors: PanelColors,
  panelId: string,
): PanelColors {
  const next = { ...panelColors };
  delete next[panelId];
  return next;
}

export function resetAll(): PanelColors {
  return {};
}

export function applyShapeColor(
  panelColors: PanelColors,
  allPanelIds: string[],
  shape: string,
  color: string,
): PanelColors {
  const next = { ...panelColors };
  for (const id of allPanelIds) {
    if (getPanelShape(id) === shape) {
      next[id] = color;
    }
  }
  return next;
}

export function applyColorToUnpainted(
  panelColors: PanelColors,
  allPanelIds: string[],
  color: string,
): PanelColors {
  const next = { ...panelColors };
  for (const id of allPanelIds) {
    if (!next[id]) {
      next[id] = color;
    }
  }
  return next;
}

export function exportDesign(modelType: string, panelColors: PanelColors): Design {
  return { version: 1, modelType, panelColors };
}

export function importDesign(jsonString: string): Design {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch {
    throw new Error("Invalid JSON");
  }
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid design format");
  }
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`Unsupported design version: ${String(obj.version ?? "missing")}`);
  }
  if (!obj.modelType || typeof obj.modelType !== "string") {
    throw new Error("Missing or invalid modelType");
  }
  if (typeof obj.panelColors !== "object" || obj.panelColors === null) {
    throw new Error("Missing panelColors");
  }

  // Strip non-panel keys defensively.
  const sanitizedColors: PanelColors = {};
  for (const [key, val] of Object.entries(obj.panelColors as Record<string, unknown>)) {
    if (key.startsWith("panel_") && typeof val === "string") {
      sanitizedColors[key] = val;
    }
  }

  return { version: 1, modelType: obj.modelType, panelColors: sanitizedColors };
}

// URL hash format: #v1:<base64-encoded-JSON>. Compatible with the existing
// Footbag-3D-Visualizer share-link encoding so old links keep working.
export function encodeDesignToHash(design: Design): string {
  return "#v1:" + btoa(JSON.stringify(design));
}

export function decodeDesignFromHash(hash: string | null | undefined): Design {
  if (!hash || !hash.startsWith("#v1:")) {
    throw new Error("Not a valid design share link");
  }
  let json: string;
  try {
    json = atob(hash.slice(4));
  } catch {
    throw new Error("Invalid or corrupted share link");
  }
  return importDesign(json);
}
