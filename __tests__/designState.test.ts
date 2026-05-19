import { describe, it, expect } from "vitest";
import {
  getPanelShape,
  applyColor,
  resetPanel,
  resetAll,
  applyShapeColor,
  applyColorToUnpainted,
} from "@/lib/designState";

// ---------------------------------------------------------------------------
// getPanelShape
// ---------------------------------------------------------------------------
describe("getPanelShape", () => {
  it("extracts single-word shapes", () => {
    expect(getPanelShape("panel_001_pentagon")).toBe("pentagon");
    expect(getPanelShape("panel_007_hexagon")).toBe("hexagon");
    expect(getPanelShape("panel_003_square")).toBe("square");
  });

  it("handles compound shape names like hexagon_large", () => {
    expect(getPanelShape("panel_013_hexagon_large")).toBe("hexagon_large");
  });
});

// ---------------------------------------------------------------------------
// applyColor
// ---------------------------------------------------------------------------
describe("applyColor", () => {
  it("adds a color entry without mutating the original", () => {
    const original: Record<string, string> = { "panel_001_pentagon": "#ff0000" };
    const result = applyColor(original, "panel_002_pentagon", "#0000ff");
    expect(result["panel_002_pentagon"]).toBe("#0000ff");
    expect(original["panel_002_pentagon"]).toBeUndefined();
  });

  it("overwrites an existing color", () => {
    const colors = { "panel_001_pentagon": "#ff0000" };
    const result = applyColor(colors, "panel_001_pentagon", "#00ff00");
    expect(result["panel_001_pentagon"]).toBe("#00ff00");
  });
});

// ---------------------------------------------------------------------------
// resetPanel
// ---------------------------------------------------------------------------
describe("resetPanel", () => {
  it("removes the panel color entry without mutating original", () => {
    const colors = { "panel_001_pentagon": "#ff0000", "panel_002_pentagon": "#0000ff" };
    const result = resetPanel(colors, "panel_001_pentagon");
    expect(result["panel_001_pentagon"]).toBeUndefined();
    expect(result["panel_002_pentagon"]).toBe("#0000ff");
    expect(colors["panel_001_pentagon"]).toBe("#ff0000");
  });

  it("is a no-op for panels that have no color set", () => {
    const colors = { "panel_001_pentagon": "#ff0000" };
    const result = resetPanel(colors, "panel_099_hexagon");
    expect(result).toEqual(colors);
  });
});

// ---------------------------------------------------------------------------
// resetAll
// ---------------------------------------------------------------------------
describe("resetAll", () => {
  it("returns an empty object", () => {
    expect(resetAll()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// applyShapeColor
// ---------------------------------------------------------------------------
describe("applyShapeColor", () => {
  const allPanelIds = [
    "panel_001_pentagon",
    "panel_002_pentagon",
    "panel_013_hexagon",
    "panel_014_hexagon",
  ];

  it("colors only panels with the given shape", () => {
    const result = applyShapeColor({}, allPanelIds, "pentagon", "#ff0000");
    expect(result["panel_001_pentagon"]).toBe("#ff0000");
    expect(result["panel_002_pentagon"]).toBe("#ff0000");
    expect(result["panel_013_hexagon"]).toBeUndefined();
  });

  it("does not overwrite other panel colors", () => {
    const existing = { "panel_013_hexagon": "#0000ff" };
    const result = applyShapeColor(existing, allPanelIds, "pentagon", "#ff0000");
    expect(result["panel_013_hexagon"]).toBe("#0000ff");
  });

  it("handles compound shape names like hexagon_large", () => {
    const panels = ["panel_001_hexagon_large", "panel_002_hexagon", "panel_003_hexagon_large"];
    const result = applyShapeColor({}, panels, "hexagon_large", "#aabbcc");
    expect(result["panel_001_hexagon_large"]).toBe("#aabbcc");
    expect(result["panel_003_hexagon_large"]).toBe("#aabbcc");
    expect(result["panel_002_hexagon"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyColorToUnpainted
// ---------------------------------------------------------------------------
describe("applyColorToUnpainted", () => {
  it("only paints panels with no color set", () => {
    const existing = { "panel_001_pentagon": "#ff0000" };
    const all = ["panel_001_pentagon", "panel_002_pentagon", "panel_013_hexagon"];
    const result = applyColorToUnpainted(existing, all, "#cccccc");
    expect(result["panel_001_pentagon"]).toBe("#ff0000");
    expect(result["panel_002_pentagon"]).toBe("#cccccc");
    expect(result["panel_013_hexagon"]).toBe("#cccccc");
  });
});

