/**
 * Face enumeration via combinatorial rotation systems.
 *
 * Replaces the Trionda-specific K4 triplet hack with an algorithm that
 * works for any sphere-embedded planar graph: tetrahedron (4 panels),
 * cube (6), octahedron (8), dodecahedron (12), icosahedron (20),
 * soccer-ball (32), Goldberg variants (42, 92, 162), and any future
 * design.
 *
 * Algorithm (classical planar dual via rotation system / combinatorial map):
 *
 *   1. Each curve between junctions A and B is split into two DIRECTED
 *      "half-edges": A→B (right side) and B→A (left side, when walking A→B).
 *
 *   2. At each junction J, sort the half-edges OUTGOING from J by their
 *      polar angle in J's local tangent plane on the sphere. This gives
 *      the cyclic "rotation" of curves around J.
 *
 *   3. Walk faces by composing two operations on half-edges:
 *        - twin(h):  swap to the reverse half-edge
 *        - next(h):  at h's target junction T, find the half-edge that
 *                    is the CLOCKWISE neighbor (in T's rotation) of
 *                    twin(h), and return its outgoing direction.
 *      Walking next(next(...)) traces a face boundary; faces are the
 *      orbits of next.
 *
 *   4. Each face's half-edges, concatenated along the curves they
 *      represent, give the panel boundary loop.
 *
 * Reference: standard rotation system / combinatorial map representation
 * for planar graphs. See e.g. "Combinatorial Maps and Subdivisions" or
 * any computational topology text.
 */
import type { CurveSegment } from "./types.js";

export interface FaceEnumerationResult {
  /** Each face's ordered list of welded-vertex indices (a closed loop). */
  panels: number[][];
}

