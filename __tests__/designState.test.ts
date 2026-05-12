import { describe, it, expect } from "vitest";
import {
  getPanelShape,
  applyColor,
  resetPanel,
  resetAll,
  applyShapeColor,
  applyColorToUnpainted,
  exportDesign,
  importDesign,
  encodeDesignToHash,
  decodeDesignFromHash,
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

// ---------------------------------------------------------------------------
// exportDesign
// ---------------------------------------------------------------------------
describe("exportDesign", () => {
  it("produces correct structure with version 1", () => {
    const colors = { "panel_001_pentagon": "#ff0000" };
    const result = exportDesign("32", colors);
    expect(result.version).toBe(1);
    expect(result.modelType).toBe("32");
    expect(result.panelColors).toEqual(colors);
  });

  it("is JSON-serializable", () => {
    const result = exportDesign("14", {});
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// importDesign
// ---------------------------------------------------------------------------
describe("importDesign", () => {
  const validJson = JSON.stringify({
    version: 1,
    modelType: "32",
    panelColors: {
      "panel_001_pentagon": "#ff0000",
      "panel_013_hexagon": "#0000ff",
    },
  });

  it("parses a valid design JSON", () => {
    const result = importDesign(validJson);
    expect(result.modelType).toBe("32");
    expect(result.panelColors["panel_001_pentagon"]).toBe("#ff0000");
  });

  it("throws on invalid JSON", () => {
    expect(() => importDesign("not json")).toThrow("Invalid JSON");
  });

  it("throws when version is missing", () => {
    const bad = JSON.stringify({ modelType: "32", panelColors: {} });
    expect(() => importDesign(bad)).toThrow("Unsupported design version");
  });

  it("throws when version is not 1 (strict version check)", () => {
    const bad = JSON.stringify({ version: 2, modelType: "32", panelColors: {} });
    expect(() => importDesign(bad)).toThrow("Unsupported design version: 2");
  });

  it("throws when version is 0 (falsy but wrong)", () => {
    const bad = JSON.stringify({ version: 0, modelType: "32", panelColors: {} });
    expect(() => importDesign(bad)).toThrow("Unsupported design version: 0");
  });

  it("throws when modelType is missing", () => {
    const bad = JSON.stringify({ version: 1, panelColors: {} });
    expect(() => importDesign(bad)).toThrow("Missing or invalid modelType");
  });

  it("throws when panelColors is missing", () => {
    const bad = JSON.stringify({ version: 1, modelType: "32" });
    expect(() => importDesign(bad)).toThrow("Missing panelColors");
  });

  it("strips unknown panel IDs that do not start with panel_", () => {
    const json = JSON.stringify({
      version: 1,
      modelType: "32",
      panelColors: {
        "panel_001_pentagon": "#ff0000",
        "__proto__": "#evil",
        "unknown_key": "#bad",
      },
    });
    const result = importDesign(json);
    expect(Object.keys(result.panelColors)).toEqual(["panel_001_pentagon"]);
  });

  it("preserves known panel colors from a roundtrip export/import", () => {
    const colors = { "panel_001_pentagon": "#aabbcc" };
    const exported = exportDesign("14", colors);
    const imported = importDesign(JSON.stringify(exported));
    expect(imported.panelColors).toEqual(colors);
  });
});

// ---------------------------------------------------------------------------
// encodeDesignToHash / decodeDesignFromHash
// ---------------------------------------------------------------------------
describe("encodeDesignToHash", () => {
  it("produces a string starting with #v1:", () => {
    const design = exportDesign("32", {});
    expect(encodeDesignToHash(design)).toMatch(/^#v1:/);
  });

  it("produces a deterministic output for the same input", () => {
    const design = exportDesign("32", { "panel_001_pentagon": "#ff0000" });
    expect(encodeDesignToHash(design)).toBe(encodeDesignToHash(design));
  });
});

describe("decodeDesignFromHash", () => {
  it("round-trips with encodeDesignToHash", () => {
    const original = exportDesign("32", { "panel_001_pentagon": "#ff0000" });
    const hash = encodeDesignToHash(original);
    const decoded = decodeDesignFromHash(hash);
    expect(decoded.version).toBe(1);
    expect(decoded.modelType).toBe("32");
    expect(decoded.panelColors["panel_001_pentagon"]).toBe("#ff0000");
  });

  it("throws on a hash that does not start with #v1:", () => {
    expect(() => decodeDesignFromHash("#other:abc")).toThrow("Not a valid design share link");
    expect(() => decodeDesignFromHash("")).toThrow("Not a valid design share link");
    expect(() => decodeDesignFromHash(null)).toThrow("Not a valid design share link");
  });

  it("throws on a #v1: hash with invalid base64", () => {
    expect(() => decodeDesignFromHash("#v1:!!!not-base64!!!")).toThrow();
  });

  it("throws when the decoded JSON fails version validation", () => {
    const bad = { version: 2, modelType: "32", panelColors: {} };
    const hash = "#v1:" + btoa(JSON.stringify(bad));
    expect(() => decodeDesignFromHash(hash)).toThrow("Unsupported design version: 2");
  });

  it("strips non-panel keys from decoded panelColors", () => {
    const design = {
      version: 1,
      modelType: "14",
      panelColors: { "panel_001_square": "#ff0000", "bad_key": "#000" },
    };
    const hash = "#v1:" + btoa(JSON.stringify(design));
    const result = decodeDesignFromHash(hash);
    expect(Object.keys(result.panelColors)).toEqual(["panel_001_square"]);
  });

  it("preserves all valid panel colors for a 14-panel design", () => {
    const colors = {
      "panel_001_square": "#ff0000",
      "panel_007_hexagon": "#0000ff",
    };
    const design = exportDesign("14", colors);
    const decoded = decodeDesignFromHash(encodeDesignToHash(design));
    expect(decoded.panelColors).toEqual(colors);
  });
});
