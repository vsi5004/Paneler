import { describe, expect, it } from "vitest";

import { presetById, resolvePresetParams } from "@/lib/topology/presets";
import type { PanelTopology } from "@/lib/types";
import { groupPanelsByCongruence } from "@/lib/laser/congruence";
import { buildLaserTemplate, laserPanelOutline } from "@/lib/laser/template";
import { templateFilename, templateToSvg } from "@/lib/laser/svg";
import {
  DEFAULT_BITE_DEPTH_MM,
  HOLE_BUNCHING_MM,
  HOLE_SPACING_MM,
  MARGIN_MM,
  mmPerUnit,
} from "@/lib/laser/constants";
import { flattenPanelUnscaled } from "@/lib/flatten/unfoldNet";
import { sampleOutline } from "@/lib/flatten/panelPath";
import type { LaserSettings } from "@/lib/laser/types";
import type { Vec2 } from "@/lib/flatten/types";

function topoOf(presetId: string, params?: Record<string, number>): PanelTopology {
  const preset = presetById(presetId)!;
  return preset.topology(2, resolvePresetParams(preset, params));
}

const SETTINGS: LaserSettings = {
  diameterIn: 1.8,
  biteDepthMm: DEFAULT_BITE_DEPTH_MM,
  curvaturePct: 100,
  showHoles: true,
  holeSpacingMm: HOLE_SPACING_MM,
  cornerMarginMm: 0,
};

/** Distance from point to a closed dense polyline. */
function distToPolyline(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    const t =
      lenSq > 0
        ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq))
        : 0;
    const d = Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
    if (d < best) best = d;
  }
  return best;
}

function seamPolyline(presetId: string, params?: Record<string, number>): { poly: Vec2[]; topo: PanelTopology } {
  const topo = topoOf(presetId, params);
  const cls = groupPanelsByCongruence(topo)[0];
  const scale = mmPerUnit(SETTINGS.diameterIn);
  const flat = laserPanelOutline(topo, cls.representative);
  const flatMm = {
    corners: flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale })),
    sagittaRatios: flat.sagittaRatios,
  };
  return { poly: sampleOutline(flatMm, 0.2).map((s) => s.p), topo };
}

