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

/**
 * Several panels selected to paint together: every panel of one shape (with
 * that shape's label) or panels shift-clicked one by one (label null).
 */
export interface PanelSelection {
  label: string | null;
  panelIds: string[];
}

/**
 * Shift-click: add the panel to the selection, or take it out if it is in.
 * The panel already selected by a plain click joins, since it is highlighted
 * too. Once changed by hand it is no longer "all hexagons", so the label
 * goes. An emptied selection is no selection.
 */
export function togglePanel(
  selection: PanelSelection | null,
  singleSelected: string | null,
  panelId: string,
): PanelSelection | null {
  const ids = selection?.panelIds ?? (singleSelected ? [singleSelected] : []);
  const next = ids.includes(panelId) ? ids.filter((id) => id !== panelId) : [...ids, panelId];
  return next.length === 0 ? null : { label: null, panelIds: next };
}

/** Paint several panels at once: a selected shape or shift-clicked panels. */
export function applyColorToPanels(
  panelColors: PanelColors,
  panelIds: readonly string[],
  color: string,
): PanelColors {
  const next = { ...panelColors };
  for (const id of panelIds) next[id] = color;
  return next;
}

/**
 * Undo: put back every color an earlier state had. Painting never removes a
 * panel's color, so this restores it exactly; a panel added since (a slider
 * that changes the panel count) keeps its color instead of going blank.
 */
export function restoreColors(current: PanelColors, earlier: PanelColors): PanelColors {
  return { ...current, ...earlier };
}

/** Whether two color maps paint every panel alike, so a no-op click adds no undo step. */
export function sameColors(a: PanelColors, b: PanelColors): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
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
