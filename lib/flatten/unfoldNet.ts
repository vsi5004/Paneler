import { Vector3 } from "three";
import type { Panel, PanelTopology } from "@/lib/types";
import { arapFlattenBoundary } from "./arap";
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
  // Wavy junction panels display the same seam-symmetrized outline the
  // laser templates cut, so the net matches the templates exactly.
  const flat =
    (panel.vertexIndices.length > 6
      ? symmetrizeWavyPanel(panel, topo)
      : null) ?? flattenPanelUnscaled(panel, topo);
  let maxR = 0;
  for (const c of flat.corners) {
    const r = Math.hypot(c.x, c.y);
    if (r > maxR) maxR = r;
  }
  // Scale so the panel's max-radius corner sits on the target circumradius
  // (consistent visual sizing across all panels in the net). Sagitta ratios
  // are scale-invariant.
  const scale = maxR > 0 ? circumradius / maxR : 1;
  return {
    corners: flat.corners.map((c) => ({ x: c.x * scale, y: c.y * scale })),
    sagittaRatios: flat.sagittaRatios,
  };
}

/**
 * Flatten a panel's true spherical boundary into 2D in SPHERE UNITS —
 * physical size is `sphere radius` units, no display rescale. Multiply
 * corners by a mm-per-unit factor for real-world templates (the laser
 * exporter does exactly that). Y is already flipped for SVG (down = +y).
 */
