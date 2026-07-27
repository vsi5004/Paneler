import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { flattenPanelUnscaled, unfoldNet } from "@/lib/flatten/unfoldNet";
import { arapFlattenMesh } from "@/lib/flatten/arap";
import { PRESETS, resolvePresetParams } from "@/lib/topology/presets";
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

  // Per-preset strain bounds: many-panel balls flatten with a couple
  // percent of ease; the Spiral's two half-sphere bands are inherently
  // the least developable shape going (mildest twist ~= a hemisphere)
  // and carry more — like a real baseball cover.
  it.each([
    ["trionda", undefined, 0.03, 0.15],
    ["teamgeist", undefined, 0.03, 0.15],
    ["orbita", undefined, 0.03, 0.15],
    // full-winding bands exercise the BFS hinge-unfold ARAP init
    ["spiral", undefined, 0.08, 0.35],
    ["spiral", { twist: 250 }, 0.05, 0.3],
    // half-sphere lobed panels, also ARAP + hinge-unfold now
    ["baseball", undefined, 0.1, 0.6],
  ] as const)(
    "re-wrap: flat %s panels lie back on the sphere with small smooth strain (%o)",
    (presetId, params, rmsBound, maxBound) => {
      // The direct check that the unwrap is correct: every flat point has a
      // known 3D mate, so per-triangle principal stretches of the map
      // FLAT -> SPHERE measure exactly how much the cut fabric must stretch
      // to wrap back into the ball. A correct low-distortion unwrap means
      // no fold-overs, a few percent stretch at worst, ~1-2% typical (the
      // sewing ease). The rejected Lambert flatten measures 19% RMS / 58%
      // max on the same meshes — the physical "panels don't line up".
      const preset = PRESETS.find((p) => p.id === presetId)!;
      const topo = preset.topology(
        2,
        params ? resolvePresetParams(preset, { ...params }) : undefined,
      );
      for (const panel of topo.panels) {
        const mesh = arapFlattenMesh(panel, topo)!;
        expect(mesh).not.toBeNull();
        const { flat, positions3D, triangles } = mesh;
        const strains: number[] = [];
        let pos = 0;
        let neg = 0;
        for (const [a, b, c] of triangles) {
          const e1f = { x: flat[b].x - flat[a].x, y: flat[b].y - flat[a].y };
          const e2f = { x: flat[c].x - flat[a].x, y: flat[c].y - flat[a].y };
          const AB = positions3D[b].clone().sub(positions3D[a]);
          const AC = positions3D[c].clone().sub(positions3D[a]);
          const X = AB.clone().normalize();
          const Zv = new Vector3().crossVectors(AB, AC);
          const Y = new Vector3().crossVectors(Zv, AB).normalize();
          const e1t = { x: AB.length(), y: 0 };
          const e2t = { x: AC.dot(X), y: AC.dot(Y) };
          const det = e1f.x * e2f.y - e1f.y * e2f.x;
          expect(det).not.toBe(0);
          const inv = [e2f.y / det, -e2f.x / det, -e1f.y / det, e1f.x / det];
          const F = [
            e1t.x * inv[0] + e2t.x * inv[2],
            e1t.x * inv[1] + e2t.x * inv[3],
            e1t.y * inv[0] + e2t.y * inv[2],
            e1t.y * inv[1] + e2t.y * inv[3],
          ];
          const detF = F[0] * F[3] - F[1] * F[2];
          if (detF > 0) pos++;
          else neg++;
          const E = (F[0] ** 2 + F[1] ** 2 + F[2] ** 2 + F[3] ** 2) / 2;
          const D = Math.sqrt(Math.max(0, E * E - detF * detF));
          strains.push(
            Math.abs(Math.sqrt(E + D) - 1),
            Math.abs(Math.sqrt(Math.max(0, E - D)) - 1),
          );
        }
        // No local fold-overs: the SVG y-flip mirrors every triangle the
        // same way, so orientation must be uniform across the panel.
        expect(Math.min(pos, neg)).toBe(0);
        const rms = Math.sqrt(
          strains.reduce((s, x) => s + x * x, 0) / strains.length,
        );
        expect(rms).toBeLessThan(rmsBound);
        expect(Math.max(...strains)).toBeLessThan(maxBound);
      }
    },
  );

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
      // ARAP-flattened wrap-around panels read as elongated dog-bones.
      // (The retired spine-unroll measured >2, but it was stretching the
      // sides by up to 59% of perimeter; ARAP's honest development is a
      // little fatter.)
      expect(Math.max(xExt, yExt) / Math.min(xExt, yExt)).toBeGreaterThan(1.5);
    }
  });
});
