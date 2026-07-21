import { describe, expect, it } from "vitest";

import { baseball } from "@/lib/topology/baseball";
import { presetById, resolvePresetParams } from "@/lib/topology/presets";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { subdivideTopology, puffPanels } from "@/lib/mesh/subdivide";

describe("baseball seam amplitude", () => {
  it("keeps 2 panels with stable ids across amplitudes", () => {
    for (const a of [0, Math.PI / 8, Math.PI / 4, 0.45 * Math.PI]) {
      const t = baseball(1, a);
      expect(t.panels.map((p) => p.id)).toEqual([
        "panel_001_polygon",
        "panel_002_polygon",
      ]);
      // Every seam edge borders both panels.
      for (const e of t.edges) {
        expect(e.panelB).not.toBeNull();
      }
    }
  });

  it("flattens the seam onto the equator at amplitude 0", () => {
    const t = baseball(1, 0);
    for (const v of t.vertices) {
      expect(v.z).toBeCloseTo(0, 12);
      expect(v.length()).toBeCloseTo(1, 12);
    }
  });

  it("reaches ±sin(amplitude) latitude at the wave peaks", () => {
    for (const a of [Math.PI / 8, Math.PI / 4, 0.45 * Math.PI]) {
      const t = baseball(1, a);
      const maxZ = Math.max(...t.vertices.map((v) => v.z));
      const minZ = Math.min(...t.vertices.map((v) => v.z));
      // Peaks fall at longitude π/4 + k·π/2, between the 60 samples — the
      // sampled maximum sits just below the analytic sin(a).
      expect(maxZ).toBeLessThanOrEqual(Math.sin(a) + 1e-12);
      expect(maxZ).toBeGreaterThan(Math.sin(a) * 0.98);
      expect(minZ).toBeCloseTo(-maxZ, 9);
    }
  });

  it("survives the subdivide → project → puff pipeline at the extremes", () => {
    for (const a of [0, 0.45 * Math.PI]) {
      const sub = subdivideTopology(baseball(1, a), 3);
      projectToSphere(sub, 2);
      puffPanels(sub, 2, 0.06);
      expect(sub.panels).toHaveLength(2);
      for (const v of sub.vertices) {
        expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
        expect(v.length()).toBeGreaterThan(1.5); // nothing collapsed to origin
      }
    }
  });

  it("declares the preset param with a 50% default", () => {
    expect(resolvePresetParams(presetById("baseball")!)).toEqual({
      seamAmplitude: 50,
    });
  });
});
