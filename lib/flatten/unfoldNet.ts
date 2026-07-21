import { Vector3 } from "three";
import type { Panel, PanelTopology } from "@/lib/types";
import { chooseRoot } from "./chooseRoot";
import type { FlatLayout, PanelFlat, Vec2 } from "./types";

const RING_SPACING_FACTOR = 2.2; // ring radius growth per BFS depth in panel circumradii
const RING_FIT_PADDING = 1.25; // crowding-fit multiplier so panels stay separated

/**
 * Flatten a `PanelTopology` into a Schlegel-style net:
 *
 *   1. BFS from a chosen root to assign each panel a depth (ring index).
 *   2. Group panels by depth.
 *   3. For each ring, place panels around a circle whose radius is the
 *      max of (a) `depth × 2.2 × circumradius` and (b) the smallest
 *      radius that fits the ring's panel count without crowding.
 *   4. Sort panels within a ring by their 3D azimuth around the root
 *      so neighbours in 3D stay neighbours in 2D.
 *   5. Each panel renders as a regular polygon with curve-edged sides
 *      (sagitta from the original spherical arc).
 *
 * This abandons the strict edge-unfolding the previous version did
 * (which inevitably overlapped on closed surfaces because of the
 * spherical angular defect at every vertex) in favour of a layout
 * that mirrors the landing-page hero animation: concentric rings of
 * panels, visibly separated. Panels no longer touch at shared edges,
 * but the design preview reads cleanly and shows every panel at a
 * glance.
 */
export function unfoldNet(topo: PanelTopology): FlatLayout {
  const result: FlatLayout = new Map();
  if (topo.panels.length === 0) return result;

  const panelById = new Map<string, Panel>();
  for (const p of topo.panels) panelById.set(p.id, p);

  // Undirected adjacency for the depth BFS.
  const adjacency = new Map<string, string[]>();
  for (const panel of topo.panels) adjacency.set(panel.id, []);
  for (const edge of topo.edges) {
    if (!edge.panelA || !edge.panelB) continue;
    adjacency.get(edge.panelA)?.push(edge.panelB);
    adjacency.get(edge.panelB)?.push(edge.panelA);
  }

  const rootId = chooseRoot(topo);
  const rootPanel = panelById.get(rootId);
  if (!rootPanel) return result;

  // BFS to assign each panel a ring index.
  const depthOf = new Map<string, number>([[rootId, 0]]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depthOf.get(id)!;
    for (const next of adjacency.get(id) ?? []) {
      if (depthOf.has(next)) continue;
      depthOf.set(next, d + 1);
      queue.push(next);
    }
  }

  // Group by depth.
  const byDepth = new Map<number, Panel[]>();
  for (const panel of topo.panels) {
    const d = depthOf.get(panel.id) ?? 0;
    let bucket = byDepth.get(d);
    if (!bucket) {
      bucket = [];
      byDepth.set(d, bucket);
    }
    bucket.push(panel);
  }

  // Tangent basis at the root for computing each panel's 3D azimuth
  // around the root direction. Panels at similar 3D azimuths will end
  // up at similar 2D angles → neighbours-in-3D stay neighbours-in-2D.
  const rootCentroid = computeCentroid3D(rootPanel, topo);
  const rootNormal = panelCenterDirection(rootPanel, topo);
  const helper =
    Math.abs(rootNormal.dot(new Vector3(0, 1, 0))) < 0.9
      ? new Vector3(0, 1, 0)
      : new Vector3(1, 0, 0);
  const tanX = new Vector3().crossVectors(rootNormal, helper).normalize();
  const tanY = new Vector3().crossVectors(rootNormal, tanX).normalize();

  // Average circumradius across all panels — sizes both the polygons
  // and the ring spacing. We use the average rather than per-panel to
  // keep panels of the same shape the same visual size.
  const circumradius = estimateAvgCircumradius(topo);

  for (const [d, panels] of byDepth) {
    if (d === 0) {
      const local = flattenPanelLocal(rootPanel, topo, circumradius);
      result.set(rootPanel.id, local);
      continue;
    }
    placeRing({
      result,
      panels,
      depth: d,
      circumradius,
      topo,
      rootCentroid,
      tanX,
      tanY,
    });
  }

  return result;
}

