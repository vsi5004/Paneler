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
  shortEdgeHoles: false,
  shortEdgeExtensionMm: 0,
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
    // knot: two panels, MIRROR-congruent (cut the second face-down)
    expect(groupPanelsByCongruence(topoOf("knot"))).toHaveLength(1);
    // weave: 8 lenses + 4 & 2 ribbon segments from the crossing graph
    expect(
      groupPanelsByCongruence(topoOf("weave")).map((c) => c.panelIds.length),
    ).toEqual([8, 4, 2]);
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
    const flat = laserPanelOutline(topo, hex.representative);
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

  it("trionda: mating seams develop to equal arc length, corners spherical", () => {
    // The physical bug: laser-cut panels did not line up, because the
    // Lambert flatten developed the same 3D seam to DIFFERENT lengths in
    // each neighbouring panel (tens of mm apart) — so hole counts and
    // positions could never match. What sewing needs is equal seam arc
    // length with matched hole counts; the developed CURVES need not nest
    // flat (each panel's flattening strain bows the seam toward its own
    // interior — exactly-congruent flat seams would force 60-degree
    // corners by Gauss-Bonnet; see symmetrizeWavyPanel). So we pin:
    //  1. both developments of every seam have equal arc length (<0.5mm)
    //  2. flat corner angles match the spherical corner angles (<3 deg)
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
    const runLength = (
      panel: (typeof topo.panels)[number],
      edgeIdxs: number[],
    ) => {
      const flat = laserPanelOutline(topo, panel);
      const loop = panel.vertexIndices;
      let len = 0;
      for (const e of edgeIdxs) {
        const a = flat.corners[e];
        const b = flat.corners[(e + 1) % loop.length];
        len += Math.hypot(b.x - a.x, b.y - a.y) * scale;
      }
      return len;
    };
    let checked = 0;
    for (const A of topo.panels) {
      for (const B of topo.panels) {
        if (A.id >= B.id) continue;
        const runA = runOf(A, B.id);
        if (!runA.length) continue;
        checked++;
        const lenA = runLength(A, runA);
        const lenB = runLength(B, runOf(B, A.id));
        expect(Math.abs(lenA - lenB)).toBeLessThan(0.5);
      }
    }
    expect(checked).toBe(6);

    // Corner angles: flat within 3 degrees of the spherical angle.
    const useCount = new Map<number, number>();
    for (const p of topo.panels) {
      for (const vi of p.vertexIndices) {
        useCount.set(vi, (useCount.get(vi) ?? 0) + 1);
      }
    }
    const angleBetween = (
      p: { x: number; y: number },
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => {
      const d = (a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y);
      const c = (a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x);
      return (Math.atan2(Math.abs(c), d) * 180) / Math.PI;
    };
    let corners = 0;
    for (const panel of topo.panels) {
      const flat = laserPanelOutline(topo, panel);
      const loop = panel.vertexIndices;
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        if ((useCount.get(loop[i]) ?? 0) < 3) continue;
        corners++;
        const flatAngle = angleBetween(
          flat.corners[i],
          flat.corners[(i - 1 + n) % n],
          flat.corners[(i + 1) % n],
        );
        const v = topo.vertices[loop[i]].clone().normalize();
        const ta = topo.vertices[loop[(i - 1 + n) % n]]
          .clone()
          .normalize()
          .addScaledVector(v, -topo.vertices[loop[(i - 1 + n) % n]].clone().normalize().dot(v))
          .normalize();
        const tb = topo.vertices[loop[(i + 1) % n]]
          .clone()
          .normalize()
          .addScaledVector(v, -topo.vertices[loop[(i + 1) % n]].clone().normalize().dot(v))
          .normalize();
        const sphereAngle =
          (Math.acos(Math.min(1, Math.max(-1, ta.dot(tb)))) * 180) / Math.PI;
        expect(sphereAngle).toBeGreaterThan(90); // sanity: wide on sphere
        expect(Math.abs(flatAngle - sphereAngle)).toBeLessThan(3);
      }
    }
    expect(corners).toBe(12);
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
      expect(g).toBeGreaterThan(2.1);
      expect(g).toBeLessThan(2.9);
    }
    // Chord-distance spread: arc spacing is uniform, but chord gaps vary
    // with local curvature of the (symmetrized) outline.
    const spread = Math.max(...gaps) - Math.min(...gaps);
    expect(spread).toBeLessThan(0.5);
  });

  it("teamgeist: every run is holed, counts mate across both classes", () => {
    // Regression: the short-run rule (no holes on runs < 55% of the
    // longest, meant for the soccer hex's unstitched short edges) was
    // also killing the Teamgeist bone panel's end runs and the turbine's
    // short sides — real seams that need stitching. Wavy corner-hole
    // panels now hole every run. Verify full coverage plus the mating
    // invariant: a 3D seam gets the same hole count from both classes.
    const topo = topoOf("teamgeist");
    const classes = groupPanelsByCongruence(topo);
    expect(classes.length).toBe(2);
    const TG_SETTINGS = { ...SETTINGS, shortEdgeHoles: true };
    const scale = mmPerUnit(TG_SETTINGS.diameterIn);
    const clsOf = new Map<string, string>();
    for (const c of classes) for (const id of c.panelIds) clsOf.set(id, c.key);

    // count interior holes per run, keyed by (ownClass, neighborClass,
    // rounded 3D length) — every equivalent seam must agree.
    const counts = new Map<string, Set<number>>();
    for (const cls of classes) {
      const t = buildLaserTemplate(topo, cls, TG_SETTINGS);
      const rep = cls.representative;
      const flat = laserPanelOutline(topo, rep);
      const loop = rep.vertexIndices;
      const n = loop.length;
      const pts = flat.corners.map((c2) => ({ x: c2.x * scale, y: c2.y * scale }));
      const cum = [0];
      for (let i = 0; i < n; i++) {
        cum.push(cum[i] + Math.hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].y - pts[i].y));
      }
      const neighborOf = new Map<string, string | null>();
      for (const e of topo.edges) {
        const key = `${Math.min(e.vertexA, e.vertexB)}-${Math.max(e.vertexA, e.vertexB)}`;
        neighborOf.set(key, e.panelA === rep.id ? e.panelB : e.panelA);
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
      const runs: number[][] = [];
      let cur: number[] = [];
      for (let k = 0; k < n; k++) {
        const i = (startIdx + k) % n;
        if (cur.length && nb(i) !== nb(cur[cur.length - 1])) {
          runs.push(cur);
          cur = [];
        }
        cur.push(i);
      }
      if (cur.length) runs.push(cur);
      const holeS = t.holes.map((h) => {
        let bestS = 0;
        let bestD = Infinity;
        for (let i = 0; i < n; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];
          const abx = b.x - a.x;
          const aby = b.y - a.y;
          const L2 = abx * abx + aby * aby || 1e-12;
          const tt = Math.max(0, Math.min(1, ((h.x - a.x) * abx + (h.y - a.y) * aby) / L2));
          const d = Math.hypot(h.x - (a.x + abx * tt), h.y - (a.y + aby * tt));
          if (d < bestD) {
            bestD = d;
            bestS = cum[i] + Math.sqrt(L2) * tt;
          }
        }
        return bestS;
      });
      const R = topo.vertices[loop[0]].length();
      for (const run of runs) {
        const runLen = run.reduce(
          (s, i) => s + (cum[i + 1] ?? cum[n]) - cum[i],
          0,
        );
        const s0 = cum[run[0]];
        // interior holes: strictly inside the run span (corners excluded);
        // handle the wrap-around run by measuring arc distance from s0.
        const total = cum[n];
        const interior = holeS.filter((s) => {
          const rel = (s - s0 + total) % total;
          return rel > 0.15 && rel < runLen - 0.15;
        }).length;
        expect(interior).toBeGreaterThanOrEqual(2); // regression: no bare runs
        let len3d = 0;
        for (const i of run) {
          len3d +=
            topo.vertices[loop[i]].angleTo(topo.vertices[loop[(i + 1) % n]]) *
            R *
            scale;
        }
        const key = [clsOf.get(rep.id), clsOf.get(nb(run[0])!), len3d.toFixed(0)]
          .sort()
          .join("|");
        if (!counts.has(key)) counts.set(key, new Set());
        counts.get(key)!.add(interior);
      }
    }
    // Mating: every (class-pair, seam-length) bucket has ONE count.
    for (const [key, set] of counts) {
      expect(set.size, `hole count mismatch for seam ${key}`).toBe(1);
    }

    // With the toggle OFF, short runs lose their interior holes but every
    // junction corner hole must survive — each run only places its own
    // start corner, and skipping a short run entirely used to erase the
    // long edge's last stitch.
    const useCount = new Map<number, number>();
    for (const pnl of topo.panels) {
      for (const vi of pnl.vertexIndices) {
        useCount.set(vi, (useCount.get(vi) ?? 0) + 1);
      }
    }
    for (const cls of classes) {
      const t = buildLaserTemplate(topo, cls, {
        ...SETTINGS,
        shortEdgeHoles: false,
      shortEdgeExtensionMm: 0,
          });
      const rep = cls.representative;
      const flat = laserPanelOutline(topo, rep);
      rep.vertexIndices.forEach((vi, i) => {
        if ((useCount.get(vi) ?? 0) < 3) return;
        const cx = flat.corners[i].x * scale;
        const cy = flat.corners[i].y * scale;
        const nearest = Math.min(
          ...t.holes.map((h) => Math.hypot(h.x - cx, h.y - cy)),
        );
        expect(nearest, `missing corner hole (toggle off) on ${cls.label}`).toBeLessThan(0.05);
      });
    }
  });

  it("short-edge extension widens the cut only along unstitched runs", () => {
    // Extra fabric behind the corner stitch: with the extension set, the
    // cut line sits biteDepth + extension from the seam along unstitched
    // short edges, and plain biteDepth along stitched long edges. The
    // stitch line and hole positions must not move.
    const topo = topoOf("teamgeist");
    const cls = groupPanelsByCongruence(topo)[0]; // t-bones (8x)
    const EXT = 3;
    const base = buildLaserTemplate(topo, cls, SETTINGS);
    const extended = buildLaserTemplate(topo, cls, {
      ...SETTINGS,
      shortEdgeExtensionMm: EXT,
    });
    // holes identical
    expect(extended.holes.length).toBe(base.holes.length);
    base.holes.forEach((h, i) => {
      expect(Math.hypot(h.x - extended.holes[i].x, h.y - extended.holes[i].y)).toBeLessThan(1e-9);
    });
    // classify seam outline into stitched/unstitched arcs via runs
    const scale = mmPerUnit(SETTINGS.diameterIn);
    const rep = cls.representative;
    const flat = laserPanelOutline(topo, rep);
    const loop = rep.vertexIndices;
    const n = loop.length;
    const pts = flat.corners.map((c2) => ({ x: c2.x * scale, y: c2.y * scale }));
    const neighborOf = new Map<string, string | null>();
    for (const e of topo.edges) {
      const key = `${Math.min(e.vertexA, e.vertexB)}-${Math.max(e.vertexA, e.vertexB)}`;
      neighborOf.set(key, e.panelA === rep.id ? e.panelB : e.panelA);
    }
    const clsIds = new Set(cls.panelIds);
    const shortMid: { x: number; y: number }[] = [];
    const longMid: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const nbr = neighborOf.get(
        `${Math.min(loop[i], loop[(i + 1) % n])}-${Math.max(loop[i], loop[(i + 1) % n])}`,
      );
      const mid = {
        x: (pts[i].x + pts[(i + 1) % n].x) / 2,
        y: (pts[i].y + pts[(i + 1) % n].y) / 2,
      };
      (nbr && clsIds.has(nbr) ? shortMid : longMid).push(mid);
    }
    const cutDist = (t: ReturnType<typeof buildLaserTemplate>, p: { x: number; y: number }) => {
      // distance from seam point p to the cut polyline
      const coords = t.cutPath
        .replace(/[MLZ]/g, " ")
        .trim()
        .split(/\s+/)
        .map(Number);
      let best = Infinity;
      for (let k = 0; k + 3 < coords.length; k += 2) {
        const ax = coords[k], ay = coords[k + 1];
        const bx = coords[k + 2], by = coords[k + 3];
        const abx = bx - ax, aby = by - ay;
        const L2 = abx * abx + aby * aby || 1e-12;
        const tt = Math.max(0, Math.min(1, ((p.x - ax) * abx + (p.y - ay) * aby) / L2));
        best = Math.min(best, Math.hypot(p.x - (ax + abx * tt), p.y - (ay + aby * tt)));
      }
      return best;
    };
    // The short edge translates rigidly outward: its tab front reaches
    // bite + EXT, and no short-edge point ends up closer than bite (the
    // curved tip's local normal diverges from the translation direction,
    // so off-center points measure between the two).
    expect(shortMid.length).toBeGreaterThan(10);
    const shortDists = shortMid.map((p) => cutDist(extended, p));
    expect(Math.max(...shortDists)).toBeGreaterThan(
      SETTINGS.biteDepthMm + EXT - 0.6,
    );
    for (const d of shortDists) {
      expect(d).toBeGreaterThan(SETTINGS.biteDepthMm - 0.15);
      expect(d).toBeLessThan(SETTINGS.biteDepthMm + EXT + 0.6);
    }
    // long-edge checks: stay clear of the deliberate ~2mm corner ramps
    const junctions = loop
      .map((vi, i) => ({ vi, i }))
      .filter(({ vi }) =>
        topo.panels.filter((pp) => pp.vertexIndices.includes(vi)).length >= 3,
      )
      .map(({ i }) => pts[i]);
    const farFromJunctions = (p: { x: number; y: number }) =>
      junctions.every((j) => Math.hypot(p.x - j.x, p.y - j.y) > 5);
    for (const p of longMid.filter(farFromJunctions).filter((_, i) => i % 17 === 8)) {
      const d = cutDist(extended, p);
      expect(d).toBeLessThan(SETTINGS.biteDepthMm + 0.5);
    }
  });

  it("orbita: anchor holes land exactly on the star's sharp bends", () => {
    // The Orbita's 12 star panels have sharp outer tips and inner
    // notches mid-seam; sewing needs an anchor hole exactly on each.
    // The behavior is opt-in per preset (laserSharpBendAnchors) so the
    // trionda/Teamgeist keep their plain corner-to-corner convention
    // despite also having bends past any geometric threshold.
    const topo = topoOf("orbita");
    const cls = groupPanelsByCongruence(topo)[0];
    expect(cls.panelIds.length).toBe(12);
    const withAnchors = buildLaserTemplate(topo, cls, SETTINGS, {
      sharpBendAnchors: true,
    });
    // counts may match (apex anchors displace interior holes one-for-one
    // through sub-span rounding); the POSITIONS are what changes
    const plain = buildLaserTemplate(topo, cls, SETTINGS);
    const moved = withAnchors.holes.filter(
      (h) => !plain.holes.some((q) => Math.hypot(q.x - h.x, q.y - h.y) < 0.01),
    );
    expect(moved.length).toBeGreaterThan(5);

    // find sharp outline bends independently and require a hole on each
    const scale = mmPerUnit(SETTINGS.diameterIn);
    const flat = laserPanelOutline(topo, cls.representative);
    const flatMm = {
      corners: flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale })),
      sagittaRatios: flat.sagittaRatios,
    };
    const samples = sampleOutline(flatMm, 0.4);
    const total = samples[samples.length - 1].s;
    const at = (s: number) => {
      const ss = ((s % total) + total) % total;
      let i = 0;
      while (i + 1 < samples.length && samples[i + 1].s < ss) i++;
      return samples[i].p;
    };
    // junction corner positions (already anchored by corner holes)
    const useCount = new Map<number, number>();
    for (const pnl of topo.panels) {
      for (const vi of pnl.vertexIndices) {
        useCount.set(vi, (useCount.get(vi) ?? 0) + 1);
      }
    }
    const junctionPts = cls.representative.vertexIndices
      .map((vi, i) => ({ vi, i }))
      .filter(({ vi }) => (useCount.get(vi) ?? 0) >= 3)
      .map(({ i }) => flatMm.corners[i]);
    let sharpBends = 0;
    for (let s = 0; s < total; s += 0.4) {
      const p0 = at(s - 1.2);
      const p1 = at(s);
      const p2 = at(s + 1.2);
      const v1x = p1.x - p0.x;
      const v1y = p1.y - p0.y;
      const v2x = p2.x - p1.x;
      const v2y = p2.y - p1.y;
      const turn =
        (Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y)) *
          180) /
        Math.PI;
      if (turn < 50) continue; // solidly sharp, away from threshold noise
      if (junctionPts.some((j) => Math.hypot(j.x - p1.x, j.y - p1.y) < 2)) {
        continue; // junction corners are anchored by corner holes
      }
      sharpBends++;
      const nearest = Math.min(
        ...withAnchors.holes.map((h) => Math.hypot(h.x - p1.x, h.y - p1.y)),
      );
      expect(nearest, `no anchor near sharp bend at s=${s.toFixed(1)}`).toBeLessThan(1.2);
    }
    expect(sharpBends).toBeGreaterThan(5); // the star really has them
  });

  it("spiral: seam-true flatten keeps boundary length exact", () => {
    // From a stitched prototype: the seam's length is what sewing
    // enforces, and ARAP's +12% boundary excess made the ball oblate
    // (2.4in equator on 1.9in height). With seamTrueBands the outline's
    // total boundary length matches the 3D seam within 0.1%.
    const topo = topoOf("spiral");
    for (const panel of topo.panels) {
      const flat = laserPanelOutline(topo, panel, { seamTrueBands: true });
      const pts = flat.corners;
      const n = pts.length;
      let flatLen = 0;
      let trueLen = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        flatLen += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
        trueLen += topo.vertices[panel.vertexIndices[i]].distanceTo(
          topo.vertices[panel.vertexIndices[j]],
        );
      }
      expect(Math.abs(flatLen / trueLen - 1)).toBeLessThan(0.001);
      // and the outline is simple (no self-crossings)
      let crossings = 0;
      for (let i = 0; i < n; i += 2) {
        for (let j = i + 4; j < n; j += 2) {
          if (i === 0 && j >= n - 2) continue;
          const a1 = pts[i];
          const a2 = pts[(i + 1) % n];
          const b1 = pts[j];
          const b2 = pts[(j + 1) % n];
          const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
          if (Math.abs(d) < 1e-12) continue;
          const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
          const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
          if (t > 0 && t < 1 && u > 0 && u < 1) crossings++;
        }
      }
      expect(crossings).toBe(0);
    }
  });

  it("closed single-seam loops space holes uniformly through the closure", () => {
    // The open-run pattern left the remainder after (n-1) even gaps as
    // the closure gap — the spiral's first and last holes landed a
    // fraction of a pitch apart. Closed loops distribute round(L/pitch)
    // holes at one uniform gap; consecutive gaps must all agree.
    for (const id of ["spiral", "baseball", "knot"] as const) {
      const topo = topoOf(id);
      const cls = groupPanelsByCongruence(topo)[0];
      const t = buildLaserTemplate(topo, cls, SETTINGS, {
        seamTrueBands: id === "spiral",
      });
      const ds: number[] = [];
      for (let i = 0; i < t.holes.length; i++) {
        const j = (i + 1) % t.holes.length;
        ds.push(Math.hypot(t.holes[j].x - t.holes[i].x, t.holes[j].y - t.holes[i].y));
      }
      const min = Math.min(...ds);
      const max = Math.max(...ds);
      expect(max - min, `${id} closure gap spread`).toBeLessThan(0.3);
    }
  });

  it("knot: template outline stays simple across the whole twist range", () => {
    // The knot's twist slider is capped at 60% BECAUSE beyond that the
    // panels' developments self-overlap and no cuttable template exists
    // (lib/topology/knot.ts). Pin the guarantee at the range's corners
    // and default.
    for (const twist of [0, 40, 60]) {
      const topo = topoOf("knot", { twist });
      for (const panel of topo.panels) {
        const pts = laserPanelOutline(topo, panel).corners;
        const n = pts.length;
        let crossings = 0;
        for (let i = 0; i < n; i++) {
          for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            const a1 = pts[i];
            const a2 = pts[(i + 1) % n];
            const b1 = pts[j];
            const b2 = pts[(j + 1) % n];
            const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
            if (Math.abs(d) < 1e-12) continue;
            const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
            const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
            if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) crossings++;
          }
        }
        expect(crossings, `knot twist=${twist} ${panel.id}`).toBe(0);
      }
    }
  });

  it("weave: every class builds a template and every seam run is holed", () => {
    const topo = topoOf("weave");
    const classes = groupPanelsByCongruence(topo);
    expect(classes).toHaveLength(3);
    const scale = mmPerUnit(SETTINGS.diameterIn);
    for (const cls of classes) {
      const t = buildLaserTemplate(topo, cls, SETTINGS);
      expect(t.holes.length).toBeGreaterThan(0);
      // run count = number of distinct neighbors around the boundary;
      // every run must carry at least one hole (all seams are stitched)
      const rep = cls.representative;
      const loop = rep.vertexIndices;
      const n = loop.length;
      const neighborOf = new Map<string, string>();
      for (const e of topo.edges) {
        const key = `${Math.min(e.vertexA, e.vertexB)}-${Math.max(e.vertexA, e.vertexB)}`;
        neighborOf.set(key, e.panelA === rep.id ? e.panelB : e.panelA);
      }
      const nb = (i: number) =>
        neighborOf.get(
          `${Math.min(loop[i], loop[(i + 1) % n])}-${Math.max(loop[i], loop[(i + 1) % n])}`,
        )!;
      let runs = 0;
      for (let i = 0; i < n; i++) {
        if (nb(i) !== nb((i - 1 + n) % n)) runs++;
      }
      expect(runs).toBeGreaterThan(0);
      // enough holes that no run went empty: at least one per run plus
      // the corner anchors
      expect(t.holes.length).toBeGreaterThanOrEqual(runs);
      // holes sit on the seam line (mirrors the global on-seam test)
      const flat = laserPanelOutline(topo, rep);
      const flatMm = {
        corners: flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale })),
        sagittaRatios: flat.sagittaRatios,
      };
      const seam = sampleOutline(flatMm, 0.2).map((s) => s.p);
      for (const h of t.holes) {
        let best = Infinity;
        for (const p of seam) best = Math.min(best, Math.hypot(p.x - h.x, p.y - h.y));
        expect(best).toBeLessThan(0.25);
      }
    }
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
      shortEdgeHoles: false,
      shortEdgeExtensionMm: 0,
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
