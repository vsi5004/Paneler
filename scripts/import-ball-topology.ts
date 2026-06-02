/**
 * Import a soccer ball GLB and emit a Paneler topology data file.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json \
 *     scripts/import-ball-topology.ts <input.glb> <slug> [options]
 *
 * See scripts/IMPORTING_BALLS.md for the full workflow.
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";

import { NodeIO } from "@gltf-transform/core";

import { preprocessMesh } from "./lib/mesh-preprocess.js";
import {
  detectSeams,
  overrideJunctions,
  traceCurveSegments,
} from "./lib/seam-detect.js";
import { enumerateFaces } from "./lib/planar-dual.js";
import { sphericalRdpIndices } from "./lib/spherical-rdp.js";
import {
  computeTopologyStats,
  validateTopology,
  formatReport,
  junctionDegreeHistogram,
  type VerificationReport,
} from "./lib/topology-validate.js";
import { renderSvgPreview } from "./lib/svg-preview.js";
import type { ExtractionMode, ImportOptions } from "./lib/types.js";

// ----------------------------------------------------------------------------
// CLI parsing
// ----------------------------------------------------------------------------

interface ParsedArgs {
  options: ImportOptions;
  showHelp: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length < 2 || argv.includes("--help") || argv.includes("-h")) {
    return {
      showHelp: true,
      options: {
        glbPath: "",
        slug: "",
        label: "",
        mode: "auto",
        rdpToleranceDegrees: 0.5,
        hardEdgeThresholdDegrees: 30,
        weldEpsilon: 1e-4,
        noPreview: false,
      },
    };
  }
  const glbPath = argv[0];
  const slug = argv[1];
  let label = humanizeSlug(slug);
  let mode: ImportOptions["mode"] = "auto";
  let rdpToleranceDegrees = 0.5;
  let hardEdgeThresholdDegrees = 30;
  let weldEpsilon = 1e-4;
  let noPreview = false;
  let overrideJunctionsPath: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--mode":
        mode = next() as ImportOptions["mode"];
        if (!["auto", "uv-seams", "hard-edges", "primitives"].includes(mode)) {
          throw new Error(`Invalid --mode: ${mode}`);
        }
        break;
      case "--rdp-tolerance":
        rdpToleranceDegrees = parseFloat(next());
        break;
      case "--hard-edge-threshold":
        hardEdgeThresholdDegrees = parseFloat(next());
        break;
      case "--weld-epsilon":
        weldEpsilon = parseFloat(next());
        break;
      case "--label":
        label = next();
        break;
      case "--no-preview":
        noPreview = true;
        break;
      case "--override-junctions":
        overrideJunctionsPath = next();
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  const overrideJunctionsValue: ImportOptions["overrideJunctions"] =
    overrideJunctionsPath
      ? (JSON.parse(
          readFileSync(overrideJunctionsPath, "utf8"),
        ) as Array<[number, number, number]>)
      : undefined;

  return {
    showHelp: false,
    options: {
      glbPath,
      slug,
      label,
      mode,
      rdpToleranceDegrees,
      hardEdgeThresholdDegrees,
      weldEpsilon,
      noPreview,
      overrideJunctions: overrideJunctionsValue,
    },
  };
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

const HELP = `
Import a soccer ball GLB into a Paneler topology.

Usage:
  npx tsx --tsconfig tsconfig.scripts.json \\
    scripts/import-ball-topology.ts <input.glb> <slug> [options]

Required:
  <input.glb>                        Path to the source GLB.
  <slug>                             URL-safe identifier; output files are
                                     named lib/topology/<slug>-data.ts etc.

Options:
  --mode <auto|uv-seams|hard-edges|primitives>
                                     Detection mode. default: auto
  --rdp-tolerance <degrees>          Spherical RDP tolerance. default: 0.5
  --hard-edge-threshold <degrees>    For hard-edges mode. default: 30
  --weld-epsilon <units>             Vertex welding distance. default: 1e-4
  --label "<Display Name>"           Human label. default: derived from slug
  --no-preview                       Skip the SVG preview output.
  --override-junctions <path>        Path to JSON: [[x,y,z], ...] junction
                                     positions. Snaps to nearest welded vert.

Outputs:
  lib/topology/<slug>-data.ts        Generated topology data.
  lib/topology/<slug>.ts             Wrapper exporting a PanelTopology fn.
  lib/topology/<slug>-preview.svg    Visual sanity-check overlay.
  lib/topology/<slug>-report.json    Verification report as JSON.

See scripts/IMPORTING_BALLS.md for the full workflow.
`;

// ----------------------------------------------------------------------------
// Main pipeline
// ----------------------------------------------------------------------------

async function main() {
  const { options, showHelp } = parseArgs(process.argv.slice(2));
  if (showHelp) {
    console.log(HELP);
    return;
  }

  // 1. Load GLB
  console.log(`Loading ${options.glbPath} ...`);
  const io = new NodeIO();
  const doc = await io.read(options.glbPath);

  // 2. Preprocess mesh (best-fit sphere, weld, component filter)
  const { mesh, report: preprocReport, perPrimitive } = preprocessMesh(doc, {
    weldEpsilon: options.weldEpsilon,
  });
  if (!preprocReport.sphericityOk) {
    console.warn(
      "⚠  Sphericity check failed — mesh isn't a clean sphere. Continuing, but extraction may be unreliable.",
    );
  }

  // 3. Detect seams (in requested or auto mode)
  const seamResult = detectSeams(mesh, perPrimitive, options.mode, {
    hardEdgeThresholdDeg: options.hardEdgeThresholdDegrees,
  });
  let graph = seamResult.graph;

  // 4. Optional: override junctions
  if (options.overrideJunctions) {
    graph = overrideJunctions(mesh, graph, options.overrideJunctions);
    seamResult.notes.push(
      `Override applied: ${options.overrideJunctions.length} user-specified junctions snapped to nearest welded verts → ${graph.junctions.size} unique`,
    );
  }

  if (graph.junctions.size === 0) {
    throw new Error(
      "No junctions found. The mesh may not be a panelled ball, or the chosen mode is wrong. Try --mode hard-edges with a smaller threshold.",
    );
  }

  // 5. Trace curve segments between junctions
  const rawSegments = traceCurveSegments(graph);
  const curveSamplesPre = rawSegments.map((s) => s.path.length);

  // 6. Downsample each segment with spherical RDP
  const tolRad = options.rdpToleranceDegrees * (Math.PI / 180);
  const segments = rawSegments.map((s) => ({
    ...s,
    path: sphericalRdpIndices(s.path, mesh.positions, tolRad),
  }));
  const curveSamplesPost = segments.map((s) => s.path.length);

  // 7. Enumerate faces (planar dual)
  const { panels: rawPanels } = enumerateFaces(segments, mesh.positions);

  // 8. Drop the largest face if Euler says there's one too many. On a
  //    sphere-embedded graph, the rotation-system walk produces a face
  //    per region, including a possible "outer" face when the rotation
  //    convention misorients one. We sanity-check via Euler χ = 2: if
  //    V − E + F = 3, drop the largest face (the spurious one).
  const panels = pruneSpuriousFace(rawPanels, graph);

  // 9. Stats + validation
  const topoStats = computeTopologyStats(panels, mesh.positions);
  const checks = validateTopology(panels, mesh.positions, preprocReport, topoStats, {
    closureTolerance: 0.01,
    areaVarianceTolerance: 0.3,
  });

  const report: VerificationReport = {
    slug: options.slug,
    label: options.label,
    source: {
      meshes: doc.getRoot().listMeshes().length,
      primitives: perPrimitive.length + preprocReport.source.components - perPrimitive.length, // approx
      rawVerts: mesh.source.rawVertices,
      weldedVerts: mesh.source.weldedVertices,
      triangles: mesh.source.triangles,
      hasUvs: mesh.source.hasUvs,
      hadNormals: mesh.source.hadNormals,
    },
    preprocessing: preprocReport,
    extraction: {
      modeUsed: seamResult.modeUsed,
      modeNotes: seamResult.notes,
      seamEdges: graph.edges.length,
      seamVerts: graph.vertices.size,
      junctions: graph.junctions.size,
      junctionDegrees: junctionDegreeHistogram(graph.junctions, graph.adjacency),
      curveSegments: segments.length,
      curveSamplesPre,
      curveSamplesPost,
    },
    topology: topoStats,
    checks,
  };

  // 10. Emit data files
  ensureDir(resolve("lib/topology"));
  emitDataFile(options, panels, mesh.positions, seamResult.modeUsed);
  emitWrapperFile(options);
  if (!options.noPreview) {
    emitSvgPreview(options, mesh.positions, graph.edges, panels, graph.junctions);
  }
  emitReportJson(options, report);

  // 11. Print report
  console.log(formatReport(report));

  const allPass = checks.every((c) => c.pass);
  if (!allPass) {
    console.error(
      "\nOne or more validation checks failed. Output files still written for inspection,",
    );
    console.error("but DO NOT bake this topology until all checks pass.");
    console.error("Try: --mode <other>, --rdp-tolerance <value>, or --override-junctions.");
    process.exit(2);
  }

  console.log(`\nNext steps:`);
  console.log(`  1. Open lib/topology/${options.slug}-preview.svg to visually verify.`);
  console.log(`  2. Add this row to PRESETS in lib/topology/presets.ts:`);
  console.log(
    `       { id: "${options.slug}", label: "${options.label}", panels: ${panels.length}, topology: ${slugToFunctionName(options.slug)} },`,
  );
  console.log(`     and add: import { ${slugToFunctionName(options.slug)} } from "./${options.slug}";`);
  console.log(`  3. Run: npm run bake:glb`);
}

main().catch((err) => {
  console.error(`\n✗ Import failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

// ----------------------------------------------------------------------------
// Output emitters
// ----------------------------------------------------------------------------

function emitDataFile(
  options: ImportOptions,
  panels: number[][],
  positions: Float32Array,
  mode: ExtractionMode,
): void {
  // Collect all unique vertex indices used by the panels, build a compact
  // remap so the emitted data file uses 0..N-1 indices.
  const used = new Set<number>();
  for (const loop of panels) for (const v of loop) used.add(v);
  const sortedVerts = [...used].sort((a, b) => a - b);
  const remap = new Map<number, number>();
  sortedVerts.forEach((v, i) => remap.set(v, i));

  const upperSlug = options.slug.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const lines: string[] = [];
  lines.push(`// Auto-generated from ${basename(options.glbPath)} — do not edit by hand.`);
  lines.push(`// Generated by scripts/import-ball-topology.ts (mode: ${mode}).`);
  lines.push(`// Re-run that script to regenerate. See scripts/IMPORTING_BALLS.md.`);
  lines.push("");
  lines.push(`export const ${upperSlug}_VERTICES: ReadonlyArray<readonly [number, number, number]> = [`);
  for (const v of sortedVerts) {
    lines.push(
      `  [${positions[v * 3].toFixed(6)}, ${positions[v * 3 + 1].toFixed(6)}, ${positions[v * 3 + 2].toFixed(6)}],`,
    );
  }
  lines.push(`];`);
  lines.push("");
  lines.push(`export const ${upperSlug}_FACES: ReadonlyArray<ReadonlyArray<number>> = [`);
  for (const loop of panels) {
    const remapped = loop.map((v) => remap.get(v)!);
    lines.push(`  [${remapped.join(", ")}],`);
  }
  lines.push(`];`);
  lines.push("");

  const path = resolve(`lib/topology/${options.slug}-data.ts`);
  writeFileSync(path, lines.join("\n"));
  console.log(`Wrote ${path}  (${sortedVerts.length} verts, ${panels.length} panels)`);
}

function emitWrapperFile(options: ImportOptions): void {
  const upperSlug = options.slug.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const fnName = slugToFunctionName(options.slug);
  const wrapper = `import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";
import { ${upperSlug}_VERTICES, ${upperSlug}_FACES } from "./${options.slug}-data";

/**
 * ${options.label} — imported via scripts/import-ball-topology.ts.
 *
 * Boundary curves extracted from the source GLB and downsampled with
 * spherical RDP. Each panel is a closed loop of welded-vertex indices.
 */
