import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import {
  cube,
  cuboctahedron,
  dodecahedron,
  icosahedron,
  octahedron,
  tetrahedron,
  presetById,
  resolvePresetParams,
  PRESETS,
} from "@/lib/topology/presets";
import { morphFeaturePanels } from "@/lib/topology/panelScaleWarp";
import { goldberg11, goldbergClassI } from "@/lib/topology/goldberg";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { subdivideTopology, getPanelTriangles } from "@/lib/mesh/subdivide";

describe("topology presets", () => {
  it("tetrahedron has 4 panels, all triangles", () => {
    const t = tetrahedron();
    expect(t.panels).toHaveLength(4);
    expect(t.panels.every((p) => p.shape === "triangle")).toBe(true);
    expect(t.vertices).toHaveLength(4);
  });

  it("cube has 6 quad panels", () => {
    const t = cube();
    expect(t.panels).toHaveLength(6);
    expect(t.panels.every((p) => p.shape === "quad")).toBe(true);
    expect(t.vertices).toHaveLength(8);
  });

  it("octahedron has 8 triangle panels", () => {
    const t = octahedron();
    expect(t.panels).toHaveLength(8);
    expect(t.panels.every((p) => p.shape === "triangle")).toBe(true);
    expect(t.vertices).toHaveLength(6);
  });

  it("cuboctahedron has 8 triangles + 6 quads", () => {
    const t = cuboctahedron();
    expect(t.panels).toHaveLength(14);
    expect(t.panels.filter((p) => p.shape === "triangle")).toHaveLength(8);
    expect(t.panels.filter((p) => p.shape === "quad")).toHaveLength(6);
  });

  it("dodecahedron has 12 pentagon panels", () => {
    const t = dodecahedron();
    expect(t.panels).toHaveLength(12);
    expect(t.panels.every((p) => p.shape === "pentagon")).toBe(true);
    expect(t.vertices).toHaveLength(20);
  });

  it("icosahedron has 20 triangle panels", () => {
    const t = icosahedron();
    expect(t.panels).toHaveLength(20);
    expect(t.panels.every((p) => p.shape === "triangle")).toBe(true);
    expect(t.vertices).toHaveLength(12);
  });

  it("panel IDs are stable and uniquely identified", () => {
    for (const preset of PRESETS) {
      const t = preset.topology();
      const ids = new Set(t.panels.map((p) => p.id));
      expect(ids.size).toBe(t.panels.length);
      // Each id starts with panel_, has 3-digit index, ends with shape name.
      for (const p of t.panels) {
        expect(p.id).toMatch(/^panel_\d{3}_(triangle|quad|pentagon|hexagon|polygon)$/);
      }
    }
  });

  it("each boundary edge is shared by at most 2 panels", () => {
    for (const preset of PRESETS) {
      const t = preset.topology();
      for (const edge of t.edges) {
        expect(edge.panelA).toBeDefined();
        // Closed polyhedra: every edge should be shared by exactly 2 panels.
        expect(edge.panelB).not.toBeNull();
      }
    }
  });
});

describe("goldberg(1,1) — truncated icosahedron (soccer ball)", () => {
  it("has 32 panels: 12 pentagons + 20 hexagons", () => {
    const t = goldberg11();
    expect(t.panels).toHaveLength(32);
    expect(t.panels.filter((p) => p.shape === "pentagon")).toHaveLength(12);
    expect(t.panels.filter((p) => p.shape === "hexagon")).toHaveLength(20);
  });

  it("has 60 vertices and 90 edges (Euler: V - E + F = 2)", () => {
    const t = goldberg11();
    expect(t.vertices).toHaveLength(60);
    expect(t.edges).toHaveLength(90);
    expect(t.vertices.length - t.edges.length + t.panels.length).toBe(2);
  });

  it("every vertex sits on the unit sphere by default", () => {
    const t = goldberg11(1);
    for (const v of t.vertices) {
      expect(v.length()).toBeCloseTo(1, 5);
    }
  });

  it("every edge is shared by exactly 2 panels", () => {
    const t = goldberg11();
    for (const edge of t.edges) {
      expect(edge.panelB).not.toBeNull();
    }
  });

  it("hexagons alternate pentagon/hexagon neighbours along their boundary", () => {
    // Standard truncated-icosahedron property: every hexagon edge alternates
    // between sharing with a pentagon and sharing with a hexagon (3 of each).
    const t = goldberg11();
    const panelById = new Map(t.panels.map((p) => [p.id, p]));
    for (const hex of t.panels.filter((p) => p.shape === "hexagon")) {
      const loop = hex.vertexIndices;
      const neighbourShapes: string[] = [];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const edge = t.edges.find(
          (e) =>
            (e.vertexA === Math.min(a, b) && e.vertexB === Math.max(a, b)),
        )!;
        const otherId = edge.panelA === hex.id ? edge.panelB : edge.panelA;
        neighbourShapes.push(panelById.get(otherId!)!.shape);
      }
      // Should alternate: pent/hex/pent/hex/pent/hex (3 of each).
      expect(neighbourShapes.filter((s) => s === "pentagon")).toHaveLength(3);
      expect(neighbourShapes.filter((s) => s === "hexagon")).toHaveLength(3);
    }
  });
});

