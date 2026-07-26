/**
 * Build the TRUE 12-panel Orbita topology from the LaLiga 2022-23 FBX.
 *
 * The source model only encodes 6 UV islands (each merging a panel
 * pair) on a cube morphology: 8 degree-3 junctions, 12 zigzag seam
 * curves, 6 shuriken faces. The real ball splits each face in two.
 *
 * The construction exploits the design's symmetry:
 *   1. The 8 junctions form a cube graph — bipartite. One color class
 *      of 4 is an inscribed TETRAHEDRON; each face has exactly two
 *      (diagonally opposite) tetra corners. Connecting them splits all
 *      6 faces into 12 congruent panels, with three split seams and
 *      three boundary seams meeting at each tetra corner — matching
 *      the ball's four large three-armed graphics.
 *   2. The split seam's SHAPE is copied from the existing boundary
 *      curves ("copy the spoke"): a template zigzag is expressed as
 *      (arc-fraction, signed perpendicular angular offset) relative to
 *      its chord's great circle, then transplanted onto each diagonal
 *      chord. Both handedness signs are tried; the one yielding ONE
 *      congruence class of 12 wins.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/split-orbita.ts <smooth.glb>
 *
 * Emits lib/topology/orbita-data.ts + orbita.ts + orbita-preview.svg,
 * validated with --expect-panels 12 semantics before writing.
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
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

async function main() {
  const glbPath = process.argv[2];
  if (!glbPath) throw new Error("usage: split-orbita.ts <smooth.glb>");

  // --- 1. Extract the 6-face topology (same pipeline as the importer) ---
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const { mesh, report: preprocReport, perPrimitive } = preprocessMesh(doc, {
    weldEpsilon: 1e-4,
  });
  const seam = detectSeams(mesh, perPrimitive, "uv-seams", {});
  const rawSegments = traceCurveSegments(seam.graph);
  const tolRad = 0.2 * (Math.PI / 180);
  const segments = rawSegments.map((s) => ({
    ...s,
    path: sphericalRdpIndices(s.path, mesh.positions, tolRad),
  }));
  const { panels: rawPanels } = enumerateFaces(segments, mesh.positions);
  const faces6 = pruneSpuriousFace(rawPanels, seam.graph);
  if (faces6.length !== 6) {
    throw new Error(`expected 6 extracted faces, got ${faces6.length}`);
  }

  const pos = (i: number): V3 =>
    norm([
      mesh.positions[i * 3],
      mesh.positions[i * 3 + 1],
      mesh.positions[i * 3 + 2],
    ]);

  // --- 2. Two-color the junction cube graph; pick a tetrahedron ---
  const junctions = [...seam.graph.junctions];
  const segEnds = segments.map((s) => [s.path[0], s.path[s.path.length - 1]]);
  const jAdj = new Map<number, Set<number>>();
  for (const [a, b] of segEnds) {
    if (!jAdj.has(a)) jAdj.set(a, new Set());
    if (!jAdj.has(b)) jAdj.set(b, new Set());
    jAdj.get(a)!.add(b);
    jAdj.get(b)!.add(a);
  }
  const color = new Map<number, number>();
  const queue = [junctions[0]];
  color.set(junctions[0], 0);
  while (queue.length) {
    const v = queue.shift()!;
    for (const n of jAdj.get(v) ?? []) {
      if (!color.has(n)) {
        color.set(n, 1 - color.get(v)!);
        queue.push(n);
      } else if (color.get(n) === color.get(v)) {
        throw new Error("junction graph is not bipartite — not a cube morphology");
      }
    }
  }
  const tetra = new Set(junctions.filter((j) => color.get(j) === 0));
  if (tetra.size !== 4) throw new Error(`tetra class has ${tetra.size} corners`);

  // --- 3. Diagonal construction ---
  // Copying a boundary spoke onto the diagonal chord fails: at a
  // pinwheel tip the interior wedge points sideways, so ANY curve
  // following the corner-to-corner great circle (zigzag or straight)
  // immediately crosses the adjacent boundary spokes. Instead the
  // diagonal leaves each corner along the wedge BISECTOR — by the
  // design's C3 symmetry at tetra corners this is exactly where the
  // real seam sits (six seams alternating spoke/diagonal at ~60°) —
  // and follows a spherical cubic Bezier between the two corners,
  // point-symmetrized about the face center (the C2 the real seam
  // network has there).
  const slerp = (a: V3, b: V3, t: number): V3 => {
    const ang = Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
    if (ang < 1e-12) return a;
    const sA = Math.sin((1 - t) * ang) / Math.sin(ang);
    const sB = Math.sin(t * ang) / Math.sin(ang);
    return norm(add(scale(a, sA), scale(b, sB)));
  };
  const rotateToward = (p: V3, dir: V3, ang: number): V3 =>
    norm(add(scale(p, Math.cos(ang)), scale(dir, Math.sin(ang))));

  // Tangent-plane direction at `corner` toward `to`.
  const tangentDir = (corner: V3, to: V3): V3 => {
    const d = add(to, scale(corner, -dot(to, corner)));
    return norm(d);
  };

  const bezier = (P: V3[], t: number): V3 => {
    let pts = P;
    while (pts.length > 1) {
      const next: V3[] = [];
      for (let i = 0; i + 1 < pts.length; i++) next.push(slerp(pts[i], pts[i + 1], t));
      pts = next;
    }
    return pts[0];
  };

  // Diagonal from corner A to corner B inside a face loop. bisA/bisB are
  // the wedge bisector directions at each corner (unit tangents).
  const N_DIAG = 40;
  const makeDiagonal = (A: V3, B: V3, bisA: V3, bisB: V3): V3[] => {
    const arc = Math.acos(Math.min(1, Math.max(-1, dot(A, B))));
    const k = 0.35 * arc;
    const P: V3[] = [A, rotateToward(A, bisA, k), rotateToward(B, bisB, k), B];
    const raw: V3[] = [];
    for (let i = 1; i < N_DIAG; i++) raw.push(bezier(P, i / N_DIAG));
    // Point-symmetrize about the face center axis: average with the
    // curve's 180°-rotated, reversed self.
    const mid = norm(slerp(A, B, 0.5)); // approx face-center direction on the chord
    const rot180 = (v: V3): V3 =>
      norm(add(scale(mid, 2 * dot(mid, v)), scale(v, -1)));
    return raw.map((v, i) => slerp(v, rot180(raw[raw.length - 1 - i]), 0.5));
  };

  // Great-arc self-crossing count for a closed loop of vertex positions.
  const crossings = (pts: V3[]): number => {
    const inArc = (x: V3, u: V3, v: V3) => {
      const uv = Math.acos(Math.min(1, Math.max(-1, dot(u, v))));
      const xu = Math.acos(Math.min(1, Math.max(-1, dot(u, x))));
      const xv = Math.acos(Math.min(1, Math.max(-1, dot(v, x))));
      return xu <= uv + 1e-9 && xv <= uv + 1e-9;
    };
    const n = pts.length;
    let count = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const n1 = norm(cross(pts[i], pts[(i + 1) % n]));
        const n2 = norm(cross(pts[j], pts[(j + 1) % n]));
        const line = cross(n1, n2);
        const L = Math.hypot(...line);
        if (L < 1e-9) continue;
        const u: V3 = [line[0] / L, line[1] / L, line[2] / L];
        for (const s of [1, -1] as const) {
          const x = scale(u, s);
          if (
            inArc(x, pts[i], pts[(i + 1) % n]) &&
            inArc(x, pts[j], pts[(j + 1) % n])
          ) {
            count++;
          }
        }
      }
    }
    return count;
  };

  // --- 4. Split every face along its tetra diagonal ---
  const build = () => {
    const vertices: V3[] = [];
    const indexOfMesh = new Map<number, number>();
    const vertOf = (vi: number): number => {
      let idx = indexOfMesh.get(vi);
      if (idx === undefined) {
        idx = vertices.length;
        vertices.push(pos(vi));
        indexOfMesh.set(vi, idx);
      }
      return idx;
    };
    const faces: number[][] = [];
    for (const loop of faces6) {
      // corner positions within the loop
      const cornerIdx = loop
        .map((vi, i) => ({ vi, i }))
        .filter(({ vi }) => seam.graph.junctions.has(vi));
      if (cornerIdx.length !== 4) {
        throw new Error(`face has ${cornerIdx.length} junction corners`);
      }
      const tetraCorners = cornerIdx.filter(({ vi }) => tetra.has(vi));
      if (tetraCorners.length !== 2) {
        throw new Error(`face has ${tetraCorners.length} tetra corners`);
      }
      const [c1, c2] = tetraCorners;
      const bisectorAt = (ci: { i: number }): V3 => {
        const corner = pos(loop[ci.i]);
        const prev = pos(loop[(ci.i - 1 + loop.length) % loop.length]);
        const next = pos(loop[(ci.i + 1) % loop.length]);
        return norm(add(tangentDir(corner, prev), tangentDir(corner, next)));
      };
      // boundary arcs c1→c2 and c2→c1 (dense, in loop order)
      const arc = (from: number, to: number): number[] => {
        const out: number[] = [];
        for (let i = from; ; i = (i + 1) % loop.length) {
          out.push(loop[i]);
          if (i === to) break;
        }
        return out;
      };
      const half1 = arc(c1.i, c2.i);
      const half2 = arc(c2.i, c1.i);
      // diagonal seam c2→c1 (shared verts between the two halves)
      const diag = makeDiagonal(
        pos(loop[c2.i]),
        pos(loop[c1.i]),
        bisectorAt(c2),
        bisectorAt(c1),
      );
      const diagIdx = diag.map((p) => {
        vertices.push(p);
        return vertices.length - 1;
      });
      faces.push([...half1.map(vertOf), ...diagIdx]);
      faces.push([...half2.map(vertOf), ...[...diagIdx].reverse()]);
    }
    return { vertices, faces };
  };

  // Congruence score: spread of panel perimeter+area (want ONE class).
  const congruenceSpread = (vertices: V3[], faces: number[][]) => {
    const sigs = faces.map((loop) => {
      let per = 0;
      let areaV: V3 = [0, 0, 0];
      for (let i = 0; i < loop.length; i++) {
        const a = vertices[loop[i]];
        const b = vertices[loop[(i + 1) % loop.length]];
        per += Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
        areaV = add(areaV, cross(a, b));
      }
      return per + Math.hypot(...areaV) / 2;
    });
    const mean = sigs.reduce((s, x) => s + x, 0) / sigs.length;
    return Math.max(...sigs.map((s) => Math.abs(s - mean))) / mean;
  };

  const chosen = build();
  const totalCrossings = chosen.faces.reduce(
    (s, loop) => s + crossings(loop.map((i) => chosen.vertices[i])),
    0,
  );
  const spread = congruenceSpread(chosen.vertices, chosen.faces);
  console.log(
    `wedge-bisector diagonal: crossings ${totalCrossings}, congruence spread ${(spread * 100).toFixed(2)}%`,
  );
  if (totalCrossings > 0) {
    throw new Error("diagonal still crosses the boundary — inspect preview");
  }

  // --- 5. Validate exactly like the importer would ---
  const flat = new Float32Array(chosen.vertices.length * 3);
  chosen.vertices.forEach((v, i) => {
    flat[i * 3] = v[0];
    flat[i * 3 + 1] = v[1];
    flat[i * 3 + 2] = v[2];
  });
  const stats = computeTopologyStats(chosen.faces, flat);
  const checks = validateTopology(chosen.faces, flat, preprocReport, stats, {
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

  // --- 6. Emit data + wrapper + preview ---
  const lines: string[] = [];
  lines.push(`// Auto-generated from ${basename(glbPath)} — do not edit by hand.`);
  lines.push(`// Generated by scripts/split-orbita.ts (uv-seams + tetra-diagonal split).`);
  lines.push(`// Re-run that script to regenerate. See scripts/IMPORTING_BALLS.md.`);
  lines.push("");
  lines.push(`export const ORBITA_VERTICES: ReadonlyArray<readonly [number, number, number]> = [`);
  for (const v of chosen.vertices) {
    lines.push(`  [${v[0].toFixed(6)}, ${v[1].toFixed(6)}, ${v[2].toFixed(6)}],`);
  }
  lines.push(`];`);
  lines.push("");
  lines.push(`export const ORBITA_FACES: ReadonlyArray<ReadonlyArray<number>> = [`);
  for (const f of chosen.faces) {
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
 * Orbita (LaLiga 2022-23) — 12 congruent zigzag panels.
 *
 * The source model only encodes 6 UV islands (each merging a panel
 * pair); scripts/split-orbita.ts reconstructs the true 12-panel layout
 * by splitting each cube-morphology face along its inscribed-tetrahedron
 * diagonal, with the seam shape copied from the existing boundary
 * curves (the design is symmetric, so the "spoke" transplants exactly).
 */
export function orbita(radius = 1): PanelTopology {
  return importedBallTopology(ORBITA_VERTICES, ORBITA_FACES, radius);
}
`,
  );

  // preview: the SPLIT 12-panel layout over the source seams
  const flatPos = new Float32Array(chosen.vertices.length * 3);
  chosen.vertices.forEach((v, i) => {
    flatPos[i * 3] = v[0];
    flatPos[i * 3 + 1] = v[1];
    flatPos[i * 3 + 2] = v[2];
  });
  const svg = renderSvgPreview(
    flatPos,
    [],
    chosen.faces,
    new Set(
      [...seam.graph.junctions]
        .map((j) => {
          // map mesh junction index into chosen-vertex indexing
          const p = pos(j);
          let best = -1;
          let bestD = Infinity;
          chosen.vertices.forEach((v, i) => {
            const d = (v[0]-p[0])**2 + (v[1]-p[1])**2 + (v[2]-p[2])**2;
            if (d < bestD) { bestD = d; best = i; }
          });
          return best;
        }),
    ),
  );
  writeFileSync("lib/topology/orbita-preview.svg", svg);
  console.log("wrote lib/topology/orbita-data.ts, orbita.ts, orbita-preview.svg");
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
