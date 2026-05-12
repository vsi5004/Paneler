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
  const rootNormal = rootCentroid.clone().normalize();
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
  // All panels share the same circumradius so a hexagon and an adjacent
  // pentagon look like the same visual size. Edges DO end up at slightly
  // different lengths across shape types (a pentagon's side is wider for
  // the same circumradius than a hexagon's), which mirrors how those
  // panels appear on the sphere anyway.
  const corners: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    // Top corner at -π/2 (will be rotated outward when placed in a ring).
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    corners.push({
      x: circumradius * Math.cos(angle),
      y: circumradius * Math.sin(angle),
    });
  }

  // Per-edge sagitta-to-chord ratio for the original spherical arc:
  //   ratio = tan(θ/2) / 2, where θ is the half-angle of the great
  //   circle subtended by the 3D chord.
  // Tetrahedron faces span ~109° of the sphere → big bulge.
  // 32-panel soccer ball faces span ~29° → subtle.
  const sphereRadius = topo.vertices[panel.vertexIndices[0]].length();
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
