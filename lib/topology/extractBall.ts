import type { Document } from "@gltf-transform/core";
import { preprocessMesh } from "@/scripts/lib/mesh-preprocess";
import { detectSeams, traceCurveSegments } from "@/scripts/lib/seam-detect";
import { enumerateFaces, pruneSpuriousFace } from "@/scripts/lib/planar-dual";
import { sphericalRdpIndices } from "@/scripts/lib/spherical-rdp";
import {
  computeTopologyStats,
  validateTopology,
} from "@/scripts/lib/topology-validate";
import { importedBallTopology } from "./importedBall";
import type { PanelTopology } from "@/lib/types";

/**
 * Curve fidelity for in-app extraction. The CLI defaults to 0.5° (data
 * file size matters there); in the browser the only cost is a few extra
 * boundary vertices, and laser templates want the wave detail.
 */
const RDP_TOLERANCE_DEG = 0.2;

/**
 * Extract a panel topology from a foreign ball GLB — the same pipeline
 * as scripts/import-ball-topology.ts (best-fit sphere + weld, seam
 * detection with primitives → uv-seams → hard-edges auto-fallback,
 * spherical RDP, planar-dual face enumeration, full validation) but
 * browser-safe and returning a ready `PanelTopology` instead of writing
 * data files.
 *
 * Throws with a human-readable reason when the mesh isn't a panelled
 * ball or any validation check fails; callers surface the message and
 * fall back to viewing the raw GLB.
 */
export function extractBallTopology(doc: Document): PanelTopology {
  const {
    mesh,
    report: preprocReport,
    perPrimitive,
  } = preprocessMesh(doc, { weldEpsilon: 1e-4 });
  if (!preprocReport.sphericityOk) {
    throw new Error("mesh is not approximately spherical");
  }

  // The CLI's auto-detect commits to the first mode whose seam GRAPH
  // looks valid, but a plausible graph can still enumerate to a broken
  // panel set (a puffed bevel mesh gives primitives mode spurious
  // junctions). Here each mode runs the whole pipeline and must survive
  // full validation; the first that does wins.
  const failures: string[] = [];
  for (const mode of ["primitives", "uv-seams", "hard-edges"] as const) {
    try {
      const seamResult = detectSeams(mesh, perPrimitive, mode, {
        hardEdgeThresholdDeg: 30,
      });
      const graph = seamResult.graph;
      if (graph.junctions.size === 0) {
        throw new Error("no panel corners found");
      }

      const rawSegments = traceCurveSegments(graph);
      const tolRad = RDP_TOLERANCE_DEG * (Math.PI / 180);
      const segments = rawSegments.map((s) => ({
        ...s,
        path: sphericalRdpIndices(s.path, mesh.positions, tolRad),
      }));

      const { panels: rawPanels } = enumerateFaces(segments, mesh.positions);
      const panels = pruneSpuriousFace(rawPanels, graph);

      const topoStats = computeTopologyStats(panels, mesh.positions);
      const checks = validateTopology(
        panels,
        mesh.positions,
        preprocReport,
        topoStats,
        { closureTolerance: 0.01, areaVarianceTolerance: 0.3 },
      );
      const failed = checks.filter((c) => !c.pass);
      if (failed.length > 0) {
        throw new Error(
          `failed validation: ${failed.map((c) => c.name).join("; ")}`,
        );
      }

      // Compact the vertex pool to just the panel-boundary vertices
      // (same remap the CLI's data emitter does) and hand off to the
      // shared imported-ball builder (normalize + re-densify + edges).
      const used = new Set<number>();
      for (const loop of panels) for (const v of loop) used.add(v);
      const sortedVerts = [...used].sort((a, b) => a - b);
      const remap = new Map<number, number>();
      sortedVerts.forEach((v, i) => remap.set(v, i));
      const vertices: [number, number, number][] = sortedVerts.map((v) => [
        mesh.positions[v * 3],
        mesh.positions[v * 3 + 1],
        mesh.positions[v * 3 + 2],
      ]);
      const faces = panels.map((loop) => loop.map((v) => remap.get(v)!));

      return importedBallTopology(vertices, faces, 1);
    } catch (err) {
      failures.push(
        `${mode}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw new Error(`no extraction mode succeeded — ${failures.join(" | ")}`);
}
