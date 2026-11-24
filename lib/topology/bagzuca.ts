import { Vector3 } from "three";

import { panelId, type PanelTopology } from "@/lib/types";

import { topologyFromFaces } from "./fromFaces";

/** Points per seam, junction to junction, spaced evenly by arc length. */
const SEAM_SEGMENTS = 64;
/** Fine samples the even spacing is measured on. */
const FINE_SAMPLES = 2048;
/**
 * Lobe profile: the seam's sideways offset follows |sin|^LOBE_SHAPE. Below 1
 * it flattens the wave's crests into the round, near-parallel-sided lobes of
 * the photographed ball; 1 is a plain sine with pointed lobes.
 */
const LOBE_SHAPE = 0.4;
/** Default swirl (radians of sideways offset at the crest). */
export const BAGZUCA_SWIRL = 0.42;

export function bagzuca(radius = 1, swirl = BAGZUCA_SWIRL): PanelTopology {
  const corners: Array<[number, number, number]> = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  // CCW from outside, as in cube().
  const faces = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
    [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3],
  ];

  const vertices: Array<[number, number, number]> = corners.map(([x, y, z]) => [x, y, z]);
  const unit = corners.map(([x, y, z]) => new Vector3(x, y, z).normalize());

  // Interior seam points, stored from the lower corner index to the higher.
  const seams = new Map<string, number[]>();
  const seamPoints = (a: number, b: number): number[] => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}-${hi}`;
    let ids = seams.get(key);
    if (!ids) {
      ids = [];
      const A = unit[lo];
      const B = unit[hi];
      const angle = A.angleTo(B);
      const axis = new Vector3().crossVectors(A, B).normalize();
      const at = (t: number): Vector3 => {
        const onArc = A.clone().applyAxisAngle(axis, angle * t);
        // Sideways on the sphere: rotate about the arc's tangent.
        const tangent = new Vector3().crossVectors(axis, onArc).normalize();
        const w = Math.sin(2 * Math.PI * t);
        return onArc.applyAxisAngle(tangent, swirl * Math.sign(w) * Math.abs(w) ** LOBE_SHAPE);
      };
      // The profile is steep near the corners and the middle, so equal steps
      // in t would leave straight stubs there: resample by arc length.
      const fine = Array.from({ length: FINE_SAMPLES + 1 }, (_, i) => at(i / FINE_SAMPLES));
      const cum = [0];
      for (let i = 1; i < fine.length; i++) cum.push(cum[i - 1] + fine[i].distanceTo(fine[i - 1]));
      const total = cum[cum.length - 1];
      let j = 0;
      for (let i = 1; i < SEAM_SEGMENTS; i++) {
        const target = (total * i) / SEAM_SEGMENTS;
        while (cum[j + 1] < target) j++;
        const f = (target - cum[j]) / (cum[j + 1] - cum[j]);
        const p = fine[j].clone().lerp(fine[j + 1], f);
        ids.push(vertices.length);
        vertices.push([p.x, p.y, p.z]);
      }
      seams.set(key, ids);
    }
    return a < b ? ids : [...ids].reverse();
  };

  const loops = faces.map((face) =>
    face.flatMap((c, i) => [c, ...seamPoints(c, face[(i + 1) % face.length])]),
  );
  // Frozen to the default shape so a swirl of 0 (a plain cube) keeps the ids.
  return topologyFromFaces(vertices, loops, radius, (i) => panelId(i, "polygon"));
}
