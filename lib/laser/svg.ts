import {
  CUT_COLOR,
  CUT_STROKE_MM,
  HOLE_COLOR,
  HOLE_STROKE_MM,
  STITCH_HOLE_DIAMETER_MM,
} from "./constants";
import type { LaserSettings, LaserTemplate } from "./types";

/**
 * Render a template as a standalone SVG document string, millimeter-true:
 * width/height carry mm units and the viewBox is in mm coordinates, so
 * laser software (LightBurn, LaserWeb) imports at exact physical size.
 * Cut outline is black; stitch holes are red circles so they map to a
 * separate operation.
 */
export function templateToSvg(t: LaserTemplate): string {
  const { minX, minY, width, height } = t.bounds;
  const holeR = STITCH_HOLE_DIAMETER_MM / 2;
  const holes = t.holes
    .map(
      (h) =>
        `    <circle cx="${h.x.toFixed(3)}" cy="${h.y.toFixed(3)}" r="${holeR}" fill="none" stroke="${HOLE_COLOR}" stroke-width="${HOLE_STROKE_MM}"/>`,
    )
    .join("\n");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(3)}mm" height="${height.toFixed(3)}mm" viewBox="${minX.toFixed(3)} ${minY.toFixed(3)} ${width.toFixed(3)} ${height.toFixed(3)}">`,
    `  <path d="${t.cutPath}" fill="none" stroke="${CUT_COLOR}" stroke-width="${CUT_STROKE_MM}"/>`,
    `  <g id="stitch-holes">`,
    holes,
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

/** e.g. "soccer_hexagon-a_1.8in_2mm.svg" */
export function templateFilename(
  designName: string,
  t: LaserTemplate,
  s: LaserSettings,
): string {
  const slug = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "design";
  const size = `${parseFloat(s.diameterIn.toFixed(2))}in`;
  const bite = `${parseFloat(s.biteDepthMm.toFixed(2))}mm`;
  return `${slug(designName)}_${slug(t.label)}_${size}_${bite}.svg`;
}
