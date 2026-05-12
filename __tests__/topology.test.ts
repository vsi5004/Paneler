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
