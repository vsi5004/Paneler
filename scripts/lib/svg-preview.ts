/**
 * Equirectangular SVG preview of an extracted topology, overlaid on the
 * source mesh's detected seam edges. The point is visual sanity-check:
 * if the green extracted boundaries trace the gray source seams, you
 * know extraction worked without having to bake + open the app.
 *
 * Projection: simple lat-lon (Plate Carrée). Each unit-sphere position
 * (x, y, z) maps to:
 *   lon = atan2(z, x)        ∈ (-π, π]
 *   lat = asin(y)            ∈ [-π/2, π/2]
 *   svgX = (lon + π) / (2π) * W
 *   svgY = (π/2 - lat) / π * H
 *
 * Polylines crossing the antimeridian (|Δlon| > π) get split into two
 * segments so they don't draw a long horizontal stripe across the
 * canvas.
 */
import type { SeamEdge } from "./types.js";

export interface SvgPreviewOptions {
  width?: number;
  height?: number;
  /** Color for the gray source-mesh seams layer. */
  sourceColor?: string;
  /** Color for the extracted topology layer. */
  topologyColor?: string;
  /** Color for junction markers. */
  junctionColor?: string;
}

export function renderSvgPreview(
  positions: Float32Array,
  sourceSeams: SeamEdge[],
  panels: number[][],
  junctions: ReadonlySet<number>,
  opts: SvgPreviewOptions = {},
): string {
  const W = opts.width ?? 1200;
  const H = opts.height ?? 600;
  const sourceColor = opts.sourceColor ?? "rgba(255,255,255,0.18)";
  const topologyColor = opts.topologyColor ?? "#b5e853";
  const junctionColor = opts.junctionColor ?? "#ffb648";

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:#0a0a0c">`,
  );

  // Grid lines (meridians every 30° and parallels every 30°) for spatial reference.
  lines.push(`<g stroke="#222" stroke-width="0.5" fill="none">`);
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = ((lon + 180) / 360) * W;
    lines.push(`  <line x1="${x}" y1="0" x2="${x}" y2="${H}" />`);
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    const y = ((90 - lat) / 180) * H;
    lines.push(`  <line x1="0" y1="${y}" x2="${W}" y2="${y}" />`);
  }
  lines.push(`</g>`);

  const toSvg = ([lon, lat]: [number, number]): [number, number] => [
    ((lon + 180) / 360) * W,
    ((90 - lat) / 180) * H,
  ];

  // Layer 1: source mesh seam edges (gray, thin).
  lines.push(
    `<g stroke="${sourceColor}" stroke-width="0.8" fill="none" stroke-linecap="round">`,
  );
  for (const [a, b] of sourceSeams) {
    drawSegment(
      lines,
      project(positions, a),
      project(positions, b),
      toSvg,
    );
  }
  lines.push(`</g>`);

  // Layer 2: extracted panel boundaries (green, thicker).
  lines.push(
    `<g stroke="${topologyColor}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-opacity="0.9">`,
  );
  for (const loop of panels) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      drawSegment(
        lines,
        project(positions, a),
        project(positions, b),
        toSvg,
      );
    }
  }
  lines.push(`</g>`);

  // Junction markers.
  lines.push(`<g fill="${junctionColor}">`);
  for (const j of junctions) {
    const [x, y] = project(positions, j);
    lines.push(`  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" />`);
  }
  lines.push(`</g>`);

  // Panel-centroid labels.
  lines.push(
    `<g fill="${topologyColor}" font-family="JetBrains Mono, monospace" font-size="9" text-anchor="middle">`,
  );
  for (let i = 0; i < panels.length; i++) {
    const loop = panels[i];
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const v of loop) {
      cx += positions[v * 3];
      cy += positions[v * 3 + 1];
      cz += positions[v * 3 + 2];
    }
    const cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
    cx /= cl;
    cy /= cl;
    cz /= cl;
    const [px, py] = projectXyz(cx, cy, cz);
    const svgX = ((px + 180) / 360) * W;
    const svgY = ((90 - py) / 180) * H;
    lines.push(
      `  <text x="${svgX.toFixed(1)}" y="${(svgY + 3).toFixed(1)}">P${i + 1}</text>`,
    );
  }
  lines.push(`</g>`);

  // Legend.
  lines.push(
    `<g font-family="JetBrains Mono, monospace" font-size="10" fill="#bbb">`,
  );
  lines.push(
    `  <rect x="8" y="${H - 56}" width="170" height="48" fill="#111" stroke="#333" />`,
  );
  lines.push(
    `  <line x1="16" y1="${H - 42}" x2="40" y2="${H - 42}" stroke="${sourceColor}" stroke-width="0.8" />`,
  );
  lines.push(`  <text x="46" y="${H - 38}">source seams</text>`);
  lines.push(
    `  <line x1="16" y1="${H - 26}" x2="40" y2="${H - 26}" stroke="${topologyColor}" stroke-width="1.5" />`,
  );
  lines.push(`  <text x="46" y="${H - 22}">extracted</text>`);
  lines.push(
    `  <circle cx="28" cy="${H - 12}" r="3.5" fill="${junctionColor}" />`,
  );
  lines.push(`  <text x="46" y="${H - 9}">junctions</text>`);
  lines.push(`</g>`);

  lines.push(`</svg>`);
  return lines.join("\n");
}

function project(
  positions: Float32Array,
  v: number,
): [number, number] {
  return projectXyz(
    positions[v * 3],
    positions[v * 3 + 1],
    positions[v * 3 + 2],
  );
}

/** (x, y, z) on unit sphere → (lon°, lat°) */
function projectXyz(x: number, y: number, z: number): [number, number] {
  const lon = (Math.atan2(z, x) * 180) / Math.PI;
  const lat = (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
  return [lon, lat];
}

function drawSegment(
  out: string[],
  a: [number, number],
  b: [number, number],
  toSvg: (p: [number, number]) => [number, number],
): void {
  // If the segment crosses the antimeridian (|Δlon| > 180), split it
  // so we don't draw a long horizontal stripe across the canvas.
  if (Math.abs(b[0] - a[0]) > 180) {
    const aSvg = toSvg(a);
    const midA: [number, number] = [
      a[0] < b[0] ? -180 : 180,
      (a[1] + b[1]) / 2,
    ];
    const midASvg = toSvg(midA);
    out.push(
      `  <line x1="${aSvg[0].toFixed(1)}" y1="${aSvg[1].toFixed(1)}" x2="${midASvg[0].toFixed(1)}" y2="${midASvg[1].toFixed(1)}" />`,
    );
    const midB: [number, number] = [
      a[0] < b[0] ? 180 : -180,
      (a[1] + b[1]) / 2,
    ];
    const midBSvg = toSvg(midB);
    const bSvg = toSvg(b);
    out.push(
      `  <line x1="${midBSvg[0].toFixed(1)}" y1="${midBSvg[1].toFixed(1)}" x2="${bSvg[0].toFixed(1)}" y2="${bSvg[1].toFixed(1)}" />`,
    );
    return;
  }
  const aSvg = toSvg(a);
  const bSvg = toSvg(b);
  out.push(
    `  <line x1="${aSvg[0].toFixed(1)}" y1="${aSvg[1].toFixed(1)}" x2="${bSvg[0].toFixed(1)}" y2="${bSvg[1].toFixed(1)}" />`,
  );
}
