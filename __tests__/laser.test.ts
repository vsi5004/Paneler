import { describe, expect, it } from "vitest";

import { presetById, resolvePresetParams } from "@/lib/topology/presets";
import type { PanelTopology } from "@/lib/types";
import { groupPanelsByCongruence } from "@/lib/laser/congruence";
import { buildLaserTemplate } from "@/lib/laser/template";
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
  const flat = flattenPanelUnscaled(cls.representative, topo);
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
  it("reproduces the proven 1.8in cut pentagon (~17.5mm sides)", () => {
    // footbag-templates repo: the 1.8in bag uses 17.5mm cut pentagon
    // sides with 2mm bite, where "side" is the vertex-to-vertex chord of
    // a miter-cornered edge offset. Our cut outline rounds its corners
    // (nicer for lasers), so compare via the miter-equivalent formula:
    // cutSide = seamSide + 2·bite·tan(π/5). This pins the full pipeline
    // (flatten → mm scale → gather correction) to the proven template.
    const topo = topoOf("soccer");
    const pent = groupPanelsByCongruence(topo).find((c) => c.cornerCount === 5)!;
    const scale = mmPerUnit(SETTINGS.diameterIn);
    const flat = flattenPanelUnscaled(pent.representative, topo);
    const corners = flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale }));
    const seamSides = corners.map((a, i) => {
      const b = corners[(i + 1) % corners.length];
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    for (const s of seamSides) {
      const cutSide = s + 2 * SETTINGS.biteDepthMm * Math.tan(Math.PI / 5);
      expect(cutSide).toBeGreaterThan(17.0);
      expect(cutSide).toBeLessThan(18.0);
    }
  });

  it("seam-line pentagon edge matches the calibration (~14.6mm)", () => {
    const topo = topoOf("soccer");
    const pent = groupPanelsByCongruence(topo).find((c) => c.cornerCount === 5)!;
    const scale = mmPerUnit(1.8);
    const flat = flattenPanelUnscaled(pent.representative, topo);
    const corners = flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale }));
    const edges = corners.map((a, i) => {
      const b = corners[(i + 1) % corners.length];
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    for (const e of edges) {
      expect(e).toBeGreaterThan(14.1);
      expect(e).toBeLessThan(15.1);
    }
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
  });
});