export function flattenPanelUnscaled(
  panel: Panel,
  topo: PanelTopology,
): PanelFlat {
  const n = panel.vertexIndices.length;
  const sphereRadius = topo.vertices[panel.vertexIndices[0]].length();

  // Project the panel's actual 3D boundary into 2D. This preserves the
  // real panel shape — wavy panels (Baseball, Trionda) look wavy in the
  // net; regular polygons (Goldberg / Platonic faces) look like regular
  // polygons.
  //
  // Two regimes, chosen by how far the boundary wraps around the sphere:
  //
  //  - Compact panels (every boundary point within ~90° of the center):
  //    Lambert azimuthal equal-area about the center, r = 2·sin(d/2).
  //    Flat area equals spherical area, it cannot fold back, and it agrees
  //    with a plain tangent-plane projection to 2nd order — polyhedral
  //    nets look unchanged.
  //
  //  - Wrap-around panels (the Baseball hemispheres): every azimuthal
  //    projection distorts most in its far field, which is exactly where
  //    these panels' visually salient lobes live — pointiness there got
  //    scrambled or even inverted relative to the 3D seam. Instead,
  //    unroll about the panel's SPINE: the great circle through the
  //    center and the farthest boundary point (the lobe tip). In a frame
  //    where that spine is the equator, the flatten is plain
  //    longitude/latitude (equirectangular) — exact along the whole
  //    spine, including the lobe tips, so tip roundness tracks the 3D
  //    model. Distortion (east-west stretch, sec(lat)) concentrates on
  //    the panel's side edges, bounded by the panel half-width.
  const normal = panelCenterDirection(panel, topo);
  const helper =
    Math.abs(normal.dot(new Vector3(0, 1, 0))) < 0.9
      ? new Vector3(0, 1, 0)
      : new Vector3(1, 0, 0);
  const tanU = new Vector3().crossVectors(normal, helper).normalize();
  const tanV = new Vector3().crossVectors(normal, tanU).normalize();

  const units = panel.vertexIndices.map((vi) =>
    topo.vertices[vi].clone().normalize(),
  );
  let maxAngDist = 0;
  let farthest = units[0];
  for (const unit of units) {
    const d = Math.acos(Math.min(1, Math.max(-1, unit.dot(normal))));
    if (d > maxAngDist) {
      maxAngDist = d;
      farthest = unit;
    }
  }

  const projected: Vec2[] = [];
  if (maxAngDist <= Math.PI * 0.55) {
    // Compact panel: Lambert azimuthal equal-area about the center.
    for (const unit of units) {
      const cosDist = Math.min(1, Math.max(-1, unit.dot(normal)));
      const angDist = Math.acos(cosDist);
      // Azimuth direction = the vertex's component perpendicular to the
      // center direction. Degenerate only when the vertex sits exactly on
      // the center (angDist 0) — the radius is 0 there, so direction is moot.
      const az = unit.clone().sub(normal.clone().multiplyScalar(cosDist));
      const azLen = az.length();
      const r = 2 * Math.sin(angDist / 2) * sphereRadius;
      const x = azLen > 1e-12 ? (r * az.dot(tanU)) / azLen : 0;
      const y = azLen > 1e-12 ? (r * az.dot(tanV)) / azLen : 0;
      projected.push({ x, y });
    }
  } else {
    // Wrap-around panel: equirectangular unroll about the spine through
    // the center and the farthest boundary point. Frame: spineX = lobe
    // direction (tangential part of the farthest point), spineY = panel
    // center, spineN = spine-plane normal. Longitude λ = atan2(·spineX,
    // ·spineY) is 0 at the center and ±(maxAngDist) at the tips — the
    // boundary stays within |λ| < π for any non-self-covering panel, so
    // there is no wrap seam. Latitude φ = asin(·spineN).
    const spineY = normal;
    const spineX = farthest
      .clone()
      .sub(spineY.clone().multiplyScalar(farthest.dot(spineY)))
      .normalize();
    const spineN = new Vector3().crossVectors(spineX, spineY).normalize();
    for (const unit of units) {
      const lat = Math.asin(Math.min(1, Math.max(-1, unit.dot(spineN))));
      const inPlane = unit.clone().sub(spineN.clone().multiplyScalar(unit.dot(spineN)));
      const lon =
        inPlane.lengthSq() > 1e-24
          ? Math.atan2(inPlane.dot(spineX), inPlane.dot(spineY))
          : 0;
      const x = lon * sphereRadius;
      const y = lat * sphereRadius;
      projected.push({ x, y });
    }
  }

  // SVG Y axis points down; tangent-plane Y points "up". Flip so the
  // panel reads right-side-up in the 2D view.
  const corners: Vec2[] = projected.map((p) => ({ x: p.x, y: -p.y }));

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

/**
 * Cut-ready flatten for wavy panels with junction corners (trionda):
 * the ARAP flatten (lib/flatten/arap.ts), which spreads the sphere's
 * flattening strain evenly, so corners land within ~1 degree of their
 * spherical angles and every mating pair of seams develops to the same
 * arc length (~0.2mm) — equal-length seams with matched hole counts is
 * what sewing needs.
 *
 * What this deliberately does NOT deliver is flat-nesting seams
 * (cut pieces laid edge-to-edge on the table). By Gauss-Bonnet, a
 * trionda panel's flat boundary must turn through 360 degrees, and its
 * seam curves carry 180 degrees less turning than the sphere provides —
 * so exactly-congruent seam curves (whose turning is fixed by being
 * shared) force the corners to absorb the whole deficit: interior
 * angles averaging 60 degrees. Earlier seam-true constructions proved
 * this empirically (needle corners, rejected). Wide corners and
 * flat-nesting seams are mathematically exclusive; like a baseball's
 * two identical panels — whose edges don't nest flat either — the
 * pieces mate in the seam, not on the table.
 *
 * Returns null for panels without junction corners (the baseball) —
 * callers fall back to the plain flatten.
 */
export function symmetrizeWavyPanel(
  panel: Panel,
  topo: PanelTopology,
): PanelFlat | null {
  const useCount = new Map<number, number>();
  for (const p of topo.panels) {
    for (const vi of p.vertexIndices) {
      useCount.set(vi, (useCount.get(vi) ?? 0) + 1);
    }
  }
  const hasJunctions = panel.vertexIndices.some(
    (vi) => (useCount.get(vi) ?? 0) >= 3,
  );
  // Panels that WIND — their boundary sweeps more than a full turn of
  // longitude about the spine frame (the Spiral's bands) — also need
  // ARAP: the equirectangular spine-unroll folds over past ±180°, and
  // Lambert folds at the antipode. The Baseball stays on its proven
  // spine-unroll (its lobes never exceed a half-turn each way).
  if (!hasJunctions && !windsFullTurn(panel, topo)) {
    return null;
  }

  const boundary = arapCached(panel, topo);
  if (!boundary) return null;
  return {
    corners: boundary.map((c) => ({ ...c })),
    sagittaRatios: new Array(panel.vertexIndices.length).fill(0),
  };
}

/**
 * Does the panel's boundary sweep more than a full turn of longitude
 * about its spine frame (center direction x farthest boundary point)?
 * Beyond that the equirectangular unroll self-overlaps.
 */
function windsFullTurn(panel: Panel, topo: PanelTopology): boolean {
  const normal = panelCenterDirection(panel, topo);
  const units = panel.vertexIndices.map((vi) =>
    topo.vertices[vi].clone().normalize(),
  );
  let maxAngDist = 0;
  let farthest = units[0];
  for (const unit of units) {
    const d = Math.acos(Math.min(1, Math.max(-1, unit.dot(normal))));
    if (d > maxAngDist) {
      maxAngDist = d;
      farthest = unit;
    }
  }
  if (maxAngDist <= Math.PI * 0.55) return false; // compact: Lambert fine
  const spineY = normal;
  const spineX = farthest
    .clone()
    .sub(spineY.clone().multiplyScalar(farthest.dot(spineY)));
  if (spineX.lengthSq() < 1e-18) return false;
  spineX.normalize();
  const spineN = new Vector3().crossVectors(spineX, spineY).normalize();
  // Unwrapped longitude RANGE along the boundary. Total travel would
  // trip on the Baseball (its lobes go out and back, ~4x the lobe span)
  // — the range only exceeds a full turn when the panel actually WINDS.
  let unwrapped = 0;
  let minLon = 0;
  let maxLon = 0;
  let prev: number | null = null;
  for (const unit of units) {
    const inPlane = unit
      .clone()
      .sub(spineN.clone().multiplyScalar(unit.dot(spineN)));
    if (inPlane.lengthSq() < 1e-18) continue;
    const lon = Math.atan2(inPlane.dot(spineX), inPlane.dot(spineY));
    if (prev !== null) {
      let d = lon - prev;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      unwrapped += d;
      minLon = Math.min(minLon, unwrapped);
      maxLon = Math.max(maxLon, unwrapped);
    }
    prev = lon;
  }
  return maxLon - minLon > 2 * Math.PI * 0.95;
}

const arapBoundaryCache = new WeakMap<PanelTopology, Map<string, Vec2[] | null>>();
function arapCached(panel: Panel, topo: PanelTopology): Vec2[] | null {
  let perTopo = arapBoundaryCache.get(topo);
  if (!perTopo) {
    perTopo = new Map();
    arapBoundaryCache.set(topo, perTopo);
  }
  if (!perTopo.has(panel.id)) {
    perTopo.set(panel.id, arapFlattenBoundary(panel, topo));
  }
  return perTopo.get(panel.id) ?? null;
}