function placeRing({
  result,
  panels,
  depth,
  circumradius,
  topo,
  rootCentroid,
  tanX,
  tanY,
}: {
  result: FlatLayout;
  panels: Panel[];
  depth: number;
  circumradius: number;
  topo: PanelTopology;
  rootCentroid: Vector3;
  tanX: Vector3;
  tanY: Vector3;
}): void {
  const n = panels.length;
  // Two constraints on ring radius:
  //   - Don't crowd the previous ring: each ring step is ~2.2 panels wide.
  //   - Don't crowd within this ring: arc between panel centres must
  //     exceed RING_FIT_PADDING × 2 × circumradius.
  const minByDepth = depth * RING_SPACING_FACTOR * circumradius;
  const minByFit =
    n > 1 ? (n * RING_FIT_PADDING * circumradius) / Math.PI : 0;
  const ringRadius = Math.max(minByDepth, minByFit);

  // Sort by 3D azimuth so adjacent-in-3D panels land adjacent-in-2D.
  const withAngle = panels.map((panel) => {
    const c = computeCentroid3D(panel, topo);
    const local = c.clone().sub(rootCentroid);
    return {
      panel,
      angle: Math.atan2(local.dot(tanY), local.dot(tanX)),
    };
  });
  withAngle.sort((a, b) => a.angle - b.angle);

  // Distribute uniformly (preserving angular order) so the ring is
  // evenly populated regardless of how clustered the 3D azimuths are.
  for (let i = 0; i < n; i++) {
    const { panel } = withAngle[i];
    const angle = (i * 2 * Math.PI) / n;
    const cx = ringRadius * Math.cos(angle);
    const cy = ringRadius * Math.sin(angle);

    // Rotate the panel so its "top" corner points outward (away from
    // the root). Without this, all panels share the same orientation
    // and the ring reads as a clumped strip rather than radiating
    // outward.
    const orient = angle + Math.PI / 2;
    const cosO = Math.cos(orient);
    const sinO = Math.sin(orient);

    const local = flattenPanelLocal(panel, topo, circumradius);
    const corners = local.corners.map((p) => ({
      x: p.x * cosO - p.y * sinO + cx,
      y: p.x * sinO + p.y * cosO + cy,
    }));
    result.set(panel.id, {
      corners,
      sagittaRatios: local.sagittaRatios,
    });
  }
}

function flattenPanelLocal(
  panel: Panel,
  topo: PanelTopology,
  circumradius: number,
): PanelFlat {
  const n = panel.vertexIndices.length;
  const sphereRadius = topo.vertices[panel.vertexIndices[0]].length();

  // Project the panel's actual 3D boundary into 2D about its spherical
  // centroid using a Lambert azimuthal equal-area projection: radius =
  // 2·sin(angularDistance/2), direction = azimuth in the tangent plane.
  // This preserves the real panel shape — wavy panels (Baseball, Trionda)
  // look wavy in the net; regular polygons (Goldberg / Platonic faces)
  // look like regular polygons.
  //
  // Why this projection:
  //  - Orthographic (plain tangent-plane) folds the far side back over the
  //    near side for panels spanning more than 90° — the Baseball panels
  //    wrap past the equator and rendered as diamonds with overlapping
  //    petals instead of the classic waisted shape.
  //  - Azimuthal equidistant fixes the folding but inflates tangential
  //    distances far from the center (×3+ at 135°), so the Baseball lobes
  //    bloated to ~1.5× their true area and the net visibly mismatched
  //    the 3D ball.
  //  - Equal-area keeps every panel's flat area equal to its spherical
  //    area (radius strictly increases with angular distance, so it still
  //    cannot fold) and agrees with the other projections to 2nd order
  //    for small panels, leaving polyhedral nets unchanged.
  const normal = panelCenterDirection(panel, topo);
  const helper =
    Math.abs(normal.dot(new Vector3(0, 1, 0))) < 0.9
      ? new Vector3(0, 1, 0)
      : new Vector3(1, 0, 0);
  const tanU = new Vector3().crossVectors(normal, helper).normalize();
  const tanV = new Vector3().crossVectors(normal, tanU).normalize();

  // Project each boundary vertex: equal-area radius from the angular
  // distance to the center, tangent-plane azimuth for the direction.
  const projected: Vec2[] = [];
  let maxR = 0;
  for (const vi of panel.vertexIndices) {
    const unit = topo.vertices[vi].clone().normalize();
    const cosDist = Math.min(1, Math.max(-1, unit.dot(normal)));
    const angDist = Math.acos(cosDist);
    // Azimuth direction = the vertex's component perpendicular to the
    // center direction. Degenerate only when the vertex sits exactly on
    // the center (angDist 0) — the radius is 0 there, so direction is moot.
    const az = unit.sub(normal.clone().multiplyScalar(cosDist));
    const azLen = az.length();
    const r = 2 * Math.sin(angDist / 2) * sphereRadius;
    const x = azLen > 1e-12 ? (r * az.dot(tanU)) / azLen : 0;
    const y = azLen > 1e-12 ? (r * az.dot(tanV)) / azLen : 0;
    projected.push({ x, y });
    if (r > maxR) maxR = r;
  }

  // Scale so the panel's max-radius corner sits on the target circumradius
  // (consistent visual sizing across all panels in the net).
  const scale = maxR > 0 ? circumradius / maxR : 1;
  const corners: Vec2[] = projected.map((p) => ({
    x: p.x * scale,
    // SVG Y axis points down; tangent-plane Y points "up". Flip so the
    // panel reads right-side-up in the 2D view.
    y: -p.y * scale,
  }));

  // Per-edge sagitta-to-chord ratio for the original spherical arc:
  //   ratio = tan(θ/2) / 2, where θ is the half-angle of the great circle
  //   subtended by the 3D chord. Tetrahedron faces span ~109° of the
  //   sphere → big bulge. Dense-sample wavy panels (Trionda) span tiny
  //   angles per edge → near-zero bulge, which is correct.
  const sagittaRatios: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = topo.vertices[panel.vertexIndices[i]];
    const b = topo.vertices[panel.vertexIndices[(i + 1) % n]];
    const chord = a.distanceTo(b);
    const sinHalf = Math.min(1, chord / (2 * sphereRadius));
    const halfAngle = Math.asin(sinHalf);
    sagittaRatios.push(Math.tan(halfAngle / 2) / 2);
  }
  return { corners, sagittaRatios };
}

