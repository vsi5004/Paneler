import { SPHERE_RADIUS } from "@/lib/glb/generate";
import { mmPerUnit } from "@/lib/laser/constants";
import { unstitchedSideMm, type LaserTemplateOptions } from "@/lib/laser/template";
import type { LaserSettings } from "@/lib/laser/types";
import {
  resolvePresetParams,
  type PresetEntry,
  type PresetParamDef,
  type PresetParams,
} from "@/lib/topology/presets";

/** Correction from a length param's seam length to its template label, at one value. */
export interface LengthOffset {
  value: number;
  offsetMm: number;
}

/** The seam length a length param (one with `lengthAngle`) sets, in mm. */
export function seamMm(def: PresetParamDef, value: number, diameterIn: number): number {
  return (def.lengthAngle?.(value) ?? 0) * SPHERE_RADIUS * mmPerUnit(diameterIn);
}

/**
 * Count-controlled designs label the short side corner stitch to corner
 * stitch, not along the bare seam. The gap between the two is measured
 * from the generator alone (no mesh) every 10% of the slider's range,
 * then wherever interpolating it would miss by more than 0.005mm the
 * interval is split (it bends sharply where small short sides cap the
 * corner extensions) — so the Short edge slider can show, and step in,
 * the length the template labels at any value.
 */
export function templateLengthOffsets(
  preset: PresetEntry,
  def: PresetParamDef,
  params: PresetParams,
  settings: LaserSettings,
  options: LaserTemplateOptions,
): LengthOffset[] {
  const measure = (value: number): LengthOffset | null => {
    const topo = preset.topology(SPHERE_RADIUS, resolvePresetParams(preset, { ...params, [def.key]: value }));
    const side = unstitchedSideMm(topo, settings, options);
    // No short side (the soccer ball at 0%) — nothing to correct.
    return side ? { value, offsetMm: (side.minMm + side.maxMm) / 2 - seamMm(def, value, settings.diameterIn) } : null;
  };
  const refine = (a: LengthOffset, b: LengthOffset, depth: number): LengthOffset[] => {
    if (depth === 0 || b.value - a.value < 0.25) return [];
    const mid = measure((a.value + b.value) / 2);
    if (!mid) return [];
    const guess = (a.offsetMm + b.offsetMm) / 2;
    if (Math.abs(mid.offsetMm - guess) < 0.005) return [];
    return [...refine(a, mid, depth - 1), mid, ...refine(mid, b, depth - 1)];
  };
  const steps = Math.max(2, Math.ceil((def.max - def.min) / 10));
  const grid: LengthOffset[] = [];
  for (let i = 0; i <= steps; i++) {
    // Where the short side vanishes at the minimum, anchor just above it.
    const o = measure(def.min + ((def.max - def.min) * i) / steps) ?? (i === 0 ? measure(def.min + 0.5) : null);
    if (o) grid.push(o);
  }
  return grid.flatMap((o, i) => (i === 0 ? [o] : [...refine(grid[i - 1], o, 6), o]));
}

/** The template's label length at `value`, from `offsets` (bare seam length without them). */
export function labelMm(
  def: PresetParamDef,
  value: number,
  diameterIn: number,
  offsets: LengthOffset[] | undefined,
): number {
  let offset = 0;
  if (offsets && offsets.length > 0) {
    const k = offsets.findIndex((o) => o.value >= value);
    if (k <= 0) offset = offsets[k === 0 ? 0 : offsets.length - 1].offsetMm;
    else {
      const a = offsets[k - 1];
      const b = offsets[k];
      offset = a.offsetMm + ((b.offsetMm - a.offsetMm) * (value - a.value)) / (b.value - a.value);
    }
  }
  return Math.max(0, seamMm(def, value, diameterIn) + offset);
}

/** The value whose label length is `mm` (the length grows with the value). */
export function valueForMm(
  def: PresetParamDef,
  mm: number,
  diameterIn: number,
  offsets: LengthOffset[] | undefined,
): number {
  let lo = def.min;
  let hi = def.max;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (labelMm(def, mid, diameterIn, offsets) < mm) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 1000) / 1000;
}
