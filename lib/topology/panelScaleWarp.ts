import { Quaternion, Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";

/** Same clustering idea as lib/laser/congruence.ts, area-only. */
const CLASS_TOLERANCE = 0.05;

/**
 * Change the size of a two-class ball's FEATURE panels — the class with
 * the fewest members (Teamgeist: the 6 ovals; a soccer ball: the 12
 * pentagons) — while the other class fills whatever sphere is left.
 *
 * The feature panels never touch each other on these balls, so each one
 * scales exactly uniformly about its own spherical center: proportions
 * are preserved by construction. The filler panels' boundaries are
 * mostly feature-panel arcs (they just follow); their mutual seams
 * (t-bone/t-bone short seams) contain vertices on no feature panel, so
 * those interpolate the displacement of their two junction endpoints
 * along the seam — the curve follows both moving ends without kinks.
 *
 * Single-class balls (trionda) are returned unchanged. Mutates and
 * returns `topo` (wrappers hand us a fresh instance).
 */
export function scaleFeaturePanels(
  topo: PanelTopology,
  factor: number,
): PanelTopology {
  if (Math.abs(factor - 1) < 1e-6) return topo;
  const radius = topo.vertices[0]?.length() || 1;

  // --- Cluster panels into size classes by spherical area magnitude. ---
  const areaVec = new Vector3();
  const cross = new Vector3();
  const areaOf = (loop: readonly number[], pos: Vector3[]) => {
    areaVec.set(0, 0, 0);
    for (let i = 0; i < loop.length; i++) {
      cross.crossVectors(pos[loop[i]], pos[loop[(i + 1) % loop.length]]);
      areaVec.add(cross);
    }
    return areaVec.clone();
  };
  const areas = topo.panels.map(
    (p) => areaOf(p.vertexIndices, topo.vertices).length() / 2,
  );
  const clusters: number[][] = [];
  topo.panels.forEach((_, i) => {
    for (const c of clusters) {
      const mean = c.reduce((s, j) => s + areas[j], 0) / c.length;
      if (Math.abs(areas[i] - mean) / mean <= CLASS_TOLERANCE) {
        c.push(i);
        return;
      }
    }
    clusters.push([i]);
  });
  if (clusters.length < 2) return topo;
  clusters.sort((a, b) => a.length - b.length);
  const feature = clusters[0];

  // --- Scale each feature panel exactly about its own center. ---
  const original = topo.vertices.map((v) => v.clone());
  const moved = new Map<number, Vector3>();
  const q = new Quaternion();
  const axis = new Vector3();
  for (const pi of feature) {
    const loop = topo.panels[pi].vertexIndices;
    // Vector-area direction: robust center for wavy panels (a boundary
    // mean is biased toward densely-sampled stretches).
    const center = areaOf(loop, original).normalize();
    for (const vi of loop) {
      const vN = original[vi].clone().normalize();
      const angle = center.angleTo(vN);
      axis.crossVectors(center, vN);
      const scaled =
        axis.lengthSq() < 1e-16
          ? vN.clone()
          : center
              .clone()
              .applyQuaternion(
                q.setFromAxisAngle(axis.clone().normalize(), angle * factor),
              );
      moved.set(vi, scaled.setLength(radius));
    }
  }

  // --- Filler/filler seams: vertices on no feature panel. Interpolate
  // the two junction endpoints' displacements along each seam run. ---
  const rotationAt = new Map<number, Quaternion>();
  for (const [vi, v] of moved) {
    rotationAt.set(
      vi,
      new Quaternion().setFromUnitVectors(
        original[vi].clone().normalize(),
        v.clone().normalize(),
      ),
    );
  }
  const groups = new Map<string, Array<{ a: number; b: number }>>();
  for (const e of topo.edges) {
    if (moved.has(e.vertexA) && moved.has(e.vertexB)) continue;
    const key = [e.panelA, e.panelB].sort().join("~");
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push({ a: e.vertexA, b: e.vertexB });
  }
  const identity = new Quaternion();
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
      const q0 = rotationAt.get(path[0]) ?? identity;
      const q1 = rotationAt.get(path[path.length - 1]) ?? identity;
      let total = 0;
      for (let i = 0; i + 1 < path.length; i++) {
        total += original[path[i]].angleTo(original[path[i + 1]]);
      }
      if (total < 1e-9) continue;
      let acc = 0;
      for (let i = 1; i + 1 < path.length; i++) {
        acc += original[path[i - 1]].angleTo(original[path[i]]);
        const t = acc / total;
        const vec = original[path[i]]
          .clone()
          .applyQuaternion(identity.clone().slerp(q0, 1 - t))
          .applyQuaternion(identity.clone().slerp(q1, t));
        moved.set(path[i], vec.setLength(radius));
      }
    }
  }

  for (const [vi, v] of moved) {
    topo.vertices[vi].copy(v);
  }
  return topo;
}