function parsePathPoints(d: string): Vec2[] {
  // Handles scientific notation (a 0-curvature control point can serialize
  // as e.g. 6.4e-16, which a plain decimal regex splits into two numbers,
  // shifting every subsequent x/y pair).
  const nums = d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  const pts: Vec2[] = [];
  for (let i = 0; i < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

describe("groupPanelsByCongruence", () => {
  it("finds the documented class counts per preset", () => {
    expect(groupPanelsByCongruence(topoOf("gp2"))).toHaveLength(2);
    expect(groupPanelsByCongruence(topoOf("gp3"))).toHaveLength(3);
    expect(groupPanelsByCongruence(topoOf("gp4"))).toHaveLength(4);
    expect(groupPanelsByCongruence(topoOf("soccer"))).toHaveLength(2);
    expect(groupPanelsByCongruence(topoOf("cube"))).toHaveLength(1);
  });

  it("merges trionda's numerically-noisy congruent panels into one class", () => {
    const classes = groupPanelsByCongruence(topoOf("trionda"));
    expect(classes).toHaveLength(1);
    expect(classes[0].panelIds).toHaveLength(4);
    expect(classes[0].label).toBe("Panel");
  });

  it("classifies morphed cubocta hexagons by true corner count, not frozen id", () => {
    const classes = groupPanelsByCongruence(topoOf("cubocta", { shortEdge: 50 }));
    expect(classes).toHaveLength(2);
    const hexClass = classes.find((c) => c.cornerCount === 6)!;
    expect(hexClass.label).toBe("Hexagon");
    expect(hexClass.panelIds).toHaveLength(8);
    // Frozen ids still say triangle — the label must not.
    expect(hexClass.panelIds.every((id) => id.endsWith("_triangle"))).toBe(true);
  });

  it("labels repeated shapes A/B ordered by descending count", () => {
    const classes = groupPanelsByCongruence(topoOf("gp3"));
    const hexes = classes.filter((c) => c.cornerCount === 6);
    expect(hexes.map((c) => c.label)).toEqual(["Hexagon A", "Hexagon B"]);
    expect(hexes[0].panelIds.length).toBeGreaterThan(hexes[1].panelIds.length);
    expect(classes.find((c) => c.cornerCount === 5)!.label).toBe("Pentagon");
  });
});

describe("physical calibration", () => {
  it("total fabric area matches the proven 1.8in bag", () => {
    // The gather correction is calibrated on TOTAL seam-enclosed fabric
    // area (what determines finished bag size), not any single panel's
    // side — the proven design under-sizes hexes / over-sizes pentagons
    // relative to equal-area sharing. Proven 32-panel 1.8in bag:
    // 9192mm² of seam-enclosed fabric (footbag-templates JSONs).
    const topo = topoOf("soccer");
    const scale = mmPerUnit(1.8);
    let total = 0;
    for (const panel of topo.panels) {
      const flat = flattenPanelUnscaled(panel, topo);
      const flatMm = {
        corners: flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale })),
        sagittaRatios: flat.sagittaRatios,
      };
      const pts = sampleOutline(flatMm, 0.3).map((s) => s.p);
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[(i + 1) % pts.length];
        a += pts[i].x * q.y - q.x * pts[i].y;
      }
      total += Math.abs(a) / 2;
    }
    expect(total).toBeGreaterThan(9192 * 0.92);
    expect(total).toBeLessThan(9192 * 1.08);
  });

  it("reproduces proven panel dimensions at the proven config", () => {
    // At the proven truncation (hex ratio 0.25) and 1.8in, panel sizes
    // should bracket the proven templates (pent 17.5 / hex-long 20 cut).
    // Our symmetric family forces pent edge = hex long edge, so the two
    // land between the proven values rather than on both exactly.
    const topo = topoOf("soccer", { shortEdge: 25 });
    const scale = mmPerUnit(1.8);
    for (const cls of groupPanelsByCongruence(topo)) {
      const flat = flattenPanelUnscaled(cls.representative, topo);
      const corners = flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale }));
      const n = corners.length;
      const longest = Math.max(
        ...corners.map((a, i) => {
          const b = corners[(i + 1) % n];
          return Math.hypot(b.x - a.x, b.y - a.y);
        }),
      );
      const tan = Math.tan(Math.PI / cls.cornerCount);
      const cut = longest + 2 * 2 * tan;
      expect(cut).toBeGreaterThan(16);
      expect(cut).toBeLessThan(20.5);
    }
  });

  it("keeps the proven 6/8 per-seam hole counts at the proven config", () => {
    const topo = topoOf("soccer", { shortEdge: 25 });
    const classes = groupPanelsByCongruence(topo);
    const templates = new Map(
      classes.map((c) => [c.label, buildLaserTemplate(topo, c, SETTINGS)]),
    );
    // Pentagon: 5 hex seams at 6 each. Hexagon: shorts unholed, 3 long
    // (pent) seams at 6+2.
    expect(templates.get("Pentagon")!.holes.length).toBe(5 * 6);
    expect(templates.get("Hexagon")!.holes.length).toBe(3 * 8);
  });
});

