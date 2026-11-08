import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import { icosahedralGroup } from "@/lib/kaleidoscope/groups";
import { frameAt, frameTopology } from "@/lib/kaleidoscope/layout";
import { cachedWarp, kaleidoscopeField, warpPoint } from "@/lib/kaleidoscope/field";
import { kaleidoscopeColors } from "@/lib/kaleidoscope";
import { oklchToHex, schemeAt } from "@/lib/kaleidoscope/color";
import { presetById, resolvePresetParams } from "@/lib/topology/presets";
import { generateTemplateDocument } from "@/lib/glb/generate";
import { parseDocument } from "@/lib/topology/gltf";
import type { PanelTopology } from "@/lib/types";

const kaleidoscope = presetById("kaleidoscope")!;

/** Spherical area of a panel (centroid fan, exact for geodesic edges). */
function panelArea(t: PanelTopology, loop: number[]): number {
  const L = loop.map((i) => t.vertices[i].clone().normalize());
  const c = L.reduce((a, v) => a.clone().add(v), new Vector3()).normalize();
  let A = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i];
    const b = L[(i + 1) % L.length];
    A += 2 * Math.atan2(c.dot(a.clone().cross(b)), 1 + c.dot(a) + a.dot(b) + b.dot(c));
  }
  return A;
}

/** True when a panel's boundary crosses itself (gnomonic projection). */
function selfIntersects(t: PanelTopology, loop: number[]): boolean {
  const L = loop.map((i) => t.vertices[i].clone().normalize());
  const c = L.reduce((a, v) => a.clone().add(v), new Vector3()).normalize();
  const e1 = new Vector3(1, 0, 0).projectOnPlane(c);
  if (e1.lengthSq() < 1e-6) e1.set(0, 1, 0).projectOnPlane(c);
  e1.normalize();
  const e2 = c.clone().cross(e1);
  const P = L.map((v) => {
    const s = v.dot(c);
    return [v.dot(e1) / s, v.dot(e2) / s];
  });
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const n = P.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap
      const [a, b, p, q] = [P[i], P[(i + 1) % n], P[j], P[(j + 1) % n]];
      if (
        cross(a, b, p) * cross(a, b, q) < 0 &&
        cross(p, q, a) * cross(p, q, b) < 0
      ) {
        return true;
      }
    }
  }
  return false;
}

describe("kaleidoscope symmetry group", () => {
  it("is the icosahedral rotation group with its special orbits", () => {
    const g = icosahedralGroup();
    expect(g.elements).toHaveLength(60);
    expect(g.specialOrbits.map((o) => o.length)).toEqual([12, 20, 30]);
    expect(g.colorSubgroup).toHaveLength(12);
    // Every element is a rotation, and the set is closed under composition.
    for (const m of g.elements) expect(m.determinant()).toBeCloseTo(1, 9);
    const same = (a: number[], b: number[]) => a.every((x, k) => Math.abs(x - b[k]) < 1e-9);
    for (const a of g.elements.slice(0, 6)) {
      for (const b of g.elements) {
        const ab = a.clone().multiply(b).elements;
        expect(g.elements.some((m) => same(m.elements, ab))).toBe(true);
      }
    }
  });
});

const TIMES = [0, 7.3, 33, 61.9, 120, 245.5, 999.9];

describe("kaleidoscope layout", () => {
  it.each(TIMES)("t=%s: closed, covers the sphere, no degenerate panels", (time) => {
    const t = frameTopology(frameAt(time));
    expect(t.edges.filter((e) => !e.panelB)).toHaveLength(0);
    const areas = t.panels.map((p) => panelArea(t, p.vertexIndices));
    expect(areas.reduce((a, b) => a + b) / (4 * Math.PI)).toBeCloseTo(1, 6);
    expect(Math.min(...areas)).toBeGreaterThan(0);
  });

  it("changes panel count over time without repeating", () => {
    const counts = new Set<number>();
    const signatures = new Set<string>();
    for (let time = 0; time < 600; time += 10) {
      const f = frameAt(time);
      counts.add(f.cells.filter((c) => c.length >= 3).length);
      signatures.add(f.seeds.slice(-1)[0].toArray().map((x) => x.toFixed(6)).join());
    }
    expect(counts.size).toBeGreaterThan(4);
    expect(signatures.size).toBe(60);
  });

  it("keeps a panel's id while it lives", () => {
    const a = new Set(frameTopology(frameAt(50)).panels.map((p) => p.id));
    const b = frameTopology(frameAt(50.2)).panels.map((p) => p.id);
    // A fifth of a time unit later, nearly every panel is the same one.
    expect(b.filter((id) => a.has(id)).length).toBeGreaterThan(0.9 * b.length);
  });

  it("colors follow the drifting scheme by role, focal panels highlighted", () => {
    const t = frameTopology(frameAt(30));
    const scheme = schemeAt(30);
    const colors = kaleidoscopeColors(t, { time: 30 });
    const allowed = new Set([...scheme.body, scheme.highlight]);
    for (const p of t.panels) expect(allowed.has(colors[p.id])).toBe(true);
    const focal = t.panels.filter((p) => p.id.endsWith("_axis5"));
    expect(focal).toHaveLength(12);
    for (const p of focal) expect(colors[p.id]).toBe(scheme.highlight);
  });
});

