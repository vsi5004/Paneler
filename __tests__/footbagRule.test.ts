import { describe, expect, it } from "vitest";

import { presetById, resolvePresetParams } from "@/lib/topology/presets";
import { groupPanelsByCongruence } from "@/lib/laser/congruence";
import type { PanelTopology } from "@/lib/types";

const DEG = 180 / Math.PI;

/** Corners of a panel loop that are real corners (direction changes), skipping densified seam points. */
function corners(t: PanelTopology, loop: number[]): number[] {
  return loop.filter((v, i) => {
    const a = t.vertices[loop[(i + loop.length - 1) % loop.length]].clone().normalize();
    const p = t.vertices[v].clone().normalize();
    const b = t.vertices[loop[(i + 1) % loop.length]].clone().normalize();
    // On one great arc → a, p, b coplanar with the centre.
    return Math.abs(a.clone().cross(b).dot(p)) > 1e-9;
  });
}

function angleAt(t: PanelTopology, loop: number[], i: number): number {
  const v = t.vertices[loop[i]].clone().normalize();
  const tan = (j: number) => {
    const p = t.vertices[loop[(j + loop.length) % loop.length]].clone().normalize();
    return p.sub(v.clone().multiplyScalar(p.dot(v)));
  };
  return tan(i - 1).angleTo(tan(i + 1)) * DEG;
}

/** Signed turn at each corner (+ = left, seen from outside); all + means convex. */
function turnSign(t: PanelTopology, loop: number[], i: number): number {
  const p = (j: number) => t.vertices[loop[(j + loop.length) % loop.length]].clone().normalize();
  return Math.sign(p(i).clone().sub(p(i - 1)).cross(p(i + 1).clone().sub(p(i))).dot(p(i)));
}

const uses = (t: PanelTopology) => {
  const m = new Map<number, number>();
  for (const p of t.panels) for (const v of p.vertexIndices) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
};

interface Spec {
  id: string;
  /** Slider keys and the panel shapes they size. */
  keys: string[];
  fillers: number;
  mains: Record<number, number>;
}

const SPECS: Spec[] = [
  { id: "hexcap38", keys: ["pentSize", "hexSize"], fillers: 24, mains: { 5: 12, 6: 2 } },
  { id: "cubecorner38", keys: ["squareSize", "hexSize"], fillers: 24, mains: { 4: 6, 6: 8 } },
  { id: "starbag", keys: ["hexSize"], fillers: 12, mains: { 6: 20 } },
];