describe("cut outline offset", () => {
  it.each(["tetra", "soccer", "trionda"])(
    "%s: cut path stays bite-depth away from the seam",
    (presetId) => {
      const { poly, topo } = seamPolyline(presetId);
      const cls = groupPanelsByCongruence(topo)[0];
      const t = buildLaserTemplate(topo, cls, SETTINGS);
      const cut = parsePathPoints(t.cutPath);
      expect(cut.length).toBeGreaterThan(20);
      for (let i = 0; i < cut.length; i++) {
        const p = cut[i];
        const q = cut[(i + 1) % cut.length];
        expect(Number.isFinite(p.x + p.y)).toBe(true);
        // Points sit ON the level set (within grid tolerance)…
        const d = distToPolyline(p, poly);
        expect(d).toBeGreaterThan(SETTINGS.biteDepthMm - 0.1);
        expect(d).toBeLessThan(SETTINGS.biteDepthMm + 0.15);
        // …and SEGMENTS never dip toward the seam (the failure mode of
        // point-wise offset schemes on concave hooks narrower than
        // 2×depth: chords that bridged them used to cross the seam).
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        expect(distToPolyline(mid, poly)).toBeGreaterThan(
          SETTINGS.biteDepthMm - 0.15,
        );
        // No giant chords.
        expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(2);
      }
    },
  );
});

