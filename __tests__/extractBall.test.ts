import { describe, expect, it } from "vitest";
import { generateTemplateDocument } from "@/lib/glb/generate";
import { extractBallTopology } from "@/lib/topology/extractBall";
import { parseDocument } from "@/lib/topology/gltf";

/**
 * In-app import of foreign ball GLBs: a GLB with no panelId structure
 * goes through the same seam-extraction pipeline as the CLI importer.
 * Simulate one by generating a real template and stripping its Paneler
 * identity — what's left is an anonymous per-primitive ball, the shape
 * of a typical artist model export.
 */
function foreignBallDocument(presetId: string) {
  const doc = generateTemplateDocument(presetId);
  for (const node of doc.getRoot().listNodes()) {
    node.setExtras({});
  }
  doc.getRoot().getAsset().extras = {};
  return doc;
}

describe("extractBallTopology", () => {
  it("recovers all 32 soccer panels from a stripped per-primitive GLB", () => {
    const doc = foreignBallDocument("soccer");
    // Sanity: without extras the normal parser finds no panels…
    expect(parseDocument(doc).topology.panels.length).toBe(0);
    // …but extraction rebuilds the full topology.
    const topo = extractBallTopology(doc);
    expect(topo.panels.length).toBe(32);
    const sizes = topo.panels
      .map((p) => p.vertexIndices.length)
      .sort((a, b) => a - b);
    // 12 pentagons + 20 hexagons (boundaries re-densified, so compare
    // by relative size class, not exact counts).
    expect(sizes[0]).toBeLessThan(sizes[31]);
    expect(topo.edges.length).toBeGreaterThan(0);
  });

  it("recovers the trionda's 4 wavy panels", () => {
    const doc = foreignBallDocument("trionda");
    const topo = extractBallTopology(doc);
    expect(topo.panels.length).toBe(4);
  });

  it("rejects a non-ball mesh with a clear reason", () => {
    const doc = foreignBallDocument("soccer");
    // Flatten the ball into a pancake: sphericity must fail.
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        const squashed = Float32Array.from(arr);
        for (let i = 2; i < squashed.length; i += 3) squashed[i] *= 0.1;
        pos.setArray(squashed);
      }
    }
    expect(() => extractBallTopology(doc)).toThrow(/spherical/);
  });
});
