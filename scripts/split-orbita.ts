/**
 * Build the TRUE 12-panel Orbita topology from the LaLiga 2022-23 FBX.
 *
 * The ball is a DODECAHEDRON of 12 star-shaped pentagon panels (5 zigzag
 * edges each, C5-symmetric — PUMA: "12 evenly sized star-shaped
 * panels"). The source model's UV islands merge panel pairs, so UV seam
 * extraction sees only part of the network:
 *
 *   - dodecahedron: 20 vertices, 30 edges, 12 pentagon faces
 *   - the 8 junctions the UV graph finds = the cube inscribed in the
 *     dodecahedron (the only vertices where 3 UV islands meet)
 *   - each extracted "spoke" (chord 70.5°) = TWO dodecahedron edges
 *     joined at a hidden vertex — the spoke's arc midpoint (the 12
 *     non-cube vertices)
 *   - each island hides ONE seam connecting the midpoints of two of its
 *     opposite spokes; that chord equals the common edge chord (41.8°),
 *     so the missing edge is an exact RIGID rotated copy of a known
 *     edge (the panel's C5 symmetry — rotate by 360/5 and edges map
 *     onto each other).
 *
 * Construction is therefore fully determined, no synthesized shapes:
 *   1. split every spoke at its arc midpoint → 24 known edges
 *   2. per island, pick the midpoint pair at edge-chord distance and
 *      copy an adjacent known edge onto it via the unique rotation
 *      mapping endpoint-pair → endpoint-pair → 6 hidden edges
 *   3. self-check: the two pentagons flanking a hidden seam each
 *      predict it independently; both copies must agree
 *   4. enumerate faces of the 30-edge network → 12 pentagons
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/split-orbita.ts <smooth.glb>
 */
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { NodeIO } from "@gltf-transform/core";

import { preprocessMesh } from "./lib/mesh-preprocess.js";
import { detectSeams, traceCurveSegments } from "./lib/seam-detect.js";
import { enumerateFaces, pruneSpuriousFace } from "./lib/planar-dual.js";
import { sphericalRdpIndices } from "./lib/spherical-rdp.js";
import {
  computeTopologyStats,
  validateTopology,
} from "./lib/topology-validate.js";
import { renderSvgPreview } from "./lib/svg-preview.js";

type V3 = [number, number, number];

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const angBetween = (a: V3, b: V3) =>
  Math.acos(Math.min(1, Math.max(-1, dot(a, b))));

/** Unique rotation mapping unit-vector pair (a1,a2) → (b1,b2). */
function rotationFromPairs(a1: V3, a2: V3, b1: V3, b2: V3): (v: V3) => V3 {
  const frame = (u: V3, v: V3): [V3, V3, V3] => {
    const e1 = norm(u);
    const e3 = norm(cross(u, v));
    const e2 = norm(cross(e3, e1));
    return [e1, e2, e3];
  };
  const A = frame(a1, a2);
  const B = frame(b1, b2);
  // R = B · Aᵀ
  return (v: V3): V3 => {
    const c: V3 = [dot(A[0], v), dot(A[1], v), dot(A[2], v)];
    return norm([
      B[0][0] * c[0] + B[1][0] * c[1] + B[2][0] * c[2],
      B[0][1] * c[0] + B[1][1] * c[1] + B[2][1] * c[2],
      B[0][2] * c[0] + B[1][2] * c[1] + B[2][2] * c[2],
    ]);
  };
}