describe("stitch holes", () => {
  it("lays alternating bunched gaps along each seam run", () => {
    const topo = topoOf("cube");
    const cls = groupPanelsByCongruence(topo)[0];
    const t = buildLaserTemplate(topo, cls, SETTINGS);
    expect(t.holes.length).toBeGreaterThan(8);
    // Cube face: 4 identical runs (one per edge). Holes come out in run
    // order; measure consecutive gaps within the first run.
    const perRun = t.holes.length / 4;
    expect(perRun % 2).toBe(0); // even count per run
    const run = t.holes.slice(0, perRun);
    const gaps = run.slice(1).map((h, i) => Math.hypot(h.x - run[i].x, h.y - run[i].y));
    for (let i = 0; i < gaps.length; i++) {
      const expected =
        i % 2 === 0
          ? HOLE_SPACING_MM - HOLE_BUNCHING_MM
          : HOLE_SPACING_MM + HOLE_BUNCHING_MM;
      expect(gaps[i]).toBeGreaterThan(expected - 0.15);
      expect(gaps[i]).toBeLessThan(expected + 0.15);
    }
  });

  it("keeps every hole on the seam line", () => {
    const { poly, topo } = seamPolyline("soccer");
    const cls = groupPanelsByCongruence(topo)[0];
    const t = buildLaserTemplate(topo, cls, SETTINGS);
    for (const h of t.holes) {
      expect(distToPolyline(h, poly)).toBeLessThan(0.05);
    }
  });

  it.each(["soccer", "trionda", "cubocta", "baseball"])(
    "%s: holes cover the whole circumference",
    (presetId) => {
      // Regression: the seam run that wraps past the boundary loop's
      // arc-length origin used to be truncated, leaving a run-sized arc
      // (a third of trionda's perimeter) without holes.
      const { poly, topo } = seamPolyline(presetId);
      const cls = groupPanelsByCongruence(topo)[0];
      const t = buildLaserTemplate(topo, cls, SETTINGS);
      let total = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        total += Math.hypot(b.x - a.x, b.y - a.y);
      }
      // Arc position of each hole via nearest boundary sample.
      const arcOf = (h: Vec2): number => {
        let best = Infinity;
        let s = 0;
        let acc = 0;
        for (let i = 0; i < poly.length; i++) {
          const d = Math.hypot(poly[i].x - h.x, poly[i].y - h.y);
          if (d < best) {
            best = d;
            s = acc;
          }
          const nxt = poly[(i + 1) % poly.length];
          acc += Math.hypot(nxt.x - poly[i].x, nxt.y - poly[i].y);
        }
        return s;
      };
      const positions = t.holes.map(arcOf).sort((a, b) => a - b);
      let maxGap = 0;
      for (let i = 0; i < positions.length; i++) {
        const gap =
          i === positions.length - 1
            ? total - positions[i] + positions[0]
            : positions[i + 1] - positions[i];
        maxGap = Math.max(maxGap, gap);
      }
      // Interior pitch is ≤2.9mm; corner clearances can reach ~2× the
      // spacing. Anything beyond ~3 spacings means a coverage hole.
      expect(maxGap).toBeLessThan(3 * HOLE_SPACING_MM);
    },
  );

  it("matches mating seams, with the hex corner-anchor +2 convention", () => {
    // Hole counts derive from the shared 3D seam length (identical on
    // both panels), and classes with same-class adjacency (hexes) get
    // one extra corner-anchor hole at each end of mixed seams — the
    // holes that stitch hex to adjacent hex. Proven templates: 32-panel
    // pent 6 / hex 8; 14-panel square 10 / hex 12.
    const check = (presetId: string, params?: Record<string, number>) => {
      const topo = topoOf(presetId, params);
      const classes = groupPanelsByCongruence(topo);
      return new Map(
        classes.map((c) => [
          c.label,
          buildLaserTemplate(topo, c, SETTINGS),
        ]),
      );
    };
    // Regular soccer: pent-seam count k on the pentagon; hexagon = 3
    // pent seams at k+2 plus 3 hex-hex seams at k.
    const soccer = check("soccer");
    const pentK = soccer.get("Pentagon")!.holes.length / 5;
    expect(Number.isInteger(pentK)).toBe(true);
    expect(soccer.get("Hexagon")!.holes.length).toBe(
      3 * (pentK + 2) + 3 * pentK,
    );
    // Truncated soccer: shorts unholed; hex = 3 pent seams at k+2.
    const trunc = check("soccer", { shortEdge: 40 });
    const truncPentK = trunc.get("Pentagon")!.holes.length / 5;
    expect(trunc.get("Hexagon")!.holes.length).toBe(3 * (truncPentK + 2));
    // 14-panel analog (truncated octahedron): quad k, hex long seams k+2.
    const cubocta = check("cubocta", { shortEdge: 40 });
    const quadK = cubocta.get("Quad")!.holes.length / 4;
    expect(cubocta.get("Hexagon")!.holes.length).toBe(3 * (quadK + 2));
    // True cuboctahedron: triangles never touch triangles → no extras,
    // seams match exactly.
    const flat = check("cubocta");
    expect(flat.get("Triangle")!.holes.length / 3).toBe(
      flat.get("Quad")!.holes.length / 4,
    );
  });

  it("leaves the truncation families' short edges unholed", () => {
    // Physical templates (footbag-templates repo, truncated hexes at
    // 0.25-0.4 ratio) put no stitch holes on the short hex-hex edges.
    const topo = topoOf("soccer", { shortEdge: 40 });
    const hex = groupPanelsByCongruence(topo).find((c) => c.cornerCount === 6)!;
    const t = buildLaserTemplate(topo, hex, SETTINGS);
    const scale = mmPerUnit(SETTINGS.diameterIn);
    const flat = flattenPanelUnscaled(hex.representative, topo);
    const corners = flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale }));
    const n = corners.length;
    const edges = corners.map((a, i) => {
      const b = corners[(i + 1) % n];
      return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
    });
    const maxLen = Math.max(...edges.map((e) => e.len));
    let shortEdges = 0;
    for (const e of edges) {
      if (e.len >= 0.55 * maxLen) continue;
      shortEdges++;
      for (const h of t.holes) {
        const abx = e.b.x - e.a.x;
        const aby = e.b.y - e.a.y;
        const lsq = abx * abx + aby * aby;
        const tt = ((h.x - e.a.x) * abx + (h.y - e.a.y) * aby) / lsq;
        if (tt < 0.05 || tt > 0.95) continue;
        const d = Math.hypot(h.x - (e.a.x + abx * tt), h.y - (e.a.y + aby * tt));
        expect(d).toBeGreaterThan(2);
      }
    }
    expect(shortEdges).toBe(3); // hex-hex edges at 40%
    // Long edges still fully holed.
    expect(t.holes.length).toBeGreaterThan(12);
  });

  it("trionda: every seam's two developments mate within 0.5mm", () => {
    // The physical bug: laser-cut panels did not line up, because the
    // Lambert flatten developed the same 3D seam differently in each
    // neighbouring panel (up to 32mm apart). With the seam-true
    // development, both sides of every seam must agree as planar curves
    // (same-side-up convention) after rigid endpoint alignment.
    const topo = topoOf("trionda");
    const scale = mmPerUnit(SETTINGS.diameterIn);
    const neighborOf = new Map<string, string[]>();
    for (const e of topo.edges) {
      const key = `${Math.min(e.vertexA, e.vertexB)}-${Math.max(e.vertexA, e.vertexB)}`;
      neighborOf.set(key, [e.panelA, e.panelB ?? ""]);
    }
    const runOf = (panel: (typeof topo.panels)[number], otherId: string) => {
      const loop = panel.vertexIndices;
      const n = loop.length;
      const isShared = (i: number) => {
        const a = loop[i];
        const b = loop[(i + 1) % n];
        return (
          neighborOf.get(`${Math.min(a, b)}-${Math.max(a, b)}`) ?? []
        ).includes(otherId);
      };
      let start = -1;
      for (let i = 0; i < n; i++) {
        if (isShared(i) && !isShared((i - 1 + n) % n)) {
          start = i;
          break;
        }
      }
      const idxs: number[] = [];
      for (let k = 0; k < n && isShared((start + k) % n); k++) {
        idxs.push((start + k) % n);
      }
      return idxs;
    };
    const curveOf = (
      panel: (typeof topo.panels)[number],
      edgeIdxs: number[],
    ) => {
      const flat = laserPanelOutline(topo, panel);
      const loop = panel.vertexIndices;
      return [...edgeIdxs, -1].map((e, k) => {
        const i =
          k < edgeIdxs.length
            ? edgeIdxs[k]
            : (edgeIdxs[edgeIdxs.length - 1] + 1) % loop.length;
        return {
          x: flat.corners[i].x * scale,
          y: flat.corners[i].y * scale,
          vi: loop[i],
        };
      });
    };
    let checked = 0;
    for (const A of topo.panels) {
      for (const B of topo.panels) {
        if (A.id >= B.id) continue;
        const runA = runOf(A, B.id);
        if (!runA.length) continue;
        checked++;
        const cA = curveOf(A, runA);
        let cB = curveOf(B, runOf(B, A.id));
        if (cA[0].vi !== cB[0].vi) cB = [...cB].reverse();
        // Rigid endpoint alignment.
        const a0 = cB[0];
        const a1 = cB[cB.length - 1];
        const p0 = cA[0];
        const p1 = cA[cA.length - 1];
        const ang =
          Math.atan2(p1.y - p0.y, p1.x - p0.x) -
          Math.atan2(a1.y - a0.y, a1.x - a0.x);
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        for (let i = 0; i < cA.length; i++) {
          const dx = cB[i].x - a0.x;
          const dy = cB[i].y - a0.y;
          const x = p0.x + dx * cos - dy * sin;
          const y = p0.y + dx * sin + dy * cos;
          expect(Math.hypot(cA[i].x - x, cA[i].y - y)).toBeLessThan(0.5);
        }
      }
    }
    expect(checked).toBe(6);
  });

  it("trionda: exact corner holes, even spacing, no bunching", () => {
    const topo = topoOf("trionda");
    const cls = groupPanelsByCongruence(topo)[0];
    const t = buildLaserTemplate(topo, cls, SETTINGS);
    // A hole exactly at each 3-panel junction corner.
    const useCount = new Map<number, number>();
    for (const p of topo.panels) {
      for (const vi of p.vertexIndices) {
        useCount.set(vi, (useCount.get(vi) ?? 0) + 1);
      }
    }
    const scale = mmPerUnit(SETTINGS.diameterIn);
    const flat = laserPanelOutline(topo, cls.representative);
    let junctions = 0;
    cls.representative.vertexIndices.forEach((vi, i) => {
      if ((useCount.get(vi) ?? 0) < 3) return;
      junctions++;
      const cx = flat.corners[i].x * scale;
      const cy = flat.corners[i].y * scale;
      const best = Math.min(
        ...t.holes.map((h) => Math.hypot(h.x - cx, h.y - cy)),
      );
      expect(best).toBeLessThan(0.05);
    });
    expect(junctions).toBe(3);
    // Even spacing, no bunched pairs: consecutive hole distances cluster
    // tightly around the pitch (bunching would alternate 2.1/2.9).
    const runLen = t.holes.length / 3;
    expect(Number.isInteger(runLen)).toBe(true);
    const run = t.holes.slice(0, runLen);
    const gaps = run
      .slice(1)
      .map((h, i) => Math.hypot(h.x - run[i].x, h.y - run[i].y));
    for (const g of gaps) {
      expect(g).toBeGreaterThan(2.2);
      expect(g).toBeLessThan(2.8);
    }
    const spread = Math.max(...gaps) - Math.min(...gaps);
    expect(spread).toBeLessThan(0.3);
  });

  it("is reversal-symmetric per run (mating panels line up)", () => {
    const topo = topoOf("cube");
    const cls = groupPanelsByCongruence(topo)[0];
    const t = buildLaserTemplate(topo, cls, SETTINGS);
    const perRun = t.holes.length / 4;
    const run = t.holes.slice(0, perRun);
    const gaps = run.slice(1).map((h, i) => Math.hypot(h.x - run[i].x, h.y - run[i].y));
    const reversed = [...gaps].reverse();
    for (let i = 0; i < gaps.length; i++) {
      expect(Math.abs(gaps[i] - reversed[i])).toBeLessThan(0.02);
    }
  });
});

