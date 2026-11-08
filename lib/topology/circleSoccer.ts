import { Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";
import { topologyFromFaces } from "./fromFaces";
import { truncatedIcosahedronFamily } from "./truncationFamily";

// Longest boundary segment on a circle arc, in radians — fine enough that
// the circles read as round, not as 45-gons.
const MAX_ARC_STEP = (2 * Math.PI) / 180;
// Longest segment on a straight hex-hex edge. The hexagons have concave
// sides, so they go to the concave mesher, which needs boundary corners
// dense enough that each great arc stays close to its chord (same limit
// as importedBall.ts).
const MAX_EDGE_ANGLE = (3 * Math.PI) / 180;

/**
 * "Circle Soccer" — the classic 32-panel ball with each of the 12
 * pentagons replaced by a circle.
 *
 * Each circle is the small circle through its pentagon's five corners
 * (the pentagon's circumcircle on the sphere), so every three-panel
 * junction stays where it was: the circles touch the hexagons at the
 * original corners, the 30 hex-hex seams are unchanged, and each hexagon's
 * three pentagon-facing sides become concave arcs hugging the circles.
 *
 * Panel ids follow the soccer ball's order (20 hexagons, then 12 circles)
 * with frozen suffixes `_hexagon` / `_circle`, so paint-by-shape groups
 * them even though both are dense "polygon" loops.
 */
export function circleSoccer(radius = 1): PanelTopology {
  const base = truncatedIcosahedronFamily(1, 1);
  const vertices = base.vertices.map((v) => v.clone());
  const hexCount = base.panels.filter((p) => p.shape === "hexagon").length;

  // Inserted vertices per undirected edge, shared by both adjacent panels
  // so the topology stays watertight.
  const inserted = new Map<string, number[]>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const add = (v: Vector3) => vertices.push(v) - 1;

  // Circle arcs: rotate each pentagon corner about the pentagon's center
  // axis toward the next corner. Points generated in the pentagon's CCW
  // order (a → b); the hexagon walks the same edge b → a and reverses.
  for (const panel of base.panels.slice(hexCount)) {
    const loop = panel.vertexIndices;
    const axis = new Vector3();
    for (const i of loop) axis.add(vertices[i]);
    axis.normalize();
    for (let k = 0; k < loop.length; k++) {
      const a = loop[k];
      const b = loop[(k + 1) % loop.length];
      const va = vertices[a];
      const vb = vertices[b];
      // Angle swept around the axis, a → b (72° for a regular pentagon).
      const pa = va.clone().projectOnPlane(axis);
      const pb = vb.clone().projectOnPlane(axis);
      const sweep = Math.atan2(pa.clone().cross(pb).dot(axis), pa.dot(pb));
      const arcLength = Math.abs(sweep) * pa.length();
      const steps = Math.max(2, Math.ceil(arcLength / MAX_ARC_STEP));
      const pts: number[] = [];
      for (let s = 1; s < steps; s++) {
        pts.push(add(va.clone().applyAxisAngle(axis, (sweep * s) / steps)));
      }
      inserted.set(edgeKey(a, b), a < b ? pts : pts.reverse());
    }
  }

  const densify = (loop: readonly number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      out.push(a);
      const key = edgeKey(a, b);
      let pts = inserted.get(key);
      if (!pts) {
        // Straight hex-hex seam: great-arc midpoints.
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const extra = Math.max(
          0,
          Math.ceil(vertices[lo].angleTo(vertices[hi]) / MAX_EDGE_ANGLE) - 1,
        );
        pts = [];
        for (let s = 1; s <= extra; s++) {
          pts.push(add(vertices[lo].clone().lerp(vertices[hi], s / (extra + 1))));
        }
        inserted.set(key, pts);
      }
      out.push(...(a < b ? pts : [...pts].reverse()));
    }
    return out;
  };

  const faces = base.panels.map((p) => densify(p.vertexIndices));
  return topologyFromFaces(
    vertices.map((v) => [v.x, v.y, v.z] as const),
    faces,
    radius,
    (idx) =>
      `panel_${String(idx + 1).padStart(3, "0")}_${idx < hexCount ? "hexagon" : "circle"}`,
  );
}