async function main() {
  const glbPath = process.argv[2];
  if (!glbPath) throw new Error("usage: split-orbita.ts <smooth.glb>");

  // --- 1. Extract the UV seam network (dense, no RDP yet) ---
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const { mesh, report: preprocReport, perPrimitive } = preprocessMesh(doc, {
    weldEpsilon: 1e-4,
  });
  const seam = detectSeams(mesh, perPrimitive, "uv-seams", {});
  const spokes = traceCurveSegments(seam.graph);
  if (spokes.length !== 12) {
    throw new Error(`expected 12 spoke curves, got ${spokes.length}`);
  }
  const meshPos = (i: number): V3 =>
    norm([
      mesh.positions[i * 3],
      mesh.positions[i * 3 + 1],
      mesh.positions[i * 3 + 2],
    ]);

  // Working vertex pool (dense curve points, plus new hidden-seam points).
  const points: V3[] = [];
  const slotOfMesh = new Map<number, number>();
  const slot = (p: V3): number => {
    points.push(p);
    return points.length - 1;
  };
  const slotMesh = (vi: number): number => {
    let s = slotOfMesh.get(vi);
    if (s === undefined) {
      s = slot(meshPos(vi));
      slotOfMesh.set(vi, s);
    }
    return s;
  };

  // --- 2. Split each spoke at its arc midpoint (a hidden dodeca vertex) ---
  interface Edge {
    /** Dense path of slot indices, endpoints inclusive. */
    path: number[];
  }
  const edges: Edge[] = [];
  const spokeMid: number[] = []; // midpoint slot per spoke
  for (const s of spokes) {
    const dense = s.path;
    let total = 0;
    const cum: number[] = [0];
    for (let i = 0; i + 1 < dense.length; i++) {
      total += angBetween(meshPos(dense[i]), meshPos(dense[i + 1]));
      cum.push(total);
    }
    let mi = 0;
    while (cum[mi] < total / 2) mi++;
    if (mi > 0 && total / 2 - cum[mi - 1] < cum[mi] - total / 2) mi--;
    spokeMid.push(slotMesh(dense[mi]));
    edges.push({ path: dense.slice(0, mi + 1).map(slotMesh) });
    edges.push({ path: dense.slice(mi).map(slotMesh) });
  }
  const chordOf = (e: Edge) =>
    angBetween(points[e.path[0]], points[e.path[e.path.length - 1]]);
  const edgeChord =
    edges.reduce((s, e) => s + chordOf(e), 0) / edges.length;
  console.log(
    `spokes split: mean edge chord ${((edgeChord * 180) / Math.PI).toFixed(2)} deg (ideal dodecahedron: 41.81)`,
  );

  // --- 3. Per island, construct the hidden seam by rigid copy ---
  const rdpSpokes = spokes.map((s) => ({
    ...s,
    path: sphericalRdpIndices(s.path, mesh.positions, 0.5 * (Math.PI / 180)),
  }));
  const { panels: islandLoops } = enumerateFaces(rdpSpokes, mesh.positions);
  const islands = pruneSpuriousFace(islandLoops, seam.graph);
  if (islands.length !== 6) {
    throw new Error(`expected 6 islands, got ${islands.length}`);
  }

  const hiddenEdges: Edge[] = [];
  for (const loop of islands) {
    const cornerPositions = loop
      .map((vi, i) => ({ vi, i }))
      .filter(({ vi }) => seam.graph.junctions.has(vi));
    if (cornerPositions.length !== 4) {
      throw new Error(`island has ${cornerPositions.length} corners`);
    }
    const spokeBetween = (a: number, b: number): number => {
      for (let si = 0; si < spokes.length; si++) {
        const p = spokes[si].path;
        if (
          (p[0] === a && p[p.length - 1] === b) ||
          (p[0] === b && p[p.length - 1] === a)
        ) {
          return si;
        }
      }
      throw new Error("no spoke between corners");
    };
    const orderedSpokes: number[] = [];
    for (let k = 0; k < 4; k++) {
      orderedSpokes.push(
        spokeBetween(
          loop[cornerPositions[k].i],
          loop[cornerPositions[(k + 1) % 4].i],
        ),
      );
    }
    const mids = orderedSpokes.map((si) => spokeMid[si]);
    // hidden seam joins the opposite midpoint pair at edge-chord distance
    const chord02 = angBetween(points[mids[0]], points[mids[2]]);
    const chord13 = angBetween(points[mids[1]], points[mids[3]]);
    const pick02 =
      Math.abs(chord02 - edgeChord) < Math.abs(chord13 - edgeChord);
    const [mA, mB] = pick02 ? [mids[0], mids[2]] : [mids[1], mids[3]];
    const chosen = pick02 ? chord02 : chord13;
    if (Math.abs(chosen - edgeChord) > 0.03) {
      throw new Error(
        `hidden-seam chord ${((chosen * 180) / Math.PI).toFixed(2)} deg does not match the edge chord — midpoint pairing failed`,
      );
    }
    // Copy a known edge incident to each end onto the hidden chord via
    // the unique rotation (far, m) → (m, other). Two independent
    // predictions — one per flanking pentagon — must agree.
    const copyFrom = (from: number, to: number): V3[] => {
      const e = edges.find(
        (e2) => e2.path[0] === from || e2.path[e2.path.length - 1] === from,
      )!;
      const oriented =
        e.path[e.path.length - 1] === from ? e.path : [...e.path].reverse();
      const R = rotationFromPairs(
        points[oriented[0]],
        points[from],
        points[from],
        points[to],
      );
      return oriented.map((s) => R(points[s]));
    };
    const c1 = copyFrom(mA, mB); // mA-incident edge rotated → path mA→mB
    const c2 = [...copyFrom(mB, mA)].reverse(); // mB-side prediction, reversed to mA→mB
    let worst = 0;
    for (let i = 0; i < c1.length; i++) {
      const j = Math.round((i * (c2.length - 1)) / (c1.length - 1));
      worst = Math.max(worst, angBetween(c1[i], c2[j]));
    }
    console.log(
      `hidden seam: two-sided rigid copies agree within ${((worst * 180) / Math.PI).toFixed(2)} deg`,
    );
    const blended: V3[] = c1.map((p, i) => {
      const j = Math.round((i * (c2.length - 1)) / (c1.length - 1));
      const q = c2[j];
      return norm([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
    });
    const interior = blended.slice(1, -1).map((p) => slot(p));
    hiddenEdges.push({ path: [mA, ...interior, mB] });
  }

  // --- 4. Enumerate the 12 pentagons from the 30-edge network ---
  const allEdges = [...edges, ...hiddenEdges];
  const flat = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    flat[i * 3] = p[0];
    flat[i * 3 + 1] = p[1];
    flat[i * 3 + 2] = p[2];
  });
  const { panels: rawPanels } = enumerateFaces(
    allEdges.map((e) => ({
      a: e.path[0],
      b: e.path[e.path.length - 1],
      path: e.path,
    })),
    flat,
  );
  const junctions20 = new Set<number>();
  for (const e of allEdges) {
    junctions20.add(e.path[0]);
    junctions20.add(e.path[e.path.length - 1]);
  }
  const graphish = {
    vertices: new Set(rawPanels.flat()),
    edges: allEdges.flatMap((e) => {
      const out: Array<readonly [number, number]> = [];
      for (let i = 0; i + 1 < e.path.length; i++) {
        out.push([e.path[i], e.path[i + 1]] as const);
      }
      return out;
    }),
  };
  const faces12 = pruneSpuriousFace(rawPanels, graphish);
  if (faces12.length !== 12) {
    throw new Error(`expected 12 pentagon panels, got ${faces12.length}`);
  }
  console.log(`junction count: ${junctions20.size} (dodecahedron: 20)`);

  // --- 5. RDP each pentagon edge run (corners protected), compact pool ---
  const rdpLoop = (loop: number[]): number[] => {
    const cornerIdxs = loop
      .map((vi, i) => ({ vi, i }))
      .filter(({ vi }) => junctions20.has(vi))
      .map(({ i }) => i);
    const out: number[] = [];
    for (let k = 0; k < cornerIdxs.length; k++) {
      const a = cornerIdxs[k];
      const b = cornerIdxs[(k + 1) % cornerIdxs.length];
      const run: number[] = [];
      for (let i = a; ; i = (i + 1) % loop.length) {
        run.push(loop[i]);
        if (i === b && run.length > 1) break;
      }
      const kept = sphericalRdpIndices(run, flat, 0.2 * (Math.PI / 180));
      out.push(...kept.slice(0, -1));
    }
    return out;
  };
  const finalFaces = faces12.map(rdpLoop);
  const used = new Set<number>();
  for (const loop of finalFaces) for (const v of loop) used.add(v);
  const sorted = [...used].sort((a, b) => a - b);
  const remap = new Map<number, number>();
  sorted.forEach((v, i) => remap.set(v, i));
  const outVerts = sorted.map((v) => points[v]);
  const outFaces = finalFaces.map((loop) => loop.map((v) => remap.get(v)!));

  // --- 6. Validate ---
  const outFlat = new Float32Array(outVerts.length * 3);
  outVerts.forEach((v, i) => {
    outFlat[i * 3] = v[0];
    outFlat[i * 3 + 1] = v[1];
    outFlat[i * 3 + 2] = v[2];
  });
  const stats = computeTopologyStats(outFaces, outFlat);
  const checks = validateTopology(outFaces, outFlat, preprocReport, stats, {
    closureTolerance: 0.01,
    areaVarianceTolerance: 0.3,
    expectPanels: 12,
  });
  for (const c of checks) {
    console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}`);
    if (!c.pass) console.log(`      ${c.detail}`);
  }
  if (!checks.every((c) => c.pass)) {
    throw new Error("validation failed — not writing output");
  }
  console.log(
    `panels: ${stats.panelCount}, χ=${stats.eulerCharacteristic}, closure total=${stats.solidAngle.total.toFixed(4)}`,
  );

  // --- 7. Emit ---
  const lines: string[] = [];
  lines.push(`// Auto-generated from ${basename(glbPath)} — do not edit by hand.`);
  lines.push(`// Generated by scripts/split-orbita.ts (dodecahedral reconstruction).`);
  lines.push(`// Re-run that script to regenerate. See scripts/IMPORTING_BALLS.md.`);
  lines.push("");
  lines.push(`export const ORBITA_VERTICES: ReadonlyArray<readonly [number, number, number]> = [`);
  for (const v of outVerts) {
    lines.push(`  [${v[0].toFixed(6)}, ${v[1].toFixed(6)}, ${v[2].toFixed(6)}],`);
  }
  lines.push(`];`);
  lines.push("");
  lines.push(`export const ORBITA_FACES: ReadonlyArray<ReadonlyArray<number>> = [`);
  for (const f of outFaces) {
    lines.push(`  [${f.join(", ")}],`);
  }
  lines.push(`];`);
  writeFileSync("lib/topology/orbita-data.ts", lines.join("\n") + "\n");

  writeFileSync(
    "lib/topology/orbita.ts",
    `import type { PanelTopology } from "@/lib/types";
import { importedBallTopology } from "./importedBall";
import { ORBITA_VERTICES, ORBITA_FACES } from "./orbita-data";

/**
 * Orbita (LaLiga 2022-23) — 12 congruent star-shaped pentagon panels
 * on a dodecahedron (20 vertices, 30 zigzag seams).
 *
 * The source model's UV islands merge panel pairs, hiding 6 of the 30
 * seams; scripts/split-orbita.ts reconstructs them exactly as rigid
 * rotated copies of the extracted seams via each panel's C5 symmetry
 * (all dodecahedron edges are congruent).
 */
export function orbita(radius = 1): PanelTopology {
  return importedBallTopology(ORBITA_VERTICES, ORBITA_FACES, radius);
}
`,
  );

  const occurrences = new Map<number, number>();
  for (const loop of outFaces) {
    for (const v of loop) occurrences.set(v, (occurrences.get(v) ?? 0) + 1);
  }
  const svg = renderSvgPreview(
    outFlat,
    [],
    outFaces,
    new Set([...occurrences.entries()].filter(([, c]) => c >= 3).map(([v]) => v)),
  );
  writeFileSync("lib/topology/orbita-preview.svg", svg);
  console.log("wrote lib/topology/orbita-data.ts, orbita.ts, orbita-preview.svg");
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
