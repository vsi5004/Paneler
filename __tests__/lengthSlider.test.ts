import { describe, expect, it } from "vitest";

import { presetById, resolvePresetParams } from "@/lib/topology/presets";
import { unstitchedSideMm } from "@/lib/laser/template";
import { defaultLaserSettings } from "@/lib/laser/constants";
import { SPHERE_RADIUS } from "@/lib/glb/generate";
import { labelMm, templateLengthOffsets, valueForMm } from "@/lib/laser/lengthSlider";

describe("Short edge slider in mm", () => {
  it.each(["soccer", "gp3"])("%s: reads the template's stitch-to-stitch length and steps back to it", (id) => {
    const preset = presetById(id)!;
    const def = preset.params!.find((d) => d.lengthAngle)!;
    const settings = { ...defaultLaserSettings(), ...preset.laserDefaults };
    const options = { holeCount: preset.laserHoleCount };
    const offsets = templateLengthOffsets(preset, def, {}, settings, options);
    for (const value of [def.min + 3.3, (def.min + def.max) / 2 + 1.7, def.max - 2.9]) {
      const topo = preset.topology(SPHERE_RADIUS, resolvePresetParams(preset, { [def.key]: value }));
      const side = unstitchedSideMm(topo, settings, options)!;
      const mm = labelMm(def, value, settings.diameterIn, offsets);
      expect(Math.abs(mm - (side.minMm + side.maxMm) / 2)).toBeLessThan(0.01);
      // A 0.1mm slider step converts back to the value that reads it.
      const target = Math.round(mm * 10) / 10;
      expect(labelMm(def, valueForMm(def, target, settings.diameterIn, offsets), settings.diameterIn, offsets)).toBeCloseTo(target, 2);
    }
  });

  it("soccer defaults to a 4.00mm short edge at its template's size and holes", () => {
    const preset = presetById("soccer")!;
    const def = preset.params![0];
    const settings = { ...defaultLaserSettings(), ...preset.laserDefaults };
    const topo = preset.topology(SPHERE_RADIUS, resolvePresetParams(preset));
    const side = unstitchedSideMm(topo, settings, { holeCount: preset.laserHoleCount })!;
    expect(side.minMm).toBeCloseTo(4, 2);
    expect(side.maxMm).toBeCloseTo(4, 2);
    expect(def.defaultValue).toBeGreaterThan(0);
  });
});
