/**
 * Ramer-Douglas-Peucker line simplification on the surface of a sphere.
 *
 * Standard RDP uses perpendicular Euclidean distance from a candidate
 * point to the chord between its kept neighbors. On a sphere, points lie
 * on a curved surface and the meaningful distance is the GREAT-CIRCLE
 * angle from the candidate to the great-circle arc between the kept
 * neighbors — not the Euclidean perpendicular.
 *
 * For curves between two unit vectors a, b, the great-circle arc lies in
 * the plane spanned by a and b through the origin. The (signed) distance
 * from a third unit vector p to that plane is `n · p` where
 * `n = normalize(a × b)`. The unsigned angular distance from p to the
 * great-circle is `asin(|n · p|)` — equivalent to the perpendicular
 * great-circle distance.
 */

/** Downsample a curve of points on a unit sphere using spherical RDP.
 *  Endpoints are always preserved. Tolerance is in radians. */
export function sphericalRdp(
  points: ReadonlyArray<[number, number, number]>,
  toleranceRad: number,
): Array<[number, number, number]> {
  if (points.length <= 2) return points.map((p) => [...p] as [number, number, number]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  rdpRecurse(points, 0, points.length - 1, toleranceRad, keep);
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push([...points[i]] as [number, number, number]);
  }
  return out;
}

/**
 * Same as `sphericalRdp` but operates on indices into a shared welded
 * vertex pool. Returns the kept indices in order.
 */
export function sphericalRdpIndices(
  indices: ReadonlyArray<number>,
  positions: Float32Array,
  toleranceRad: number,
): number[] {
  if (indices.length <= 2) return [...indices];
  const points: Array<[number, number, number]> = indices.map((i) => [
    positions[i * 3],
    positions[i * 3 + 1],
    positions[i * 3 + 2],
  ]);
  const keep = new Uint8Array(indices.length);
  keep[0] = 1;
  keep[indices.length - 1] = 1;
  rdpRecurse(points, 0, indices.length - 1, toleranceRad, keep);
  const out: number[] = [];
  for (let i = 0; i < indices.length; i++) {
    if (keep[i]) out.push(indices[i]);
  }
  return out;
}

function rdpRecurse(
  points: ReadonlyArray<readonly [number, number, number]>,
  lo: number,
  hi: number,
  toleranceRad: number,
  keep: Uint8Array,
): void {
  if (hi - lo < 2) return;
  // Plane normal of the great-circle through points[lo] and points[hi].
  const a = points[lo];
  const b = points[hi];
  let nx = a[1] * b[2] - a[2] * b[1];
  let ny = a[2] * b[0] - a[0] * b[2];
  let nz = a[0] * b[1] - a[1] * b[0];
  const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nLen < 1e-12) {
    // Endpoints are colinear (antipodal or coincident). Fall back to
    // straight 3D perpendicular distance — keep the farthest point.
    let maxD = 0;
    let maxI = -1;
    for (let i = lo + 1; i < hi; i++) {
      const dx = points[i][0] - a[0];
      const dy = points[i][1] - a[1];
      const dz = points[i][2] - a[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxD) {
        maxD = d2;
        maxI = i;
      }
    }
    if (maxI > 0) {
      keep[maxI] = 1;
      rdpRecurse(points, lo, maxI, toleranceRad, keep);
      rdpRecurse(points, maxI, hi, toleranceRad, keep);
    }
    return;
  }
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;

  // Find the candidate with the largest signed-distance to the plane.
  let maxAngle = 0;
  let maxI = -1;
  for (let i = lo + 1; i < hi; i++) {
    const p = points[i];
    // Project p onto the great-circle plane is implicit; the angular
    // offset from the plane is asin(|n·p|) for unit p.
    const dot = Math.abs(nx * p[0] + ny * p[1] + nz * p[2]);
    const angle = Math.asin(Math.min(1, dot));
    if (angle > maxAngle) {
      maxAngle = angle;
      maxI = i;
    }
  }

  if (maxI === -1 || maxAngle < toleranceRad) return;
  keep[maxI] = 1;
  rdpRecurse(points, lo, maxI, toleranceRad, keep);
  rdpRecurse(points, maxI, hi, toleranceRad, keep);
}
