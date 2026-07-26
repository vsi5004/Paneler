import { Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";

/**
 * Scale every seam's wave amplitude — its deviation from the junction-
 * to-junction great-circle arc — by `factor`, leaving the junctions
 * fixed. 1 = as imported; 0 straightens all seams (the Orbita becomes a
 * plain spherical dodecahedron); >1 pushes the star arms further out.
 *
 * Each interior seam vertex belongs to exactly one seam (panels share
 * only junction vertices across different seams), so scaling per-seam
 * is globally consistent without any reconciliation step.
 *
 * Mutates and returns `topo` (wrappers hand us a fresh instance).
 */
export function scaleSeamAmplitude(
  topo: PanelTopology,
  factor: number,
): PanelTopology {
  if (Math.abs(factor - 1) < 1e-6) return topo;
  const radius = topo.vertices[0]?.length() || 1;

  // Group boundary edges into seam runs (one chain per panel pair).
  const groups = new Map<string, Array<{ a: number; b: number }>>();
  for (const e of topo.edges) {
    const key = [e.panelA, e.panelB].sort().join("~");
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push({ a: e.vertexA, b: e.vertexB });
  }

  for (const list of groups.values()) {
    const adj = new Map<number, number[]>();
    for (const { a, b } of list) {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
    for (const [v, ns] of adj) {
      if (ns.length !== 1) continue;
      // walk the open chain once, from the lower-indexed endpoint
      const path = [v];
      let prev = -1;
      let cur = v;
      for (;;) {
        const next = adj.get(cur)!.find((n) => n !== prev);
        if (next === undefined) break;
        path.push(next);
        prev = cur;
        cur = next;
        if (adj.get(cur)!.length !== 2) break;
      }
      const other = path[path.length - 1];
      if (v > other) continue; // each chain handled once

      const A = topo.vertices[path[0]].clone().normalize();
      const B = topo.vertices[other].clone().normalize();
      const axis = new Vector3().crossVectors(A, B);
      if (axis.lengthSq() < 1e-16) continue;
      axis.normalize();
      const arc = A.angleTo(B);
      for (let i = 1; i + 1 < path.length; i++) {
        const p = topo.vertices[path[i]].clone().normalize();
        // signed offset from the chord's great-circle plane
        const d = Math.asin(Math.min(1, Math.max(-1, p.dot(axis))));
        // arc fraction along the plane
        const inPlane = p
          .clone()
          .addScaledVector(axis, -p.dot(axis))
          .normalize();
        const t =
          Math.atan2(
            new Vector3().crossVectors(A, inPlane).dot(axis),
            A.dot(inPlane),
          ) / arc;
        // rebuild with scaled offset
        const ang = t * arc;
        const base = A.clone()
          .multiplyScalar(Math.cos(ang))
          .addScaledVector(new Vector3().crossVectors(axis, A), Math.sin(ang));
        const dNew = d * factor;
        const lifted = base
          .multiplyScalar(Math.cos(dNew))
          .addScaledVector(axis, Math.sin(dNew));
        topo.vertices[path[i]].copy(lifted.setLength(radius));
      }
    }
  }
  return topo;
}
