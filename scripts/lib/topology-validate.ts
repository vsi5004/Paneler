/**
 * Validate extracted topology + assemble the verification report.
 *
 * Checks:
 *   - Every panel has ≥ 3 vertices.
 *   - Every panel boundary is a simple loop (no repeated verts).
 *   - Every edge is shared by exactly 2 panels (or 0/1 in defective cases).
 *   - Sum of panel solid angles = 4π ± closure tolerance.
 *   - Per-panel area variance within bounds.
 *   - Euler characteristic V − E + F = 2 (sphere topology).
 *
 * The verification report is both human-readable text and machine-readable
 * JSON, so the importer can dump it to stdout AND to a .json file that
 * other scripts can consume.
 */
import type { ExtractionMode } from "./types.js";
import type { PreprocessReport } from "./mesh-preprocess.js";

export interface VerificationReport {
  slug: string;
  label: string;
  source: SourceMeshStats;
  preprocessing: PreprocessReport;
  extraction: ExtractionStats;
  topology: TopologyStats;
  checks: PassFailCheck[];
}

export interface SourceMeshStats {
  meshes: number;
  primitives: number;
  rawVerts: number;
  weldedVerts: number;
  triangles: number;
  hasUvs: boolean;
  hadNormals: boolean;
}

export interface ExtractionStats {
  modeUsed: ExtractionMode;
  modeNotes: string[];
  seamEdges: number;
  seamVerts: number;
  junctions: number;
  junctionDegrees: Array<{ degree: number; count: number }>;
  curveSegments: number;
  curveSamplesPre: number[]; // per segment
  curveSamplesPost: number[]; // per segment after RDP
}

export interface TopologyStats {
  panelCount: number;
  boundarySizes: number[];
  perimeter: { min: number; max: number; mean: number };
  solidAngle: { min: number; max: number; mean: number; total: number };
  eulerCharacteristic: number;
  uniqueVertices: number;
  uniqueEdges: number;
}

export interface PassFailCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ValidateOptions {
  /** Sphere closure tolerance (relative to 4π). */
  closureTolerance: number;
  /** Max per-panel area variation as fraction of mean. */
  areaVarianceTolerance: number;
}

/** Compute topology stats from panel loops + the welded vertex pool. */
export function computeTopologyStats(
  panels: number[][],
  positions: Float32Array,
): TopologyStats {
  const boundarySizes = panels.map((p) => p.length);
  const perimeter = perimeterStats(panels, positions);
  const solidAngle = solidAngleStats(panels, positions);

  const vSet = new Set<number>();
  const eSet = new Set<string>();
  for (const loop of panels) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      vSet.add(a);
      vSet.add(b);
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      eSet.add(key);
    }
  }

  return {
    panelCount: panels.length,
    boundarySizes,
    perimeter,
    solidAngle,
    eulerCharacteristic: vSet.size - eSet.size + panels.length,
    uniqueVertices: vSet.size,
    uniqueEdges: eSet.size,
  };
}

