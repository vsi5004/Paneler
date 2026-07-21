import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import {
  shortEdgeRatioToT,
  tToShortEdgeRatio,
  truncatedOctahedronFamily,
} from "@/lib/topology/truncatedOcta";
import {
  cuboctahedron,
  presetById,
  resolvePresetParams,
} from "@/lib/topology/presets";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { subdivideTopology, puffPanels } from "@/lib/mesh/subdivide";
import type { PanelTopology } from "@/lib/types";

function euler(t: PanelTopology): number {
  return t.vertices.length - t.edges.length + t.panels.length;
}

/** Hex-hex edges — between two triangle-suffixed (frozen) face-panel ids. */
function shortEdges(t: PanelTopology) {
  return t.edges.filter(
    (e) =>
      e.panelA.endsWith("_triangle") &&
      e.panelB !== null &&
      e.panelB.endsWith("_triangle"),
  );
}

/** Hex-square edges — the hexagons' long edges. */
function longEdges(t: PanelTopology) {
  return t.edges.filter(
    (e) =>
      e.panelB !== null &&
      e.panelA.endsWith("_triangle") !== e.panelB.endsWith("_triangle"),
  );
}

function edgeChord(t: PanelTopology, e: PanelTopology["edges"][number]) {
  return t.vertices[e.vertexA].distanceTo(t.vertices[e.vertexB]);
}

describe("shortEdgeRatio ↔ truncation conversions", () => {
  it("hits the family's anchor points", () => {
    expect(shortEdgeRatioToT(0)).toBeCloseTo(0.5, 12); // cuboctahedron
    expect(shortEdgeRatioToT(1)).toBeCloseTo(1 / 3, 12); // regular trunc-octa
    expect(tToShortEdgeRatio(1 / 3)).toBeCloseTo(1, 12);
    expect(tToShortEdgeRatio(0)).toBe(Infinity); // octahedron limit
  });

  it("round-trips across the slider range", () => {
    for (let r = 0; r <= 1; r += 0.01) {
      expect(tToShortEdgeRatio(shortEdgeRatioToT(r))).toBeCloseTo(r, 12);
    }
  });
});

