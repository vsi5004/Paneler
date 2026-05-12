import { describe, it, expect } from "vitest";

import { parseObjToTopology } from "@/lib/topology/obj";

const CUBE_OBJ = `
# Simple cube
v -1.0 -1.0 -1.0
v  1.0 -1.0 -1.0
v  1.0  1.0 -1.0
v -1.0  1.0 -1.0
v -1.0 -1.0  1.0
v  1.0 -1.0  1.0
v  1.0  1.0  1.0
v -1.0  1.0  1.0

f 1 4 3 2
f 5 6 7 8
f 1 2 6 5
f 3 4 8 7
f 2 3 7 6
f 1 5 8 4
`;

const ICO_FACES_OBJ = `
# 12-vertex icosahedron, all triangles
v  0.000  1.000  1.618
v  0.000 -1.000  1.618
v  0.000  1.000 -1.618
v  0.000 -1.000 -1.618
v  1.000  1.618  0.000
v -1.000  1.618  0.000
v  1.000 -1.618  0.000
v -1.000 -1.618  0.000
v  1.618  0.000  1.000
v -1.618  0.000  1.000
v  1.618  0.000 -1.000
v -1.618  0.000 -1.000

f 1 9 5
f 1 5 6
f 1 6 10
f 1 10 2
f 1 2 9
f 2 7 9
f 9 7 11
f 9 11 5
f 5 11 3
f 5 3 6
f 6 3 12
f 6 12 10
f 10 12 8
f 10 8 2
f 2 8 7
f 4 11 7
f 4 12 11
f 4 3 12
f 4 7 8
f 4 8 12
`;

describe("parseObjToTopology", () => {
  it("parses a cube — 8 verts, 6 quad panels, 12 shared edges", () => {
    const t = parseObjToTopology(CUBE_OBJ);
    expect(t.vertices).toHaveLength(8);
    expect(t.panels).toHaveLength(6);
    expect(t.panels.every((p) => p.shape === "quad")).toBe(true);
    expect(t.edges).toHaveLength(12);
    for (const edge of t.edges) {
      expect(edge.panelB).not.toBeNull();
    }
  });

  it("normalizes vertices to the given radius", () => {
    const t = parseObjToTopology(CUBE_OBJ, 2.5);
    for (const v of t.vertices) {
      expect(v.length()).toBeCloseTo(2.5, 5);
    }
  });

  it("supports v/vt/vn slash-separated face tokens", () => {
    const obj = `
v 0 0 0
v 1 0 0
v 0 1 0
vt 0 0
vt 1 0
vt 0 1
vn 0 0 1
f 1/1/1 2/2/1 3/3/1
`;
    const t = parseObjToTopology(obj);
    expect(t.panels).toHaveLength(1);
    expect(t.panels[0].shape).toBe("triangle");
    expect(t.panels[0].vertexIndices).toEqual([0, 1, 2]);
  });

  it("rejects truly empty input", () => {
    expect(() => parseObjToTopology("")).toThrow();
  });

  it("rejects an OBJ with no faces", () => {
    expect(() => parseObjToTopology("v 0 0 0\nv 1 0 0\nv 0 1 0\n")).toThrow();
  });

  it("parses an icosahedron OBJ to 20 triangle panels", () => {
    // This test data was hand-authored and isn't a perfectly-closed mesh —
    // we only assert parser-level correctness (counts, shapes), not topology.
    const t = parseObjToTopology(ICO_FACES_OBJ);
    expect(t.vertices).toHaveLength(12);
    expect(t.panels).toHaveLength(20);
    expect(t.panels.every((p) => p.shape === "triangle")).toBe(true);
  });

  it("preserves n-gon arity (doesn't auto-triangulate)", () => {
    // A single pentagon face — three-stdlib's OBJLoader would split this into
    // 3 triangles. We must preserve it as a 5-vertex panel.
    const pentagon = `
v 0 1 0
v 0.951 0.309 0
v 0.588 -0.809 0
v -0.588 -0.809 0
v -0.951 0.309 0
f 1 2 3 4 5
`;
    const t = parseObjToTopology(pentagon);
    expect(t.panels).toHaveLength(1);
    expect(t.panels[0].shape).toBe("pentagon");
    expect(t.panels[0].vertexIndices).toHaveLength(5);
  });
});
