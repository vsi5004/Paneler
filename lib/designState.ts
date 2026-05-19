// Pure-function helpers for the in-memory PanelColors mirror.
// After the GLB-source-of-truth refactor, the design's persistent state lives
// inside the .glb (materials' baseColorFactor). This file holds the small
// React-state helpers used during a session — apply a color, paint by shape,
// fill unpainted — operating on a `PanelColors` record keyed by panel id.

import type { PanelColors } from "@/lib/types";

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