describe("goldbergClassI(m) — GP(m, 0)", () => {
  // Counts: 12 pentagons + 10*(m²-1) hexagons; vertices = 20*m² (formula
  // for the geodesic icosahedron with m subdivisions). For class I:
  //   m=2 → 12+30=42 panels, vertices=80
  //   m=3 → 12+80=92 panels, vertices=180
  //   m=4 → 12+150=162 panels, vertices=320
  it.each([
    [2, 42, 30],
    [3, 92, 80],
    [4, 162, 150],
  ])("m=%i: %i panels (%i hexagons + 12 pentagons)", (m, totalPanels, hexCount) => {
    const t = goldbergClassI(m);
    expect(t.panels).toHaveLength(totalPanels);
    expect(t.panels.filter((p) => p.shape === "pentagon")).toHaveLength(12);
    expect(t.panels.filter((p) => p.shape === "hexagon")).toHaveLength(hexCount);
  });

  it("Euler invariant holds for m=2 (V - E + F = 2)", () => {
    const t = goldbergClassI(2);
    expect(t.vertices.length - t.edges.length + t.panels.length).toBe(2);
  });

  it("every vertex sits on the unit sphere by default", () => {
    const t = goldbergClassI(2, 1);
    for (const v of t.vertices) {
      expect(v.length()).toBeCloseTo(1, 5);
    }
  });

  it("every edge is shared by exactly 2 panels", () => {
    for (const m of [2, 3]) {
      const t = goldbergClassI(m);
      for (const edge of t.edges) {
        expect(edge.panelB).not.toBeNull();
      }
    }
  });
});

describe("projectToSphere", () => {
  it("normalizes every vertex to the given radius", () => {
    const t = icosahedron();
    projectToSphere(t, 2.5);
    for (const v of t.vertices) {
      expect(v.length()).toBeCloseTo(2.5, 6);
    }
  });
});

