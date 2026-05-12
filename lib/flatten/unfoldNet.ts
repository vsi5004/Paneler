import { Vector3 } from "three";
import type { Panel, PanelEdge, PanelTopology } from "@/lib/types";
import { chooseRoot } from "./chooseRoot";
import { rigidEdgeAlign, sideOf } from "./rigidTransform";
import type { FlatLayout, Vec2 } from "./types";

/**
 * Unfold a `PanelTopology` into a flat net via BFS edge-unfolding:
 *
 *   1. Pick a root panel (top-of-sphere).
 *   2. Lay it flat by projecting its corners into its local tangent
 *      plane (centroid at origin; arbitrary orthonormal basis).
 *   3. BFS across panel adjacency. For each unvisited neighbour:
 *      - Compute the neighbour's *local* flat shape the same way.
 *      - Find the shared corner pair (V_a, V_b).
 *      - Build a rigid 2D transform that maps the neighbour's local
 *        (V_a, V_b) onto the parent's already-placed (P_a, P_b), with a
 *        mirror so the neighbour lands on the OPPOSITE side of the
 *        edge from the parent's centroid.
 *      - Apply the transform to every corner of the neighbour.
 *
 * This is the standard "polyhedron net unfolding" algorithm. For most
 * panel-count footbag topologies (soccer ball, GP(m,0), …) the result is
 * a clean Schlegel-style net. For pathological highly-curved topologies
 * panels can overlap — accepted for now; an overlap-resolving packer is
 * a follow-up.
 */
export function unfoldNet(topo: PanelTopology): FlatLayout {
  const result: FlatLayout = new Map();
  if (topo.panels.length === 0) return result;

  const panelById = new Map<string, Panel>();
  for (const p of topo.panels) panelById.set(p.id, p);

  // Adjacency: panelId → edges touching it.
  const adjacency = new Map<string, PanelEdge[]>();
  for (const panel of topo.panels) adjacency.set(panel.id, []);
  for (const edge of topo.edges) {
    if (edge.panelA && adjacency.has(edge.panelA)) {
      adjacency.get(edge.panelA)!.push(edge);
    }
    if (edge.panelB && adjacency.has(edge.panelB)) {
      adjacency.get(edge.panelB)!.push(edge);
    }
  }

  const rootId = chooseRoot(topo);
  const rootPanel = panelById.get(rootId)!;
  result.set(rootId, flattenPanelLocal(rootPanel, topo));

  // Visited + queue
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentPanel = panelById.get(currentId)!;
    const currentFlat = result.get(currentId)!;
    const currentCentroid2D = centroid2D(currentFlat);

    for (const edge of adjacency.get(currentId)!) {
      const neighborId =
        edge.panelA === currentId ? edge.panelB : edge.panelA;
      if (!neighborId || visited.has(neighborId)) continue;
      const neighborPanel = panelById.get(neighborId);
      if (!neighborPanel) continue;
      visited.add(neighborId);

      const neighborFlat = unfoldNeighbour(
        currentPanel,
        currentFlat,
        currentCentroid2D,
        neighborPanel,
        topo,
        edge.vertexA,
        edge.vertexB,
      );
      result.set(neighborId, neighborFlat);
      queue.push(neighborId);
    }
  }

  return result;
}

function flattenPanelLocal(panel: Panel, topo: PanelTopology): Vec2[] {
  // Render each panel as a REGULAR polygon centred on the origin, with
  // edge length = the average of the panel's 3D-chord edge lengths.
  //
  // Why not tangent-plane projection (the geometrically faithful choice)?
  // A sphere has non-zero Gaussian curvature, so unfolding any closed
  // patch of it flat produces angular defects — adjacent panels can't
  // all share corners exactly, and you get visible gaps at every vertex.
  // For an interactive *design preview* the user wants a clean Schlegel-
  // style net (hero-animation look). Regular polygons give that for the
  // soccer ball and Goldberg variants because their panels are already
  // near-regular on the sphere; small edge-length mismatches between
  // adjacent panels are absorbed by `rigidEdgeAlign`'s scale step.
  //
  // Geometrically faithful flattening with seam-bulge compensation
  // belongs to the Phase 2 SVG cutting-template export.
  const n = panel.vertexIndices.length;
  let totalEdgeLen = 0;
  for (let i = 0; i < n; i++) {
    const a = topo.vertices[panel.vertexIndices[i]];
    const b = topo.vertices[panel.vertexIndices[(i + 1) % n]];
    totalEdgeLen += a.distanceTo(b);
  }
  const avgEdgeLen = totalEdgeLen / n;
  const radius = avgEdgeLen / (2 * Math.sin(Math.PI / n));

  const flat: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    // Start at the top (-π/2) and walk CCW. Panel boundary loops are
    // already CCW-from-outside (preset panels by construction, Goldberg
    // panels via the explicit re-orientation in dualToTopology), so this
    // preserves the same corner order.
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    flat.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }
  return flat;
}

function centroid2D(corners: ReadonlyArray<Vec2>): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of corners) {
    x += p.x;
    y += p.y;
  }
  return { x: x / corners.length, y: y / corners.length };
}

function unfoldNeighbour(
  parent: Panel,
  parentFlat: ReadonlyArray<Vec2>,
  parentCentroid2D: Vec2,
  neighbor: Panel,
  topo: PanelTopology,
  sharedA: number,
  sharedB: number,
): Vec2[] {
  // Where the shared corners landed in the parent's frame.
  const idxAinParent = parent.vertexIndices.indexOf(sharedA);
  const idxBinParent = parent.vertexIndices.indexOf(sharedB);
  const P_A = parentFlat[idxAinParent];
  const P_B = parentFlat[idxBinParent];

  // Where the shared corners sit in the neighbour's OWN local frame
  // (before unfolding).
  const localFlat = flattenPanelLocal(neighbor, topo);
  const idxAinNeighbour = neighbor.vertexIndices.indexOf(sharedA);
  const idxBinNeighbour = neighbor.vertexIndices.indexOf(sharedB);
  const L_A = localFlat[idxAinNeighbour];
  const L_B = localFlat[idxBinNeighbour];

  // First-pass transform without mirroring.
  const localCentroid = centroid2D(localFlat);
  let xform = rigidEdgeAlign(L_A, L_B, P_A, P_B, /*mirror*/ false);
  let placedCentroid = xform(localCentroid);

  // The neighbour must end up on the OPPOSITE side of the shared edge
  // from the parent's centroid. Check via cross-product side test; flip
  // mirror if needed.
  const parentSide = Math.sign(sideOf(P_A, P_B, parentCentroid2D));
  const neighborSide = Math.sign(sideOf(P_A, P_B, placedCentroid));
  if (parentSide === neighborSide) {
    xform = rigidEdgeAlign(L_A, L_B, P_A, P_B, /*mirror*/ true);
    placedCentroid = xform(localCentroid);
  }

  return localFlat.map(xform);
}