/** Run validation. Returns a list of pass/fail checks (does not throw). */
export function validateTopology(
  panels: number[][],
  positions: Float32Array,
  preprocReport: PreprocessReport,
  topoStats: TopologyStats,
  options: ValidateOptions,
): PassFailCheck[] {
  const checks: PassFailCheck[] = [];

  // 1. Sphericity from preprocessing
  checks.push({
    name: "Sphericity (input mesh)",
    pass: preprocReport.sphericityOk,
    detail: `95% of source verts within [0.92, 1.08] after best-fit scaling. p5=${preprocReport.radiusDistribution[1].toFixed(3)} p95=${preprocReport.radiusDistribution[3].toFixed(3)}`,
  });

  // 2. Every panel has ≥ 3 vertices
  const tooSmall = panels.filter((p) => p.length < 3).length;
  checks.push({
    name: "Every panel has ≥ 3 vertices",
    pass: tooSmall === 0,
    detail: `${tooSmall} panel(s) have fewer than 3 vertices`,
  });

  // 3. Every panel boundary is a simple loop
  let nonSimple = 0;
  for (const loop of panels) {
    const seen = new Set<number>();
    for (const v of loop) {
      if (seen.has(v)) {
        nonSimple++;
        break;
      }
      seen.add(v);
    }
  }
  checks.push({
    name: "All panel boundaries are simple loops",
    pass: nonSimple === 0,
    detail: `${nonSimple} panel(s) have repeated vertices`,
  });

  // 4. Every edge is shared by exactly 2 panels
  const edgeCount = new Map<string, number>();
  for (const loop of panels) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  let badEdges = 0;
  for (const c of edgeCount.values()) if (c !== 2) badEdges++;
  checks.push({
    name: "Every edge shared by exactly 2 panels",
    pass: badEdges === 0,
    detail: `${badEdges} edges have wrong panel-share count`,
  });

  // 5. Sphere closure (solid angles sum to 4π)
  const closureErr = Math.abs(topoStats.solidAngle.total - 4 * Math.PI);
  const closureFrac = closureErr / (4 * Math.PI);
  checks.push({
    name: `Sphere closure (Σ solid angles = 4π ± ${(options.closureTolerance * 100).toFixed(1)}%)`,
    pass: closureFrac < options.closureTolerance,
    detail: `total=${topoStats.solidAngle.total.toFixed(4)} expected=${(4 * Math.PI).toFixed(4)} err=${(closureFrac * 100).toFixed(3)}%`,
  });

  // 6. Panel area variance
  const meanArea = topoStats.solidAngle.mean;
  const variance =
    meanArea > 0
      ? (topoStats.solidAngle.max - topoStats.solidAngle.min) / meanArea
      : 0;
  checks.push({
    name: `Panel area variance < ${(options.areaVarianceTolerance * 100).toFixed(0)}%`,
    pass: variance < options.areaVarianceTolerance,
    detail: `(max - min) / mean = ${(variance * 100).toFixed(2)}%`,
  });

  // 7. Euler characteristic = 2
  checks.push({
    name: "Euler characteristic V − E + F = 2",
    pass: topoStats.eulerCharacteristic === 2,
    detail: `V=${topoStats.uniqueVertices} E=${topoStats.uniqueEdges} F=${topoStats.panelCount} χ=${topoStats.eulerCharacteristic}`,
  });

  return checks;
}

/** Format the report for terminal output. */
export function formatReport(report: VerificationReport): string {
  const lines: string[] = [];
  const sep = "─".repeat(72);
  lines.push(sep);
  lines.push(`  Ball topology import: ${report.label}  (slug=${report.slug})`);
  lines.push(sep);

  lines.push("\nSource mesh:");
  lines.push(`  meshes=${report.source.meshes}  primitives=${report.source.primitives}`);
  lines.push(`  verts: ${report.source.rawVerts} → ${report.source.weldedVerts} welded`);
  lines.push(`  triangles: ${report.source.triangles}`);
  lines.push(`  has UVs: ${report.source.hasUvs}   had normals: ${report.source.hadNormals}`);

  lines.push("\nPreprocessing:");
  lines.push(
    `  original center: (${report.preprocessing.originalCenter.map((x) => x.toFixed(3)).join(", ")})`,
  );
  lines.push(`  best-fit radius (median): ${report.preprocessing.bestFitRadius.toFixed(4)}`);
  const d = report.preprocessing.radiusDistribution;
  lines.push(
    `  scaled radius distribution: min=${d[0].toFixed(3)} p5=${d[1].toFixed(3)} p50=${d[2].toFixed(3)} p95=${d[3].toFixed(3)} max=${d[4].toFixed(3)}`,
  );
  lines.push(
    `  components: ${report.preprocessing.source.components} (kept verts=${report.preprocessing.source.keptComponentVerts}, dropped verts=${report.preprocessing.source.droppedComponentVerts})`,
  );

  lines.push("\nExtraction:");
  for (const n of report.extraction.modeNotes) lines.push(`  • ${n}`);
  lines.push(`  seam edges: ${report.extraction.seamEdges}  seam verts: ${report.extraction.seamVerts}`);
  lines.push(`  junctions: ${report.extraction.junctions}`);
  if (report.extraction.junctionDegrees.length > 0) {
    lines.push(`  junction degree histogram:`);
    for (const { degree, count } of report.extraction.junctionDegrees) {
      lines.push(`    degree ${degree}: ${count}`);
    }
  }
  lines.push(`  curve segments: ${report.extraction.curveSegments}`);
  if (report.extraction.curveSamplesPre.length > 0) {
    const preMin = Math.min(...report.extraction.curveSamplesPre);
    const preMax = Math.max(...report.extraction.curveSamplesPre);
    const postMin = Math.min(...report.extraction.curveSamplesPost);
    const postMax = Math.max(...report.extraction.curveSamplesPost);
    lines.push(
      `  curve samples: pre-RDP ${preMin}-${preMax}, post-RDP ${postMin}-${postMax}`,
    );
  }

  lines.push("\nOutput topology:");
  lines.push(`  panels: ${report.topology.panelCount}`);
  lines.push(
    `  boundary sizes: ${report.topology.boundarySizes.join(", ")}`,
  );
  const p = report.topology.perimeter;
  lines.push(
    `  perimeter:   min=${p.min.toFixed(3)} max=${p.max.toFixed(3)} mean=${p.mean.toFixed(3)}`,
  );
  const sa = report.topology.solidAngle;
  lines.push(
    `  solid angle: min=${sa.min.toFixed(3)} max=${sa.max.toFixed(3)} mean=${sa.mean.toFixed(3)}  total=${sa.total.toFixed(3)} (4π=${(4 * Math.PI).toFixed(3)})`,
  );
  lines.push(
    `  V=${report.topology.uniqueVertices}  E=${report.topology.uniqueEdges}  F=${report.topology.panelCount}  χ=${report.topology.eulerCharacteristic}`,
  );

  lines.push("\nChecks:");
  let allPass = true;
  for (const c of report.checks) {
    lines.push(`  ${c.pass ? "✓" : "✗"} ${c.name}`);
    lines.push(`      ${c.detail}`);
    if (!c.pass) allPass = false;
  }
  lines.push(sep);
  lines.push(allPass ? "  ALL CHECKS PASSED" : "  FAILED — see ✗ entries above");
  lines.push(sep);
  return lines.join("\n");
}