describe("kaleidoscope colors", () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  it("converts OKLCH to sRGB", () => {
    expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
    expect(oklchToHex(0, 0, 0)).toBe("#000000");
    // Out-of-gamut chroma is reduced, not clipped per channel.
    expect(oklchToHex(0.5, 1, 140)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("changes gradually: small time steps make small color steps", () => {
    for (let time = 0; time < 300; time += 7.7) {
      const a = schemeAt(time);
      const b = schemeAt(time + 0.1);
      [...a.body, a.highlight].forEach((c, i) => {
        const d = rgb(c).map((x, k) => Math.abs(x - rgb([...b.body, b.highlight][i])[k]));
        expect(Math.max(...d)).toBeLessThan(8);
      });
    }
  });

  it("keeps the body colors' lightness order (dark, mid, light)", () => {
    const lum = (hex: string) => rgb(hex).reduce((s, x, k) => s + x * [0.2126, 0.7152, 0.0722][k], 0);
    for (let time = 0; time < 300; time += 11) {
      const { body, highlight } = schemeAt(time);
      expect(lum(body[0])).toBeLessThan(lum(body[1]));
      expect(lum(body[1])).toBeLessThan(lum(body[2]));
      expect(lum(body[2])).toBeLessThan(lum(highlight));
    }
  });
});

describe("kaleidoscope warp", () => {
  const group = icosahedralGroup();
  const field = kaleidoscopeField(1, 21.4);

  it("is rotation-equivariant: W(g·x) = g·W(x)", () => {
    const x = new Vector3(0.3, -0.5, 0.81).normalize();
    const wx = x.clone();
    warpPoint(wx, field);
    for (const g of group.elements.slice(0, 12)) {
      const lhs = x.clone().applyMatrix3(g);
      warpPoint(lhs, field);
      expect(lhs.distanceTo(wx.clone().applyMatrix3(g))).toBeLessThan(1e-6);
    }
  });

  it("cached warp matches the direct warp and keeps vertex length", () => {
    const warp = cachedWarp(group, field);
    const t = frameTopology(frameAt(21.4), 2);
    for (const v of t.vertices) {
      const a = v.clone().multiplyScalar(1.03);
      const b = a.clone();
      warp(a);
      warpPoint(b, field);
      expect(a.distanceTo(b)).toBeLessThan(1e-6);
      expect(a.length()).toBeCloseTo(2 * 1.03, 9);
    }
  });

  it("never folds: warped panel boundaries stay simple at full Flow", () => {
    for (let time = 0; time < 400; time += 13.7) {
      const params = resolvePresetParams(kaleidoscope, { time, flow: 100 });
      const t = kaleidoscope.topology(1, params);
      const warp = kaleidoscope.warp!(params)!;
      for (const v of t.vertices) warp(v);
      for (const p of t.panels) expect(selfIntersects(t, p.vertexIndices)).toBe(false);
      const areas = t.panels.map((p) => panelArea(t, p.vertexIndices));
      expect(areas.reduce((a, b) => a + b) / (4 * Math.PI)).toBeCloseTo(1, 2);
    }
  });
});

describe("kaleidoscope preset", () => {
  it("generates a GLB whose params round-trip through the asset extras", () => {
    const doc = generateTemplateDocument("kaleidoscope", { time: 12.3, flow: 40 });
    const parsed = parseDocument(doc);
    expect(parsed.topology.panels.length).toBe(frameTopology(frameAt(12.3)).panels.length);
    expect(parsed.design?.presetId).toBe("kaleidoscope");
    expect(parsed.design?.params.time).toBeCloseTo(12.3, 9);
    expect(parsed.design?.params.flow).toBe(40);
  });
});