describe("curvature", () => {
  it("0% straightens polygon edges (holes land on the corner chords)", () => {
    const topo = topoOf("soccer");
    const pent = groupPanelsByCongruence(topo).find((c) => c.cornerCount === 5)!;
    const straight = buildLaserTemplate(topo, pent, {
      ...SETTINGS,
      curvaturePct: 0,
    });
    // With no bulge the seam is the corner polygon; every hole must sit
    // on one of its chords.
    const scale = mmPerUnit(SETTINGS.diameterIn);
    const flat = flattenPanelUnscaled(pent.representative, topo);
    const corners = flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale }));
    for (const h of straight.holes) {
      expect(distToPolyline(h, corners)).toBeLessThan(0.05);
    }
    // No Q control points bulging: the seam path at 0% has zero-offset
    // control points, so the path's bounding box matches the corners'.
    const xs = corners.map((c) => c.x);
    const pathPts = parsePathPoints(straight.seamPath);
    const maxX = Math.max(...pathPts.map((p) => p.x));
    expect(maxX).toBeLessThanOrEqual(Math.max(...xs) + 0.01);
  });

  it("higher curvature grows the template bounds", () => {
    // Pentagon width is corner-dominated; the edge bulge shows up in the
    // height (an edge midpoint faces down in this template's frame).
    const topo = topoOf("soccer");
    const pent = groupPanelsByCongruence(topo).find((c) => c.cornerCount === 5)!;
    const flat0 = buildLaserTemplate(topo, pent, { ...SETTINGS, curvaturePct: 0 });
    const flat150 = buildLaserTemplate(topo, pent, {
      ...SETTINGS,
      curvaturePct: 150,
    });
    expect(flat150.bounds.height).toBeGreaterThan(flat0.bounds.height + 0.5);
  });
});