describe("truncatedOctahedronFamily", () => {
  it("degenerates to the cuboctahedron at shortEdge = 0", () => {
    const t = truncatedOctahedronFamily(1, 0);
    expect(t.panels).toHaveLength(14);
    expect(t.panels.filter((p) => p.shape === "triangle")).toHaveLength(8);
    expect(t.panels.filter((p) => p.shape === "quad")).toHaveLength(6);
    expect(t.vertices).toHaveLength(12);
    expect(t.edges).toHaveLength(24);
    expect(euler(t)).toBe(2);
    // cuboctahedron() is defined as this degenerate case.
    const cub = cuboctahedron(1);
    expect(t.panels.map((p) => p.id).sort()).toEqual(
      cub.panels.map((p) => p.id).sort(),
    );
  });

  it("produces 8 hexagons + 6 quads for shortEdgeRatio > 0", () => {
    const t = truncatedOctahedronFamily(1, 0.4);
    expect(t.panels).toHaveLength(14);
    expect(t.panels.filter((p) => p.shape === "hexagon")).toHaveLength(8);
    expect(t.panels.filter((p) => p.shape === "quad")).toHaveLength(6);
    expect(t.vertices).toHaveLength(24);
    expect(t.edges).toHaveLength(36);
    expect(euler(t)).toBe(2);
    for (const edge of t.edges) {
      expect(edge.panelB).not.toBeNull();
    }
  });

  it("realizes the requested short/long edge ratio on the sphere", () => {
    for (const r of [0.05, 0.25, 0.5, 0.75, 1]) {
      const t = truncatedOctahedronFamily(1, r);
      const short = shortEdges(t);
      const long = longEdges(t);
      expect(short).toHaveLength(12); // one per original octahedron edge
      expect(long).toHaveLength(24); // one per hexagon corner cut
      const longLen = edgeChord(t, long[0]);
      for (const e of long) {
        expect(edgeChord(t, e)).toBeCloseTo(longLen, 9);
      }
      for (const e of short) {
        expect(edgeChord(t, e) / longLen).toBeCloseTo(r, 9);
      }
    }
  });

  it("makes all edges equal at 100% (regular truncated octahedron)", () => {
    const t = truncatedOctahedronFamily(1, 1);
    const first = edgeChord(t, t.edges[0]);
    for (const e of t.edges) {
      expect(edgeChord(t, e)).toBeCloseTo(first, 9);
    }
  });

  it("keeps the hex-hex edges the short ones within the slider range", () => {
    const t = truncatedOctahedronFamily(1, 0.4);
    const shortLen = edgeChord(t, shortEdges(t)[0]);
    for (const e of t.edges) {
      expect(edgeChord(t, e)).toBeGreaterThanOrEqual(shortLen - 1e-9);
    }
  });

  it("keeps panel ids frozen to the degenerate shapes across the range", () => {
    const idSets = [0, 0.1, 0.4, 1].map((s) =>
      truncatedOctahedronFamily(1, s)
        .panels.map((p) => p.id)
        .sort()
        .join(","),
    );
    for (const set of idSets) {
      expect(set).toBe(idSets[0]);
    }
    // The frozen suffix reflects the s=0 shape, not the current one.
    const hexed = truncatedOctahedronFamily(1, 0.4);
    for (const p of hexed.panels) {
      if (p.shape === "hexagon") expect(p.id).toMatch(/_triangle$/);
      if (p.shape === "quad") expect(p.id).toMatch(/_quad$/);
    }
  });

  it("keeps each frozen id on the same physical panel across the range", () => {
    // Each face panel's centroid direction should barely move as s changes —
    // that's what makes painted colors land on the same panel while sliding.
    const centroids = (s: number) => {
      const t = truncatedOctahedronFamily(1, s);
      const map = new Map<string, Vector3>();
      for (const p of t.panels) {
        const c = new Vector3();
        for (const vi of p.vertexIndices) c.add(t.vertices[vi]);
        map.set(p.id, c.normalize());
      }
      return map;
    };
    const at0 = centroids(0);
    const at4 = centroids(0.4);
    for (const [id, dir] of at0) {
      expect(at4.get(id)!.dot(dir)).toBeGreaterThan(0.99);
    }
  });

  it("normalizes every vertex onto the requested sphere", () => {
    const t = truncatedOctahedronFamily(2.5, 0.3);
    for (const v of t.vertices) {
      expect(v.length()).toBeCloseTo(2.5, 6);
    }
  });

  it("survives the subdivide → project → puff pipeline without NaNs", () => {
    for (const s of [0.01, 0.25]) {
      const sub = subdivideTopology(truncatedOctahedronFamily(1, s), 3);
      projectToSphere(sub, 2);
      puffPanels(sub, 2, 0.06);
      expect(sub.panels).toHaveLength(14);
      for (const v of sub.vertices) {
        expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
      }
    }
  });
});

describe("resolvePresetParams", () => {
  const cubocta = presetById("cubocta")!;

  it("falls back to declared defaults", () => {
    expect(resolvePresetParams(cubocta)).toEqual({ shortEdge: 0 });
  });

  it("keeps saved in-range values and clamps out-of-range ones", () => {
    expect(resolvePresetParams(cubocta, { shortEdge: 40 })).toEqual({
      shortEdge: 40,
    });
    expect(resolvePresetParams(cubocta, { shortEdge: 250 })).toEqual({
      shortEdge: 100,
    });
    expect(resolvePresetParams(cubocta, { shortEdge: -1 })).toEqual({
      shortEdge: 0,
    });
  });

  it("drops unknown keys and non-numeric values", () => {
    expect(
      resolvePresetParams(cubocta, {
        bogus: 1,
        shortEdge: Number.NaN,
      }),
    ).toEqual({ shortEdge: 0 });
  });
});