describe("subdivideTopology", () => {
  it("preserves the panel set and boundary loops", () => {
    const base = icosahedron();
    const sub = subdivideTopology(base, 4);
    expect(sub.panels).toHaveLength(base.panels.length);
    expect(sub.panels.map((p) => p.id)).toEqual(base.panels.map((p) => p.id));
    // Original vertices (indices 0..base.vertices.length-1) stay in place.
    for (let i = 0; i < base.vertices.length; i++) {
      expect(sub.vertices[i].equals(base.vertices[i])).toBe(true);
    }
  });

  it("emits a triangle list per panel", () => {
    const sub = subdivideTopology(icosahedron(), 3);
    const tris = getPanelTriangles(sub);
    expect(tris).toBeDefined();
    for (const panel of sub.panels) {
      const t = tris!.get(panel.id);
      expect(t).toBeDefined();
      expect(t!.length).toBeGreaterThan(0);
    }
  });

  it("shares boundary-edge and fan-line vertices (no T-junctions, no dupes)", () => {
    // Icosahedron has 30 edges. With sharing, the 3 interior subdivision
    // vertices on each edge are emitted once (90 total). Within each panel,
    // the interior fan-line vertices (corner → centroid) are shared between
    // the two fan sectors flanking each corner.
    const sub = subdivideTopology(icosahedron(), 3);
    const baseVerts = 12;
    const centroidVerts = 20; // one per panel
    const sharedEdgeVerts = 30 * 3;
    // Per panel: 3 fan lines × 2 interior rows (rows 1..2 for levels=3)
    // shared vertices, plus strictly-interior vertices per sector (row 1 has
    // one non-fan-line point; row 2 has none) × 3 sectors.
    const perPanelInterior = 3 * 2 + 3 * 1;
    const expected =
      baseVerts + centroidVerts + sharedEdgeVerts + 20 * perPanelInterior;
    expect(sub.vertices.length).toBe(expected);

    // No two distinct vertices may share a position (the old grid emitted
    // duplicated fan-line vertices at identical coordinates).
    const seen = new Set<string>();
    for (const v of sub.vertices) {
      const key = `${v.x.toFixed(9)},${v.y.toFixed(9)},${v.z.toFixed(9)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("morphFeaturePanels (Teamgeist oval params)", () => {
  const preset = () => presetById("teamgeist")!;
  const topoAt = (pct: number) =>
    preset().topology(2, resolvePresetParams(preset(), { ovalSize: pct }));

  const panelAreas = (topo: import("@/lib/types").PanelTopology) => {
    const cross = new Vector3();
    return topo.panels.map((pnl) => {
      const av = new Vector3();
      const loop = pnl.vertexIndices;
      for (let i = 0; i < loop.length; i++) {
        cross.crossVectors(
          topo.vertices[loop[i]],
          topo.vertices[loop[(i + 1) % loop.length]],
        );
        av.add(cross);
      }
      return av.length() / 2;
    });
  };

  it("scales the six ovals, t-bones fill the rest", () => {
    const base = panelAreas(topoAt(100));
    const grown = panelAreas(topoAt(125));
    const sorted = [...base].sort((a, b) => a - b);
    const threshold = (sorted[7] + sorted[8]) / 2; // 8 t-bones below, 6 ovals above
    let ovals = 0;
    base.forEach((a, i) => {
      if (a > threshold) {
        ovals++;
        expect(grown[i]).toBeGreaterThan(a * 1.2); // oval grows
      } else {
        expect(grown[i]).toBeLessThan(a); // t-bone shrinks
      }
    });
    expect(ovals).toBe(6);
    // (No total-area assertion: vector-area is chord-based and lags true
    // solid angle more as caps grow. Full sphere coverage is structural —
    // panels share every boundary vertex — and meshing is covered below.)
  });

  it("preserves the oval's proportions exactly", () => {
    // Ovals never touch each other, so each scales uniformly about its
    // own center: the RATIO between any two of an oval's boundary-run
    // lengths must survive the warp.
    const runLensOf = (topo: import("@/lib/types").PanelTopology) => {
      const areas = panelAreas(topo);
      const sorted = [...areas].sort((a, b) => a - b);
      const threshold = (sorted[7] + sorted[8]) / 2;
      const ovalIdx = areas.findIndex((a) => a > threshold);
      const oval = topo.panels[ovalIdx];
      const loop = oval.vertexIndices;
      const n = loop.length;
      const neighborOf = new Map<string, string | null>();
      for (const e of topo.edges) {
        const key = `${Math.min(e.vertexA, e.vertexB)}-${Math.max(e.vertexA, e.vertexB)}`;
        neighborOf.set(key, e.panelA === oval.id ? e.panelB : e.panelA);
      }
      const nb = (i: number) =>
        neighborOf.get(
          `${Math.min(loop[i], loop[(i + 1) % n])}-${Math.max(loop[i], loop[(i + 1) % n])}`,
        ) ?? null;
      let startIdx = 0;
      for (let i = 0; i < n; i++) {
        if (nb(i) !== nb((i - 1 + n) % n)) {
          startIdx = i;
          break;
        }
      }
      const lens: number[] = [];
      let cur = 0;
      let curNb = nb(startIdx);
      for (let k = 0; k < n; k++) {
        const i = (startIdx + k) % n;
        if (nb(i) !== curNb) {
          lens.push(cur);
          cur = 0;
          curNb = nb(i);
        }
        cur += topo.vertices[loop[i]].angleTo(topo.vertices[loop[(i + 1) % n]]);
      }
      lens.push(cur);
      return lens;
    };
    const base = runLensOf(topoAt(100));
    const grown = runLensOf(topoAt(125));
    expect(grown.length).toBe(base.length);
    for (let i = 1; i < base.length; i++) {
      expect(grown[i] / grown[0]).toBeCloseTo(base[i] / base[0], 2);
    }
  });

  it("elongation: mid-values keep the waist, 0 is a perfect circle", () => {
    const base = topoAt(100);
    const at = (elongation: number) =>
      preset().topology(
        2,
        resolvePresetParams(preset(), { ovalSize: 100, elongation }),
      );
    const areasBase = panelAreas(base);
    const sorted = [...areasBase].sort((a, b) => a - b);
    const threshold = (sorted[7] + sorted[8]) / 2;
    const cross = new Vector3();
    const profile = (topo: typeof base, pi: number) => {
      const loop = topo.panels[pi].vertexIndices;
      const av = new Vector3();
      for (let i = 0; i < loop.length; i++) {
        cross.crossVectors(
          topo.vertices[loop[i]],
          topo.vertices[loop[(i + 1) % loop.length]],
        );
        av.add(cross);
      }
      const center = av.normalize();
      const helper =
        Math.abs(center.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
      const e1 = new Vector3().crossVectors(center, helper).normalize();
      const e2 = new Vector3().crossVectors(center, e1).normalize();
      const coords = loop.map((vi) => {
        const vN = topo.vertices[vi].clone().normalize();
        const theta = center.angleTo(vN);
        const az = vN.clone().sub(center.clone().multiplyScalar(vN.dot(center)));
        az.normalize();
        return { x: theta * az.dot(e1), y: theta * az.dot(e2) };
      });
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      for (const c of coords) {
        sxx += c.x * c.x;
        sxy += c.x * c.y;
        syy += c.y * c.y;
      }
      const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const ab = coords.map((c) => ({
        a: c.x * Math.cos(phi) + c.y * Math.sin(phi),
        b: -c.x * Math.sin(phi) + c.y * Math.cos(phi),
      }));
      const len = Math.max(...ab.map((c) => Math.abs(c.a)));
      const wid = Math.max(...ab.map((c) => Math.abs(c.b)));
      const waist = Math.max(
        ...ab.filter((c) => Math.abs(c.a) < len * 0.15).map((c) => Math.abs(c.b)),
      );
      const thetas = coords.map((c) => Math.hypot(c.x, c.y));
      return { len, wid, waist, thetas };
    };
    const half = at(50);
    const round = at(0);
    base.panels.forEach((_, pi) => {
      if (areasBase[pi] <= threshold) return; // t-bones
      const before = profile(base, pi);
      const mid = profile(half, pi);
      const after = profile(round, pi);
      // 50%: lobes half-slid, waist indent still clearly present with
      // near its original relative depth (rounding is cubic: 12.5% here)
      expect(mid.len / mid.wid).toBeLessThan(before.len / before.wid);
      expect(mid.len / mid.wid).toBeGreaterThan(1.15);
      const beforeDepth = 1 - before.waist / before.wid;
      const midDepth = 1 - mid.waist / mid.wid;
      expect(midDepth).toBeGreaterThan(beforeDepth * 0.6);
      // 0%: a perfect circle — every boundary point at the same angular
      // radius from the panel center
      const mean =
        after.thetas.reduce((s, t) => s + t, 0) / after.thetas.length;
      for (const t of after.thetas) {
        expect(Math.abs(t - mean)).toBeLessThan(0.01);
      }
    });
    expect(() => subdivideTopology(round, 2)).not.toThrow();
  });

  it("elongation 100 is the identity", () => {
    const a = topoAt(100);
    const b = preset().topology(
      2,
      resolvePresetParams(preset(), { ovalSize: 100, elongation: 100 }),
    );
    for (let i = 0; i < a.vertices.length; i++) {
      expect(a.vertices[i].distanceTo(b.vertices[i])).toBeLessThan(1e-9);
    }
  });

  it("is a no-op for single-class balls (trionda)", () => {
    const tri = presetById("trionda")!;
    const topo = tri.topology(2);
    const before = topo.vertices.map((v) => v.clone());
    morphFeaturePanels(topo, { scale: 0.7, elongation: 0.5 });
    for (let i = 0; i < before.length; i++) {
      expect(topo.vertices[i].distanceTo(before[i])).toBeLessThan(1e-9);
    }
  });
});
