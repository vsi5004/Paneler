import { describe, expect, it } from "vitest";
import { unfoldNet } from "@/lib/flatten/unfoldNet";
import { PRESETS } from "@/lib/topology/presets";
import { goldberg11 } from "@/lib/topology/goldberg";


function findPreset(id: string) {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown preset: ${id}`);
  return preset;
}

function shoelaceArea(corners: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

describe("unfoldNet", () => {
  it("flattens a tetrahedron: all 4 panels placed with non-degenerate area", () => {
    const topo = findPreset("tetra").topology();
    const layout = unfoldNet(topo);
    expect(layout.size).toBe(topo.panels.length);
    for (const panel of topo.panels) {
      const corners = layout.get(panel.id);
      expect(corners).toBeDefined();
      expect(corners!.length).toBe(panel.vertexIndices.length);
      for (const c of corners!) {
        expect(Number.isFinite(c.x)).toBe(true);
        expect(Number.isFinite(c.y)).toBe(true);
      }
      expect(shoelaceArea(corners!)).toBeGreaterThan(0.01);
    }
  });

  it("flattens a cube: all 6 quad panels placed", () => {
    const topo = findPreset("cube").topology();
    const layout = unfoldNet(topo);
    expect(layout.size).toBe(6);
    for (const corners of layout.values()) {
      expect(corners.length).toBe(4);
      expect(shoelaceArea(corners)).toBeGreaterThan(0.01);
    }
  });

  it("flattens a soccer ball: 32 panels (12 pent + 20 hex), all placed", () => {
    const topo = goldberg11(2.0);
    expect(topo.panels.length).toBe(32);
    const layout = unfoldNet(topo);
    expect(layout.size).toBe(32);
    let pentagons = 0;
    let hexagons = 0;
    for (const panel of topo.panels) {
      const corners = layout.get(panel.id)!;
      if (corners.length === 5) pentagons++;
      if (corners.length === 6) hexagons++;
      expect(shoelaceArea(corners)).toBeGreaterThan(0.01);
    }
    expect(pentagons).toBe(12);
    expect(hexagons).toBe(20);
  });

  it("places every panel at a distinct centroid (no stacked panels)", () => {
    // Sphere unfolding is intrinsically non-developable so adjacent panels
    // can't perfectly share corners (angular defect at every vertex).
    // What we CAN demand: no two panels collapse onto the same spot.
    const topo = goldberg11(2.0);
    const layout = unfoldNet(topo);
    const centroids: { x: number; y: number; id: string }[] = [];
    for (const [id, corners] of layout) {
      let cx = 0;
      let cy = 0;
      for (const c of corners) {
        cx += c.x;
        cy += c.y;
      }
      centroids.push({ x: cx / corners.length, y: cy / corners.length, id });
    }
    for (let i = 0; i < centroids.length; i++) {
      for (let j = i + 1; j < centroids.length; j++) {
        const dx = centroids[i].x - centroids[j].x;
        const dy = centroids[i].y - centroids[j].y;
        const dist = Math.hypot(dx, dy);
        expect(dist).toBeGreaterThan(0.1);
      }
    }
  });

  it("returns empty layout for empty topology", () => {
    const layout = unfoldNet({ vertices: [], panels: [], edges: [] });
    expect(layout.size).toBe(0);
  });
});
