import { describe, expect, it } from "vitest";
import { flattenPanelUnscaled, unfoldNet } from "@/lib/flatten/unfoldNet";
import { PRESETS } from "@/lib/topology/presets";
import { baseball } from "@/lib/topology/baseball";
import { goldberg11 } from "@/lib/topology/goldberg";


function findPreset(id: string) {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown preset: ${id}`);
  return preset;
}

function avgSagitta(layout: Map<string, { sagittaRatios: number[] }>): number {
  let total = 0;
  let count = 0;
  for (const flat of layout.values()) {
    for (const r of flat.sagittaRatios) {
      total += r;
      count++;
    }
  }
  return count === 0 ? 0 : total / count;
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
      const flat = layout.get(panel.id);
      expect(flat).toBeDefined();
      expect(flat!.corners.length).toBe(panel.vertexIndices.length);
      expect(flat!.sagittaRatios.length).toBe(panel.vertexIndices.length);
      for (const c of flat!.corners) {
        expect(Number.isFinite(c.x)).toBe(true);
        expect(Number.isFinite(c.y)).toBe(true);
      }
      for (const r of flat!.sagittaRatios) {
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(0);
      }
      expect(shoelaceArea(flat!.corners)).toBeGreaterThan(0.01);
    }
  });

  it("flattens a cube: all 6 quad panels placed", () => {
    const topo = findPreset("cube").topology();
    const layout = unfoldNet(topo);
    expect(layout.size).toBe(6);
    for (const flat of layout.values()) {
      expect(flat.corners.length).toBe(4);
      expect(shoelaceArea(flat.corners)).toBeGreaterThan(0.01);
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
      const flat = layout.get(panel.id)!;
      if (flat.corners.length === 5) pentagons++;
      if (flat.corners.length === 6) hexagons++;
      expect(shoelaceArea(flat.corners)).toBeGreaterThan(0.01);
    }
    expect(pentagons).toBe(12);
    expect(hexagons).toBe(20);
  });

  it("computes larger sagitta ratios for big-faced shapes than for small-faced ones", () => {
    // Tetrahedron faces cover ~1/4 of the sphere each → big bulge.
    // 32-panel soccer ball faces are tiny in comparison.
    const tetra = findPreset("tetra").topology();
    const ball = goldberg11(2.0);
    const tetraFlat = unfoldNet(tetra);
    const ballFlat = unfoldNet(ball);
    const tetraAvgRatio = avgSagitta(tetraFlat);
    const ballAvgRatio = avgSagitta(ballFlat);
    expect(tetraAvgRatio).toBeGreaterThan(ballAvgRatio * 3);
  });

  it("places every panel at a distinct centroid (no stacked panels)", () => {
    // Sphere unfolding is intrinsically non-developable so adjacent panels
    // can't perfectly share corners (angular defect at every vertex).
    // What we CAN demand: no two panels collapse onto the same spot.
    const topo = goldberg11(2.0);
    const layout = unfoldNet(topo);
    const centroids: { x: number; y: number; id: string }[] = [];
    for (const [id, flat] of layout) {
      let cx = 0;
      let cy = 0;
      for (const c of flat.corners) {
        cx += c.x;
        cy += c.y;
      }
      centroids.push({
        x: cx / flat.corners.length,
        y: cy / flat.corners.length,
        id,
      });
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

  it("flattened panels carry exactly the 720deg Descartes deficit", () => {
    // For any correct closed unwrap, the flat corner angles meeting at
    // each assembled vertex must fall short of 360deg by a total of
    // exactly 720deg across the ball (Descartes / Gauss-Bonnet). This
    // pins the flatten end-to-end: orientation, corner ordering, and
    // vertex identification all have to be right to land on 720.
    for (const preset of PRESETS) {
      const topo = preset.topology(2);
      const angleAt = new Map<number, number>();
      for (const panel of topo.panels) {
        const flat = flattenPanelUnscaled(panel, topo);
        const c = flat.corners;
        const n = c.length;
        let area = 0;
        for (let i = 0; i < n; i++) {
          const a = c[i];
          const b = c[(i + 1) % n];
          area += a.x * b.y - b.x * a.y;
        }
        const ccw = area > 0;
        for (let i = 0; i < n; i++) {
          const prev = c[(i - 1 + n) % n];
          const cur = c[i];
          const next = c[(i + 1) % n];
          const inDir = Math.atan2(cur.y - prev.y, cur.x - prev.x);
          const outDir = Math.atan2(next.y - cur.y, next.x - cur.x);
          let turn = outDir - inDir;
          while (turn > Math.PI) turn -= 2 * Math.PI;
          while (turn < -Math.PI) turn += 2 * Math.PI;
          const interior = 180 - ((ccw ? turn : -turn) * 180) / Math.PI;
          const vi = panel.vertexIndices[i];
          angleAt.set(vi, (angleAt.get(vi) ?? 0) + interior);
        }
      }
      let total = 0;
      for (const [, sum] of angleAt) total += 360 - sum;
      expect(Math.abs(total - 720)).toBeLessThan(0.5);
    }
  });

  it("gives full-wrap panels (Baseball) a non-degenerate outline", () => {
    // The baseball seam wraps the whole sphere, so the naive boundary mean
    // collapses to ~0 — without the signed-area fallback both panels
    // flatten to a single point and the viewBox degenerates (which also
    // blew up the designer's page layout).
    const layout = unfoldNet(baseball());
    expect(layout.size).toBe(2);
    for (const flat of layout.values()) {
      const xs = flat.corners.map((c) => c.x);
      const ys = flat.corners.map((c) => c.y);
      const xExt = Math.max(...xs) - Math.min(...xs);
      const yExt = Math.max(...ys) - Math.min(...ys);
      // Non-degenerate in absolute terms and not collapsed to a line.
      expect(Math.max(xExt, yExt)).toBeGreaterThan(0.01);
      expect(Math.min(xExt, yExt)).toBeGreaterThan(0.1 * Math.max(xExt, yExt));
      // Spine-unrolled wrap-around panels read as elongated dog-bones.
      expect(Math.max(xExt, yExt) / Math.min(xExt, yExt)).toBeGreaterThan(2);
    }
  });
});