// ============================================================================
// Geometry helpers
// ============================================================================

function perimeterStats(
  panels: number[][],
  positions: Float32Array,
): { min: number; max: number; mean: number } {
  const perims = panels.map((loop) => {
    let total = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const dx = positions[a * 3] - positions[b * 3];
      const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
      const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
      total += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return total;
  });
  return {
    min: Math.min(...perims),
    max: Math.max(...perims),
    mean: perims.reduce((a, b) => a + b, 0) / perims.length,
  };
}

function solidAngleStats(
  panels: number[][],
  positions: Float32Array,
): { min: number; max: number; mean: number; total: number } {
  const areas = panels.map((loop) => solidAngle(loop, positions));
  const total = areas.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...areas),
    max: Math.max(...areas),
    mean: total / areas.length,
    total,
  };
}

/** Solid angle of a polygon on a unit sphere via fan from polygon centroid. */
function solidAngle(loop: number[], positions: Float32Array): number {
  // Compute centroid (mean direction, normalized).
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const v of loop) {
    cx += positions[v * 3];
    cy += positions[v * 3 + 1];
    cz += positions[v * 3 + 2];
  }
  const cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
  const a = [cx / cl, cy / cl, cz / cl] as [number, number, number];

  // Van Oosterom & Strackee for each fan triangle (a, b, c).
  let total = 0;
  for (let i = 0; i < loop.length; i++) {
    const b: [number, number, number] = [
      positions[loop[i] * 3],
      positions[loop[i] * 3 + 1],
      positions[loop[i] * 3 + 2],
    ];
    const c: [number, number, number] = [
      positions[loop[(i + 1) % loop.length] * 3],
      positions[loop[(i + 1) % loop.length] * 3 + 1],
      positions[loop[(i + 1) % loop.length] * 3 + 2],
    ];
    const triple =
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
    const denom =
      1 +
      a[0] * b[0] +
      a[1] * b[1] +
      a[2] * b[2] +
      b[0] * c[0] +
      b[1] * c[1] +
      b[2] * c[2] +
      c[0] * a[0] +
      c[1] * a[1] +
      c[2] * a[2];
    total += 2 * Math.atan2(triple, denom);
  }
  return Math.abs(total);
}

/** Junction degree histogram. */
export function junctionDegreeHistogram(
  junctions: Set<number>,
  adjacency: Map<number, Set<number>>,
): Array<{ degree: number; count: number }> {
  const hist = new Map<number, number>();
  for (const j of junctions) {
    const d = adjacency.get(j)?.size ?? 0;
    hist.set(d, (hist.get(d) ?? 0) + 1);
  }
  return [...hist.entries()]
    .map(([degree, count]) => ({ degree, count }))
    .sort((a, b) => a.degree - b.degree);
}