export function enumerateFaces(
  segments: CurveSegment[],
  positions: Float32Array,
): FaceEnumerationResult {
  if (segments.length === 0) {
    throw new Error("Cannot enumerate faces from empty segment list");
  }

  // ---------------------------------------------------------------------------
  // 1. Build half-edges. Each curve segment becomes two: forward (a→b)
  //    and reverse (b→a). Each carries a path through degree-2 verts.
  // ---------------------------------------------------------------------------
  interface HalfEdge {
    id: number;
    from: number;
    to: number;
    /** Welded-vertex path INCLUDING both endpoints, in walk direction. */
    path: number[];
    /** id of the opposite half-edge (twin). */
    twinId: number;
    /** Tangent direction at `from`, in 3D — the unit vector toward the
     *  second vertex in `path`. Used for rotation sorting. */
    tangent: [number, number, number];
  }
  const halves: HalfEdge[] = [];
  for (const seg of segments) {
    const fId = halves.length;
    const rId = fId + 1;
    halves.push({
      id: fId,
      from: seg.a,
      to: seg.b,
      path: [...seg.path],
      twinId: rId,
      tangent: tangentAt(seg.path[0], seg.path[1], positions),
    });
    halves.push({
      id: rId,
      from: seg.b,
      to: seg.a,
      path: [...seg.path].reverse(),
      twinId: fId,
      tangent: tangentAt(
        seg.path[seg.path.length - 1],
        seg.path[seg.path.length - 2],
        positions,
      ),
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Group half-edges by their `from` junction and sort by polar angle
  //    in the tangent plane at that junction. This gives the rotation
  //    order: a ccw list of outgoing half-edges around each junction.
  // ---------------------------------------------------------------------------
  const outgoing = new Map<number, HalfEdge[]>();
  for (const h of halves) {
    const arr = outgoing.get(h.from);
    if (arr) arr.push(h);
    else outgoing.set(h.from, [h]);
  }

  /** For each junction, the outgoing half-edges sorted CCW by tangent angle. */
  const rotation = new Map<number, HalfEdge[]>();
  /** Quick lookup: for a junction J and half-edge h going IN to J, the
   *  index of twin(h) in J's outgoing rotation. */
  const rotationIndex = new Map<number, Map<number, number>>(); // J → (heId → idx)

  for (const [j, outs] of outgoing) {
    if (outs.length < 2) {
      throw new Error(
        `Junction ${j} has only ${outs.length} outgoing half-edge(s); cannot enumerate faces.`,
      );
    }
    // Build a 2D tangent basis at this junction on the sphere.
    const n = unit([
      positions[j * 3],
      positions[j * 3 + 1],
      positions[j * 3 + 2],
    ]);
    const helper: [number, number, number] =
      Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = unit(cross(n, helper));
    const v = unit(cross(n, u));

    // Compute each outgoing half-edge's polar angle in (u, v).
    const withAngle = outs.map((h) => {
      const tu = dot(h.tangent, u);
      const tv = dot(h.tangent, v);
      return { h, angle: Math.atan2(tv, tu) };
    });
    withAngle.sort((a, b) => a.angle - b.angle);
    const sorted = withAngle.map((wa) => wa.h);
    rotation.set(j, sorted);
    const idxMap = new Map<number, number>();
    sorted.forEach((h, i) => idxMap.set(h.id, i));
    rotationIndex.set(j, idxMap);
  }

  // ---------------------------------------------------------------------------
  // 3. Face walk. `next(h)` for a half-edge ending at junction T:
  //      let twin = twin(h)  (going OUT from T back along the same curve)
  //      let nextIdx = (rotationIndex[T][twin] + 1) % out.length
  //      return rotation[T][nextIdx]
  //    Walking next(next(...)) traces a face's boundary half-edges in
  //    order. Each face is an orbit.
  //
  //    Note on direction: we pick the "+1" turn. With sort = CCW from
  //    outside the sphere, +1 in the rotation = "next curve to the left"
  //    in the outward view. This makes each face's half-edges traverse
  //    the face's boundary clockwise when viewed from outside. Each face
  //    will need its boundary reversed before becoming a panel loop
  //    (since panels are CCW from outside). We do that reversal at the
  //    end below.
  // ---------------------------------------------------------------------------
  const faceOfHalfEdge = new Int32Array(halves.length).fill(-1);
  const faces: number[][] = []; // each entry: ordered half-edge ids

  for (let h0 = 0; h0 < halves.length; h0++) {
    if (faceOfHalfEdge[h0] !== -1) continue;
    const faceId = faces.length;
    const walk: number[] = [];
    let h = h0;
    let safety = halves.length + 10;
    while (faceOfHalfEdge[h] === -1) {
      faceOfHalfEdge[h] = faceId;
      walk.push(h);
      h = nextHalfEdge(halves[h], halves, rotation, rotationIndex);
      if (--safety < 0) {
        throw new Error("Face walk did not terminate — graph is malformed");
      }
    }
    if (h !== h0) {
      throw new Error(
        `Face walk ended at h=${h} instead of starting h0=${h0} — graph is non-orientable or has a defect`,
      );
    }
    faces.push(walk);
  }

  // ---------------------------------------------------------------------------
  // 4. Compose each face's half-edge paths into a boundary loop. Drop
  //    the duplicate junction vertex at each curve joint, and reverse
  //    the loop (see direction note above) so it winds CCW from outside.
  //    The CCW orientation is sanity-checked downstream with a
  //    signed-area test.
  // ---------------------------------------------------------------------------
  const panels: number[][] = [];
  for (const face of faces) {
    let loop: number[] = [];
    for (const hId of face) {
      const path = halves[hId].path;
      if (loop.length === 0) loop = [...path];
      else loop.push(...path.slice(1));
    }
    // The last vertex equals the first (closed); drop it.
    if (loop.length > 1 && loop[loop.length - 1] === loop[0]) loop.pop();
    panels.push(loop);
  }

  // ---------------------------------------------------------------------------
  // 5. Drop the outer face. For sphere graphs, the algorithm produces
  //    F = #panels + 1 face orbits, one for each panel and one extra
  //    "outer" face that walks every edge in the opposite winding. We
  //    detect it as the face whose signed-area vector opposes its
  //    centroid direction (CW from outside instead of CCW). Actually
  //    for sphere-embedded graphs (no outer infinite face), ALL faces
  //    are interior — but the choice of rotation direction means half
  //    of the faces wind backward. We orient each face independently.
  // ---------------------------------------------------------------------------
  const orientedPanels = panels.map((loop) =>
    orientCcwFromOutside(loop, positions),
  );

  return { panels: orientedPanels };
}

// ============================================================================
// Helpers
// ============================================================================

function nextHalfEdge(
  h: { id: number; to: number; twinId: number },
  halves: Array<{ id: number }>,
  rotation: Map<number, Array<{ id: number }>>,
  rotationIndex: Map<number, Map<number, number>>,
): number {
  const T = h.to;
  const twinIdx = rotationIndex.get(T)!.get(h.twinId);
  if (twinIdx === undefined) {
    throw new Error(`Half-edge ${h.id}'s twin not in junction ${T}'s rotation`);
  }
  const outs = rotation.get(T)!;
  const nextIdx = (twinIdx + 1) % outs.length;
  return outs[nextIdx].id;
}

function tangentAt(
  a: number,
  b: number,
  positions: Float32Array,
): [number, number, number] {
  return unit([
    positions[b * 3] - positions[a * 3],
    positions[b * 3 + 1] - positions[a * 3 + 1],
    positions[b * 3 + 2] - positions[a * 3 + 2],
  ]);
}

function unit(v: [number, number, number]): [number, number, number] {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function orientCcwFromOutside(
  loop: number[],
  positions: Float32Array,
): number[] {
  // Signed-area vector Σ vᵢ × vᵢ₊₁ points OUTWARD for a CCW-from-outside
  // loop on a sphere centered at origin.
  let ax = 0,
    ay = 0,
    az = 0;
  for (let i = 0; i < loop.length; i++) {
    const va = loop[i];
    const vb = loop[(i + 1) % loop.length];
    const x1 = positions[va * 3],
      y1 = positions[va * 3 + 1],
      z1 = positions[va * 3 + 2];
    const x2 = positions[vb * 3],
      y2 = positions[vb * 3 + 1],
      z2 = positions[vb * 3 + 2];
    ax += y1 * z2 - z1 * y2;
    ay += z1 * x2 - x1 * z2;
    az += x1 * y2 - y1 * x2;
  }
  // Loop centroid direction (rough outward normal).
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const v of loop) {
    cx += positions[v * 3];
    cy += positions[v * 3 + 1];
    cz += positions[v * 3 + 2];
  }
  if (ax * cx + ay * cy + az * cz < 0) {
    return loop.slice().reverse();
  }
  return loop;
}