describe.each(SPECS)("$id", ({ id, keys, fillers, mains }) => {
  const preset = presetById(id)!;
  const isFiller = preset.laserHoleCount!.isFiller;
  // Every corner of the slider box, plus the default.
  const box: Record<string, number>[] = [{}];
  for (const key of keys) {
    const def = preset.params!.find((p) => p.key === key)!;
    for (const b of [...box]) {
      box.push({ ...b, [key]: def.min }, { ...b, [key]: def.max });
    }
  }

  it.each(box)("is a valid footbag-rule ball at %o", (values) => {
    const t = preset.topology(1, resolvePresetParams(preset, values));
    expect(t.panels).toHaveLength(preset.panels);
    expect(t.vertices.length - t.edges.length + t.panels.length).toBe(2);
    expect(t.edges.every((e) => e.panelB !== null)).toBe(true);

    const fill = t.panels.filter((p) => isFiller(t, p.id));
    const main = t.panels.filter((p) => !isFiller(t, p.id));
    expect(fill).toHaveLength(fillers);
    const mainCounts: Record<number, number> = {};
    for (const p of main) {
      const n = corners(t, p.vertexIndices).length;
      mainCounts[n] = (mainCounts[n] ?? 0) + 1;
    }
    expect(mainCounts).toEqual(mains);

    // Main panels never touch; every junction is one main panel and two fillers.
    const u = uses(t);
    for (const e of t.edges) expect(isFiller(t, e.panelA) || isFiller(t, e.panelB!)).toBe(true);
    for (const p of main) {
      for (const v of corners(t, p.vertexIndices)) {
        if (u.get(v) === 3) continue;
        // The star bag's notch corners belong to one hexagon and one star.
        expect(id).toBe("starbag");
      }
    }

    // Main panels are regular: equal corner angles and equal sides.
    for (const p of main) {
      const c = corners(t, p.vertexIndices);
      const idx = c.map((v) => p.vertexIndices.indexOf(v));
      const angs = idx.map((i) => angleAt(t, p.vertexIndices, i));
      expect(Math.max(...angs) - Math.min(...angs)).toBeLessThan(1e-6);
      const sides = c.map((v, k) => t.vertices[v].angleTo(t.vertices[c[(k + 1) % c.length]]));
      expect(Math.max(...sides) - Math.min(...sides)).toBeLessThan(1e-9);
      expect(idx.every((i) => turnSign(t, p.vertexIndices, i) > 0)).toBe(true);
    }

    // Filler-filler edges (the unstitched short sides) are real and shorter than any stitched side.
    const sideLen = (e: (typeof t.edges)[number]) => t.vertices[e.vertexA].angleTo(t.vertices[e.vertexB]);
    const stitched = t.edges.filter((e) => !(isFiller(t, e.panelA) && isFiller(t, e.panelB!)));
    const shortEdges = t.edges.filter((e) => isFiller(t, e.panelA) && isFiller(t, e.panelB!));
    // Whole short sides: chains of densified pieces between junctions.
    const chains = new Map<number, number>();
    const parent = new Map<number, number>();
    const find = (v: number): number => (parent.get(v) ?? v) === v ? v : find(parent.get(v)!);
    for (const e of shortEdges) {
      for (const v of [e.vertexA, e.vertexB]) if (!parent.has(v)) parent.set(v, v);
      parent.set(find(e.vertexA), find(e.vertexB));
    }
    for (const e of shortEdges) chains.set(find(e.vertexA), (chains.get(find(e.vertexA)) ?? 0) + sideLen(e));
    const short = [...chains.values()];
    expect(short.length).toBe(id === "starbag" ? 30 : 36);
    expect(Math.min(...short) * DEG).toBeGreaterThan(2);
    // Densified stitched seams are pieces of a side; compare whole sides.
    const mainSide = Math.min(
      ...main.map((p) => {
        const c = corners(t, p.vertexIndices);
        return t.vertices[c[0]].angleTo(t.vertices[c[1]]);
      }),
    );
    expect(Math.max(...short)).toBeLessThan(id === "starbag" ? mainSide * 1.05 : Math.min(...stitched.map(sideLen)));
    if (id !== "starbag") {
      // Fillers stay convex, no corner near flat.
      for (const p of fill) {
        p.vertexIndices.forEach((_, i) => {
          expect(turnSign(t, p.vertexIndices, i)).toBe(1);
          expect(angleAt(t, p.vertexIndices, i)).toBeLessThan(170);
        });
      }
    }
  });

  it("stitched seams pair one main panel with one filler, on every main side", () => {
    const t = preset.topology(1, resolvePresetParams(preset, {}));
    const mainSides = t.panels
      .filter((p) => !isFiller(t, p.id))
      .reduce((s, p) => s + corners(t, p.vertexIndices).length, 0);
    const neighbours = new Set(
      t.edges
        .filter((e) => isFiller(t, e.panelA) !== isFiller(t, e.panelB!))
        .map((e) => `${e.panelA}|${e.panelB}`),
    );
    // hexcap/cubecorner: one filler per main side; star bag: two sides per star.
    expect(neighbours.size).toBe(id === "starbag" ? mainSides / 2 : mainSides);
  });

  it("main shapes group into one template each", () => {
    const t = preset.topology(1, resolvePresetParams(preset, {}));
    const classes = groupPanelsByCongruence(t);
    const mainClasses = classes.filter((c) => !isFiller(t, c.panelIds[0]));
    expect(mainClasses).toHaveLength(Object.keys(mains).length);
  });
});

describe("Hex-capped 38 ring angle", () => {
  it("keeps the filler corners within the approved preview's range at the default", () => {
    const preset = presetById("hexcap38")!;
    const t = preset.topology(1, resolvePresetParams(preset, {}));
    const angs = t.panels
      .filter((p) => preset.laserHoleCount!.isFiller(t, p.id))
      .flatMap((p) => p.vertexIndices.map((_, i) => angleAt(t, p.vertexIndices, i)));
    expect(Math.min(...angs)).toBeGreaterThan(110);
    expect(Math.max(...angs)).toBeLessThan(130);
  });
});
