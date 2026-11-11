import { describe, expect, it } from "vitest";

import { presetById, resolvePresetParams } from "@/lib/topology/presets";
import { groupPanelsByCongruence } from "@/lib/laser/congruence";
import { buildLaserTemplate } from "@/lib/laser/template";
import { defaultLaserSettings } from "@/lib/laser/constants";
import { cutOutline, packTemplate, sheetToSvg } from "@/lib/laser/pack";
import type { LaserTemplate } from "@/lib/laser/types";

function templatesOf(id: string, params: Record<string, number> = {}): LaserTemplate[] {
  const preset = presetById(id)!;
  const topo = preset.topology(2, resolvePresetParams(preset, params));
  const settings = { ...defaultLaserSettings(), diameterIn: 1.8, biteDepthMm: 1.7 };
  return groupPanelsByCongruence(topo).map((c) =>
    buildLaserTemplate(topo, c, settings, { holeCount: preset.laserHoleCount }),
  );
}

const SHEET_6IN = { sheetW: 152.4, sheetH: 152.4, gap: 0, rowGap: 0, margin: 1 };

describe("packTemplate", () => {
  it("packs GP(3,0) panels densely onto a 6x6in sheet", () => {
    const counts = Object.fromEntries(
      templatesOf("gp3", { shortEdge: 50 }).map((t) => [t.label, packTemplate(t, SHEET_6IN).placements.length]),
    );
    // Matches the hand-run packer: 120 / 68 / 105.
    expect(counts["Hexagon A"]).toBeGreaterThanOrEqual(118);
    expect(counts["Hexagon B"]).toBeGreaterThanOrEqual(66);
    expect(counts["Pentagon"]).toBeGreaterThanOrEqual(103);
  });

  it("keeps every piece inside the margin, and a gap keeps pieces apart (fewer fit)", () => {
    const t = templatesOf("soccer")[1];
    const touching = packTemplate(t, SHEET_6IN);
    const spaced = packTemplate(t, { ...SHEET_6IN, gap: 1, margin: 3 });
    expect(spaced.placements.length).toBeLessThan(touching.placements.length);
    expect(spaced.placements.length).toBeGreaterThan(0);
    // packTemplate throws on any overlap or margin breach, so reaching here
    // means both layouts verified.
  });

  it("keeps rows 1.5mm apart when asked, while pieces in a row still touch", () => {
    const t = templatesOf("gp3", { shortEdge: 50 }).find((x) => x.label === "Pentagon")!;
    const tight = packTemplate(t, SHEET_6IN);
    const spaced = packTemplate(t, { ...SHEET_6IN, rowGap: 1.5 });
    // packTemplate verifies every cross-row pair at >= rowGap and throws otherwise.
    expect(spaced.placements.length).toBeLessThan(tight.placements.length);
    expect(spaced.placements.length).toBeGreaterThan(0.75 * tight.placements.length);
  });

  it("packs concave panels by their hull", () => {
    const hex = templatesOf("circle-soccer").find((t) => t.count === 20)!;
    const r = packTemplate(hex, SHEET_6IN);
    expect(r.packedByHull).toBe(true);
    expect(r.placements.length).toBeGreaterThan(20);
  });

  it("returns nothing (rather than throwing) when a panel can't fit the sheet", () => {
    const t = templatesOf("gp3")[0];
    expect(packTemplate(t, { sheetW: 5, sheetH: 5, gap: 0, rowGap: 0, margin: 1 }).placements).toHaveLength(0);
  });

  it("writes one copy per placement into a mm-true sheet SVG", () => {
    const t = templatesOf("gp3")[0];
    const r = packTemplate(t, SHEET_6IN);
    const svg = sheetToSvg(t, r, SHEET_6IN, { showHoles: true });
    expect(svg).toContain('width="152.400mm" height="152.400mm" viewBox="0 0 152.400 152.400"');
    expect(svg.match(/<g transform=/g)).toHaveLength(r.placements.length);
    expect(svg.match(/<circle /g)).toHaveLength(r.placements.length * (t.holes.length + t.markerHoles.length));
    expect(sheetToSvg(t, r, SHEET_6IN, { showHoles: false })).not.toContain("<circle ");
    expect(cutOutline(t).length).toBeGreaterThan(10);
  });
});
