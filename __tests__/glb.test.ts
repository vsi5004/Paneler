import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseGlb } from "@/lib/topology/gltf";
import {
  buildGlbDocument,
  hexToLinearRgba,
  linearRgbaToHex,
} from "@/lib/glb/build";
import { setMaterialColor, serializeDocument } from "@/lib/glb/mutate";
import { subdivideTopology } from "@/lib/mesh/subdivide";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { cube, icosahedron } from "@/lib/topology/presets";

const PRESETS_DIR = join(process.cwd(), "public", "presets");

async function loadTemplate(slug: string) {
  const bytes = await readFile(join(PRESETS_DIR, `${slug}.glb`));
  return new Uint8Array(bytes);
}

describe("parseGlb", () => {
  it("recovers panel count and shapes from a baked cube template", async () => {
    const bytes = await loadTemplate("cube");
    const parsed = await parseGlb(bytes);
    expect(parsed.topology.panels).toHaveLength(6);
    expect(parsed.topology.panels.every((p) => p.shape === "quad")).toBe(true);
  });

  it("recovers panel count and shapes from a baked icosa template", async () => {
    const bytes = await loadTemplate("icosa");
    const parsed = await parseGlb(bytes);
    expect(parsed.topology.panels).toHaveLength(20);
    expect(parsed.topology.panels.every((p) => p.shape === "triangle")).toBe(true);
  });

  it("dedupes seam corners across panels for the cube", async () => {
    const bytes = await loadTemplate("cube");
    const parsed = await parseGlb(bytes);
    // A cube has 8 unique corners shared across 6 quad faces.
    expect(parsed.topology.vertices).toHaveLength(8);
  });

  it("builds edges that connect adjacent panels", async () => {
    const bytes = await loadTemplate("cube");
    const parsed = await parseGlb(bytes);
    // Every cube edge is shared by exactly 2 faces.
    expect(parsed.topology.edges).toHaveLength(12);
    expect(parsed.topology.edges.every((e) => e.panelB !== null)).toBe(true);
  });

  it("exposes one material per panel with default base color", async () => {
    const bytes = await loadTemplate("cube");
    const parsed = await parseGlb(bytes);
    expect(parsed.materials).toHaveLength(6);
    for (const mat of parsed.materials) {
      expect(mat.materialName).toBe(`${mat.panelId}_mat`);
    }
  });
});

describe("buildGlbDocument round-trip", () => {
  it("preserves panel count and corner positions through bake → parse", async () => {
    const raw = icosahedron();
    const sub = subdivideTopology(raw, 2);
    projectToSphere(sub, 2);
    const doc = buildGlbDocument(sub, { assetName: "test-icosa" });

    // Serialize + reparse to make sure we go through the full bytes round-trip.
    const bytes = await serializeDocument(doc);
    const parsed = await parseGlb(bytes);

    expect(parsed.topology.panels).toHaveLength(sub.panels.length);
    expect(parsed.topology.vertices).toHaveLength(raw.vertices.length); // 12 corners on icosahedron
  });

  it("sets panel colors via baseColorFactor", async () => {
    const raw = cube();
    const sub = subdivideTopology(raw, 1);
    projectToSphere(sub, 1);
    const doc = buildGlbDocument(sub, {
      panelColors: { [sub.panels[0].id]: "#ff0033" },
    });
    const bytes = await serializeDocument(doc);
    const parsed = await parseGlb(bytes);
    const target = parsed.materials.find((m) => m.panelId === sub.panels[0].id);
    expect(target).toBeDefined();
    expect(linearRgbaToHex(target!.baseColorLinear)).toBe("#ff0033");
  });
});

describe("setMaterialColor", () => {
  it("mutates a panel's baseColorFactor without disturbing others", async () => {
    const bytes = await loadTemplate("cube");
    const parsed = await parseGlb(bytes);
    const target = parsed.topology.panels[0].id;
    setMaterialColor(parsed.document, target, "#33aa55");
    const round = await parseGlb(await serializeDocument(parsed.document));
    const mutated = round.materials.find((m) => m.panelId === target)!;
    expect(linearRgbaToHex(mutated.baseColorLinear)).toBe("#33aa55");
    for (const m of round.materials) {
      if (m.panelId === target) continue;
      // Untouched panels still hold the default off-white (linear 0.92 → sRGB 0xf6).
      expect(linearRgbaToHex(m.baseColorLinear)).toBe("#f6f6f6");
    }
  });
});

describe("hex linear round-trip", () => {
  it("survives a sRGB → linear → sRGB cycle within ±1 unit", () => {
    for (const hex of ["#000000", "#ffffff", "#ff0033", "#33aa55", "#888888"]) {
      expect(linearRgbaToHex(hexToLinearRgba(hex))).toBe(hex);
    }
  });
});
