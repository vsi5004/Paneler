import { describe, expect, it } from "vitest";

import { parseGlb } from "@/lib/topology/gltf";
import { buildGlbDocument } from "@/lib/glb/build";
import {
  serializeDocument,
  setLaserExtras,
  setMaterialColor,
} from "@/lib/glb/mutate";
import { generateTemplateDocument } from "@/lib/glb/generate";
import { subdivideTopology } from "@/lib/mesh/subdivide";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { cube } from "@/lib/topology/presets";

const LASER = { diameterIn: 2.1, biteDepthMm: 1.5, curvaturePct: 80 };

function bareCubeDoc() {
  const sub = subdivideTopology(cube(), 1);
  projectToSphere(sub, 1);
  return buildGlbDocument(sub, { assetName: "cube" });
}

describe("laser settings persistence", () => {
  it("round-trips laser settings on a preset design", async () => {
    const doc = generateTemplateDocument("cubocta", { shortEdge: 30 });
    setLaserExtras(doc, LASER);
    const parsed = await parseGlb(await serializeDocument(doc));
    expect(parsed.design?.laser).toEqual(LASER);
    // Preset provenance untouched.
    expect(parsed.design?.presetId).toBe("cubocta");
    expect(parsed.design?.params).toEqual({ shortEdge: 30 });
  });

  it("persists laser-only extras on designs without preset provenance", async () => {
    const doc = bareCubeDoc();
    setLaserExtras(doc, LASER);
    const parsed = await parseGlb(await serializeDocument(doc));
    expect(parsed.design?.laser).toEqual(LASER);
    expect(parsed.design?.presetId).toBeUndefined();
  });

  it("survives color mutation + re-serialize (the save path)", async () => {
    const doc = generateTemplateDocument("soccer");
    setLaserExtras(doc, LASER);
    const first = await parseGlb(await serializeDocument(doc));
    setMaterialColor(first.document, first.topology.panels[0].id, "#ff0033");
    const round = await parseGlb(await serializeDocument(first.document));
    expect(round.design?.laser).toEqual(LASER);
  });

  it("regen path preserves laser settings when re-applied to a fresh doc", async () => {
    // Mirrors applyGenerated: a fresh document from the generator carries
    // only preset extras; setLaserExtras must merge without clobbering.
    const doc = generateTemplateDocument("cubocta", { shortEdge: 55 });
    setLaserExtras(doc, LASER);
    const parsed = await parseGlb(await serializeDocument(doc));
    expect(parsed.design).toEqual({
      presetId: "cubocta",
      params: { shortEdge: 55 },
      laser: LASER,
    });
  });

  it("leaves legacy preset-only extras working unchanged", async () => {
    const doc = generateTemplateDocument("cubocta", { shortEdge: 20 });
    const parsed = await parseGlb(await serializeDocument(doc));
    expect(parsed.design?.presetId).toBe("cubocta");
    expect(parsed.design?.laser).toBeUndefined();
  });

  it("backfills curvaturePct=100 for pre-curvature GLBs", async () => {
    const doc = bareCubeDoc();
    const asset = doc.getRoot().getAsset();
    asset.extras = {
      paneler: { version: 1, laser: { diameterIn: 1.9, biteDepthMm: 2 } },
    };
    const parsed = await parseGlb(await serializeDocument(doc));
    expect(parsed.design?.laser).toEqual({
      diameterIn: 1.9,
      biteDepthMm: 2,
      curvaturePct: 100,
    });
  });

  it("ignores junk laser extras", async () => {
    const doc = bareCubeDoc();
    const asset = doc.getRoot().getAsset();
    asset.extras = { paneler: { version: 1, laser: { diameterIn: "big" } } };
    const parsed = await parseGlb(await serializeDocument(doc));
    expect(parsed.design).toBeUndefined();
  });
});
