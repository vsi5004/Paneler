import { describe, expect, it } from "vitest";

import {
  cube,
  cuboctahedron,
  dodecahedron,
  icosahedron,
  octahedron,
  tetrahedron,
  PRESETS,
} from "@/lib/topology/presets";
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

  it("shares boundary-edge vertices between adjacent panels (no T-junctions)", () => {
    // Icosahedron has 30 edges. With sharing, the 3 interior subdivision
    // vertices on each edge are emitted once (90 total). Without sharing,
    // each edge would be subdivided per-panel (20 panels × 3 edges × 3 = 180
    // edge-interior vertices). The difference (90) is what sharing saves.
    const sub = subdivideTopology(icosahedron(), 3);
    const baseVerts = 12;
    const centroidVerts = 20; // one per panel
    const sharedEdgeVerts = 30 * 3;
    // Interior vertices inside each fan-triangle (rows 1 and 2 of the
    // barycentric grid for levels=3): 3 fans per panel × (3 + 2) = 15 per panel.
    const fanInteriorVerts = 20 * 15;
    const expected = baseVerts + centroidVerts + sharedEdgeVerts + fanInteriorVerts;
    expect(sub.vertices.length).toBe(expected);

    // Sanity: must be strictly less than what un-shared edges would cost.
    const naiveUnshared = expected + 30 * 3; // duplicate each edge's interior
    expect(sub.vertices.length).toBeLessThan(naiveUnshared);
  });
});