function computeCentroid3D(panel: Panel, topo: PanelTopology): Vector3 {
  const c = new Vector3();
  for (const vi of panel.vertexIndices) c.add(topo.vertices[vi]);
  c.divideScalar(panel.vertexIndices.length);
  return c;
}

/**
 * Unit direction from the sphere's center to the panel's center. For panels
 * whose boundary wraps the whole sphere (the Baseball hemispheres), the naive
 * boundary mean collapses to ~0 and normalizing it yields a zero tangent
 * basis — every flattened corner would land on (0,0). Fall back to the
 * signed-area vector (Σ vᵢ × vᵢ₊₁), which points at the panel's interior
 * hemisphere for any CCW-from-outside boundary. Mirrors computeCentroid in
 * lib/mesh/subdivide.ts.
 */
function panelCenterDirection(panel: Panel, topo: PanelTopology): Vector3 {
  const sphereRadius = topo.vertices[panel.vertexIndices[0]].length() || 1;
  const mean = computeCentroid3D(panel, topo);
  if (mean.lengthSq() > 0.01 * sphereRadius * sphereRadius) {
    return mean.normalize();
  }
  const areaVec = new Vector3();
  const cross = new Vector3();
  const loop = panel.vertexIndices;
  for (let i = 0; i < loop.length; i++) {
    const a = topo.vertices[loop[i]];
    const b = topo.vertices[loop[(i + 1) % loop.length]];
    cross.crossVectors(a, b);
    areaVec.add(cross);
  }
  return areaVec.lengthSq() > 0 ? areaVec.normalize() : mean.normalize();
}

function estimateAvgCircumradius(topo: PanelTopology): number {
  // Compute the average bounding-circle radius across all panels —
  // approximated as half the average edge length divided by sin(π/n).
  let totalChord = 0;
  let edgeCount = 0;
  for (const panel of topo.panels) {
    const n = panel.vertexIndices.length;
    for (let i = 0; i < n; i++) {
      const a = topo.vertices[panel.vertexIndices[i]];
      const b = topo.vertices[panel.vertexIndices[(i + 1) % n]];
      totalChord += a.distanceTo(b);
      edgeCount++;
    }
  }
  if (edgeCount === 0) return 1;
  const avgEdge = totalChord / edgeCount;
  // Use a 5-gon as the reference shape — splits the difference between
  // typical 5/6-gon panels in Goldberg topologies.
  return avgEdge / (2 * Math.sin(Math.PI / 5));
}