export function ${fnName}(radius = 1): PanelTopology {
  const vertices = ${upperSlug}_VERTICES.map(([x, y, z]) => {
    const v = new Vector3(x, y, z);
    v.setLength(radius);
    return v;
  });

  const panels = ${upperSlug}_FACES.map((vertexIndices, idx) => {
    const shape = shapeForVertexCount(vertexIndices.length);
    return {
      id: panelId(idx, shape),
      vertexIndices: [...vertexIndices],
      shape,
    };
  });

  const edgeMap = new Map<string, PanelEdge>();
  for (const panel of panels) {
    const loop = panel.vertexIndices;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const key = a < b ? \`\${a}-\${b}\` : \`\${b}-\${a}\`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.panelB = panel.id;
      } else {
        edgeMap.set(key, {
          vertexA: Math.min(a, b),
          vertexB: Math.max(a, b),
          panelA: panel.id,
          panelB: null,
        });
      }
    }
  }

  return { vertices, panels, edges: [...edgeMap.values()] };
}
`;
  const path = resolve(`lib/topology/${options.slug}.ts`);
  writeFileSync(path, wrapper);
  console.log(`Wrote ${path}`);
}

function emitSvgPreview(
  options: ImportOptions,
  positions: Float32Array,
  seams: ReadonlyArray<readonly [number, number]>,
  panels: number[][],
  junctions: ReadonlySet<number>,
): void {
  const svg = renderSvgPreview(
    positions,
    seams.map((e) => [e[0], e[1]] as [number, number]),
    panels,
    junctions,
  );
  const path = resolve(`lib/topology/${options.slug}-preview.svg`);
  writeFileSync(path, svg);
  console.log(`Wrote ${path}`);
}

function emitReportJson(
  options: ImportOptions,
  report: VerificationReport,
): void {
  const path = resolve(`lib/topology/${options.slug}-report.json`);
  writeFileSync(path, JSON.stringify(report, jsonReplacer, 2) + "\n");
  console.log(`Wrote ${path}`);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

function ensureDir(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    // ignore — already exists
  }
  void dirname; // silence unused-import warning when not strict
}

function slugToFunctionName(slug: string): string {
  // "al-rihla" → "alRihla"; "trionda" → "trionda"; "soccer_ball" → "soccerBall"
  const parts = slug.split(/[-_]/);
  return (
    parts[0].toLowerCase() +
    parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("")
  );
}

// ----------------------------------------------------------------------------
// Topology cleanup
// ----------------------------------------------------------------------------

/**
 * Drop the spurious "outer" face if the rotation-system walk produced one
 * too many. On a sphere with N panels, Euler χ = V − E + F = 2 → F = N.
 * If we instead got F = N + 1, the largest face is the spurious one.
 */
function pruneSpuriousFace(
  panels: number[][],
  graph: { vertices: Set<number>; edges: ReadonlyArray<readonly [number, number]> },
): number[][] {
  // Compute χ as-is to decide whether to prune.
  const vSet = new Set<number>();
  const eSet = new Set<string>();
  for (const loop of panels) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      vSet.add(a);
      vSet.add(b);
      eSet.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    }
  }
  const chi = vSet.size - eSet.size + panels.length;
  if (chi === 2) return panels;
  if (chi !== 3) {
    // Something more serious is wrong; return panels and let validation flag it.
    return panels;
  }
  // χ = 3 → one spurious face. Drop the one with the largest perimeter
  // (the outer face winds around all the inner faces, so it's longest).
  let worstIdx = -1;
  let worstLen = -1;
  for (let i = 0; i < panels.length; i++) {
    if (panels[i].length > worstLen) {
      worstLen = panels[i].length;
      worstIdx = i;
    }
  }
  return panels.filter((_, i) => i !== worstIdx);
}
