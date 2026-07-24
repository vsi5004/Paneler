import { Vector3 } from "three";
import type { Panel, PanelTopology } from "@/lib/types";
import type { PanelFlat } from "@/lib/flatten/types";

/**
 * Seam-true development of a wavy panel's boundary, for cut templates.
 *
 * The Lambert equal-area flatten develops each panel about its own
 * center, so a shared seam is distorted DIFFERENTLY in each neighbouring
 * panel's template — on huge wavy panels (trionda: boundary up to 96°
 * from center) the two developments of one physical seam disagreed by
 * 2-3cm and laser-cut pieces did not line up.
 *
 * This development uses only curve-INTRINSIC data, identical from both
 * sides of every seam:
 *   - each boundary micro-edge's true great-arc length;
 *   - at each boundary vertex, the spherical turning angle (measured in
 *     that vertex's tangent plane) — at a smooth seam point the two
 *     panels see exactly opposite turnings, so their developed curves
 *     are exact mirror images and mate perfectly.
 *
 * A spherical polygon's turnings sum to 2π − area (Gauss-Bonnet), so a
 * faithful development cannot close; planar closure needs 2π. The
 * missing "spherical excess" (the panel's share of the sphere's 720°)
 * is added as extra turning AT THE JUNCTION CORNERS ONLY — it must not
 * touch seam interiors, because any turning added there lands with the
 * SAME sign in both adjacent panels' developments while mirror-mating
 * needs OPPOSITE signs (this exact mistake produced 2cm seam mismatch).
 * Corners are where panels part ways, so curvature concentrated there
 * never breaks a seam — it is precisely the Descartes vertex deficit
 * (60° per corner on the trionda). The small residual positional gap is
 * closed by shifting points proportionally to arc length.
 *
 * Returns dense corners with zero sagitta ratios (curvature is baked
 * into the polyline), ready for the existing template pipeline.
 */
export function developWavyPanel(
  panel: Panel,
  topo: PanelTopology,
): PanelFlat | null {
  const loop = panel.vertexIndices;
  const n = loop.length;

  // Junction corners: boundary vertices where ≥3 panels meet. The
  // spherical excess is deposited exclusively there.
  const useCount = new Map<number, number>();
  for (const p of topo.panels) {
    for (const vi of p.vertexIndices) {
      useCount.set(vi, (useCount.get(vi) ?? 0) + 1);
    }
  }
  const isJunction = loop.map((vi) => (useCount.get(vi) ?? 0) >= 3);
  const junctionCount = isJunction.filter(Boolean).length;
  // No junction corners (the baseball's single smooth closed seam):
  // there is nowhere to deposit the excess without breaking seam
  // symmetry — caller falls back to the spine flatten, which is how
  // physical two-panel baseballs are actually patterned.
  if (junctionCount === 0) return null;
  const sphereRadius = topo.vertices[loop[0]].length() || 1;
  const units = loop.map((vi) => topo.vertices[vi].clone().normalize());

  // Edge arc lengths (sphere units).
  const edgeLen: number[] = [];
  for (let i = 0; i < n; i++) {
    edgeLen.push(units[i].angleTo(units[(i + 1) % n]) * sphereRadius);
  }
  const totalLen = edgeLen.reduce((a, b) => a + b, 0);

  // Signed spherical turning at each vertex: angle from the incoming
  // travel direction to the outgoing one, in the vertex's tangent plane.
  const tangentToward = (from: Vector3, to: Vector3): Vector3 => {
    const t = to.clone().sub(from.clone().multiplyScalar(to.dot(from)));
    return t.normalize();
  };
  const turning: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = units[(i - 1 + n) % n];
    const cur = units[i];
    const next = units[(i + 1) % n];
    const inDir = tangentToward(cur, prev).multiplyScalar(-1);
    const outDir = tangentToward(cur, next);
    const cross = new Vector3().crossVectors(inDir, outDir);
    turning.push(Math.atan2(cross.dot(cur), inDir.dot(outDir)));
  }

  // Planar closure requires total turning ±2π; the shortfall is the
  // spherical excess (panel area), deposited at the junction corners.
  const rawTotal = turning.reduce((a, b) => a + b, 0);
  const target = rawTotal >= 0 ? 2 * Math.PI : -2 * Math.PI;
  const excess = target - rawTotal;
  const turningFlat = turning.map(
    (t, i) => t + (isJunction[i] ? excess / junctionCount : 0),
  );

  // Walk the polyline: start at the origin heading along edge 0; after
  // each edge, turn by the (adjusted) turning of the vertex reached.
  const walked: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let heading = 0;
  for (let i = 0; i < n; i++) {
    const p = walked[i];
    walked.push({
      x: p.x + edgeLen[i] * Math.cos(heading),
      y: p.y + edgeLen[i] * Math.sin(heading),
    });
    heading += turningFlat[(i + 1) % n];
  }

  // Positional closure: turning closes exactly (by construction) but the
  // endpoint misses the start by a small gap — spread it proportionally
  // to arc length and drop the duplicate endpoint.
  const gap = {
    x: walked[n].x - walked[0].x,
    y: walked[n].y - walked[0].y,
  };
  let s = 0;
  const closed = walked.slice(0, n).map((p, i) => {
    if (i > 0) s += edgeLen[i - 1];
    const f = s / totalLen;
    return { x: p.x - gap.x * f, y: p.y - gap.y * f };
  });

  // Y-flip for SVG (down = +y), matching flattenPanelUnscaled.
  const corners = closed.map((p) => ({ x: p.x, y: -p.y }));
  return { corners, sagittaRatios: new Array(n).fill(0) };
}
