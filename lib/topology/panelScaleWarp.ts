import { Quaternion, Vector3 } from "three";
import type { PanelTopology } from "@/lib/types";

/** Same clustering idea as lib/laser/congruence.ts, area-only. */
const CLASS_TOLERANCE = 0.05;

export interface FeatureMorph {
  /** Uniform angular scale about each feature panel's center (1 = as imported). */
  scale?: number;
  /**
   * Length of the panel along its own major axis: 1 = the imported
   * outline, 0 = a perfect circle. The morph is major-axis compression
   * (the two lobes slide together; the waist indent survives), with a
   * late-onset radial rounding — cubic in (1 - elongation), so it is
   * negligible early and total at 0, where the merged lobes become one
   * exact circle. AREA-PRESERVING: the outline is renormalized to the
   * panel's original solid angle at every value, so a shorter oval gets
   * correspondingly wider/larger instead of just losing fabric.
   */
  elongation?: number;
}

/**
 * Morph a two-class ball's FEATURE panels — the class with the fewest
 * members (Teamgeist: the 6 ovals) — while the other class fills
 * whatever sphere is left.
 *
 * The feature panels never touch each other on these balls, so each one
 * is remapped independently in the azimuthal-equidistant tangent frame
 * at its own spherical center: boundary points project to flat (a, b)
 * coordinates along the panel's PCA major/minor axes, the major
 * coordinate compresses by k = lerp(width/length, 1, elongation), both
 * scale by `scale`, and the result maps back to the sphere. At scale 1 /
 * elongation 1 this is the identity; elongation 0 slides the two lobes
 * together until the panel is as long as it is wide — the waist indent
 * survives because the cross-axis is never touched.
 *
 * The filler panels' boundaries are mostly feature-panel arcs (they just
 * follow); their mutual seams (t-bone/t-bone short seams) contain
 * vertices on no feature panel, so those interpolate the displacement of
 * their two junction endpoints along the seam — the curve follows both
 * moving ends without kinks.
 *
 * Single-class balls (trionda) are returned unchanged. Mutates and
 * returns `topo` (wrappers hand us a fresh instance).
 */
export function morphFeaturePanels(
  topo: PanelTopology,
  morph: FeatureMorph,
): PanelTopology {
  const scale = morph.scale ?? 1;
  const elongation = morph.elongation ?? 1;
  if (Math.abs(scale - 1) < 1e-6 && Math.abs(elongation - 1) < 1e-6) {
    return topo;
  }
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

  // --- Remap each feature panel about its own center. ---
  const original = topo.vertices.map((v) => v.clone());
  const moved = new Map<number, Vector3>();
  for (const pi of feature) {
    const loop = topo.panels[pi].vertexIndices;
    // Vector-area direction: robust center for wavy panels (a boundary
    // mean is biased toward densely-sampled stretches).
    const center = areaOf(loop, original).normalize();
    const helper =
      Math.abs(center.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const e1 = new Vector3().crossVectors(center, helper).normalize();
    const e2 = new Vector3().crossVectors(center, e1).normalize();
    // Azimuthal-equidistant coordinates (theta preserves arc distance).
    const coords = loop.map((vi) => {
      const vN = original[vi].clone().normalize();
      const theta = center.angleTo(vN);
      const az = vN.clone().sub(center.clone().multiplyScalar(vN.dot(center)));
      if (az.lengthSq() < 1e-16) return { x: 0, y: 0 };
      az.normalize();
      return { x: theta * az.dot(e1), y: theta * az.dot(e2) };
    });
    // PCA major axis of the boundary (the ovals are centered by
    // construction; skip mean subtraction so symmetric panels stay put).
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const c of coords) {
      sxx += c.x * c.x;
      sxy += c.x * c.y;
      syy += c.y * c.y;
    }
    const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(phi);
    const uy = Math.sin(phi);
    let halfLen = 0;
    let halfWid = 0;
    for (const c of coords) {
      halfLen = Math.max(halfLen, Math.abs(c.x * ux + c.y * uy));
      halfWid = Math.max(halfWid, Math.abs(-c.x * uy + c.y * ux));
    }
    const k0 = halfLen > 1e-9 ? Math.min(1, halfWid / halfLen) : 1;
    const k = k0 + (1 - k0) * elongation;
    // Compressed tangent coordinates + their mean radius (the circle the
    // rounding blends toward — the mean keeps size continuous through
    // the final merge).
    const compressed = coords.map((c) => {
      const a = (c.x * ux + c.y * uy) * k;
      const b = -c.x * uy + c.y * ux;
      return { x: a * ux - b * uy, y: a * uy + b * ux };
    });
    const meanTheta =
      compressed.reduce((s, c) => s + Math.hypot(c.x, c.y), 0) /
      compressed.length;
    const rounding = (1 - elongation) ** 3;
    const shaped = compressed.map((c) => {
      const theta = Math.hypot(c.x, c.y);
      if (theta < 1e-12) return { theta: 0, dx: 1, dy: 0 };
      return {
        theta: theta + (meanTheta - theta) * rounding,
        dx: c.x / theta,
        dy: c.y / theta,
      };
    });
    // Area preservation: renormalize the shaped outline to the panel's
    // ORIGINAL solid angle, so elongation trades length for width/size
    // instead of losing fabric. Solved by fixed-point iteration on a
    // uniform angular factor (exact on the sphere; converges in 2-3
    // rounds). The user's ovalSize scale applies on top.
    const pointAt = (s: { theta: number; dx: number; dy: number }, f: number) => {
      const t = s.theta * f;
      const dir = e1.clone().multiplyScalar(s.dx).addScaledVector(e2, s.dy);
      return center
        .clone()
        .multiplyScalar(Math.cos(t))
        .addScaledVector(dir, Math.sin(t));
    };
    const solidAngleAt = (f: number) => {
      let solid = 0;
      for (let i = 0; i < shaped.length; i++) {
        const a = pointAt(shaped[i], f);
        const b = pointAt(shaped[(i + 1) % shaped.length], f);
        const triple = a.clone().cross(b).dot(center);
        const denom = 1 + a.dot(b) + b.dot(center) + center.dot(a);
        solid += 2 * Math.atan2(triple, denom);
      }
      return Math.abs(solid);
    };
    const originalSolid = (() => {
      let solid = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = original[loop[i]].clone().normalize();
        const b = original[loop[(i + 1) % loop.length]].clone().normalize();
        const triple = a.clone().cross(b).dot(center);
        const denom = 1 + a.dot(b) + b.dot(center) + center.dot(a);
        solid += 2 * Math.atan2(triple, denom);
      }
      return Math.abs(solid);
    })();
    let f = 1;
    for (let iter = 0; iter < 3; iter++) {
      const current = solidAngleAt(f);
      if (current < 1e-12) break;
      f *= Math.sqrt(originalSolid / current);
    }
    loop.forEach((vi, idx) => {
      moved.set(vi, pointAt(shaped[idx], f * scale).setLength(radius));
    });
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