describe("SVG output", () => {
  it("emits a millimeter-true document with layered colors", () => {
    const topo = topoOf("soccer");
    const pent = groupPanelsByCongruence(topo).find((c) => c.cornerCount === 5)!;
    const t = buildLaserTemplate(topo, pent, SETTINGS);
    const svg = templateToSvg(t);
    expect(svg).toMatch(/width="\d+\.\d+mm"/);
    expect(svg).toMatch(/height="\d+\.\d+mm"/);
    expect(svg).toContain(`stroke="#000000" stroke-width="0.17"`);
    const circles = svg.match(/<circle/g) ?? [];
    expect(circles.length).toBe(t.holes.length);
    expect(svg).toContain(`stroke="#ff0000"`);
    expect(svg).not.toContain("<rect");
    // viewBox spans bounds (which include the 10mm margins).
    const [, vb] = svg.match(/viewBox="([^"]+)"/)!;
    const [minX, , w, h] = vb.split(" ").map(Number);
    expect(w).toBeGreaterThan(2 * MARGIN_MM);
    expect(h).toBeGreaterThan(2 * MARGIN_MM);
    expect(minX).toBeCloseTo(t.bounds.minX, 2);
  });

  it("honors custom spacing and corner margin", () => {
    const topo = topoOf("cube");
    const cls = groupPanelsByCongruence(topo)[0];
    const base = buildLaserTemplate(topo, cls, SETTINGS);
    // Wider pitch → fewer holes.
    const wide = buildLaserTemplate(topo, cls, {
      ...SETTINGS,
      holeSpacingMm: 4,
    });
    expect(wide.holes.length).toBeLessThan(base.holes.length);
    const run = wide.holes.slice(0, wide.holes.length / 4);
    const gap = Math.hypot(run[1].x - run[0].x, run[1].y - run[0].y);
    expect(gap).toBeGreaterThan(4 - HOLE_BUNCHING_MM - 0.15);
    // Corner margin pushes the first hole away from the corners.
    const margined = buildLaserTemplate(topo, cls, {
      ...SETTINGS,
      cornerMarginMm: 4,
    });
    expect(margined.holes.length).toBeLessThanOrEqual(base.holes.length);
    const scale = mmPerUnit(SETTINGS.diameterIn);
    const flat = flattenPanelUnscaled(cls.representative, topo);
    const corners = flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale }));
    for (const h of margined.holes) {
      for (const c of corners) {
        expect(Math.hypot(h.x - c.x, h.y - c.y)).toBeGreaterThan(3.5);
      }
    }
  });

  it("omits holes from the export when showHoles is off", () => {
    const topo = topoOf("soccer");
    const pent = groupPanelsByCongruence(topo).find((c) => c.cornerCount === 5)!;
    const t = buildLaserTemplate(topo, pent, SETTINGS);
    const withHoles = templateToSvg(t, { showHoles: true });
    const without = templateToSvg(t, { showHoles: false });
    expect((withHoles.match(/<circle/g) ?? []).length).toBe(t.holes.length);
    expect((without.match(/<circle/g) ?? []).length).toBe(0);
    // Cut outline unaffected.
    expect(without).toContain(`stroke="#000000"`);
  });

  it("builds descriptive filenames", () => {
    const topo = topoOf("gp3");
    const hexA = groupPanelsByCongruence(topo).find((c) => c.label === "Hexagon A")!;
    const t = buildLaserTemplate(topo, hexA, SETTINGS);
    expect(templateFilename("GP(3,0)", t, SETTINGS)).toBe(
      "gp-3-0_hexagon-a_1.8in_2mm.svg",
    );
    expect(
      templateFilename("GP(3,0)", t, { ...SETTINGS, curvaturePct: 55 }),
    ).toBe("gp-3-0_hexagon-a_1.8in_2mm_curve55.svg");
    expect(
      templateFilename("GP(3,0)", t, { ...SETTINGS, showHoles: false }),
    ).toBe("gp-3-0_hexagon-a_1.8in_2mm_noholes.svg");
  });
});
