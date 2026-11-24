import { Vector3 } from "three";

import { panelId, shapeForVertexCount, type PanelTopology } from "@/lib/types";

import { topologyFromFaces } from "./fromFaces";
import { ICOSAHEDRON } from "./truncationFamily";

/**
 * Balls built like the 32-panel bag: every main panel is stitched all the way
 * round, and the fillers between them meet each other only along short edges
 * that stay unstitched (bleed holes).
 *
 * Each main panel is an exactly regular spherical polygon centred on a vertex
 * of a parent solid, one corner pointing at each neighbouring vertex (and, when
 * `notched`, one more pointing into each face between them). Main panels never
 * touch, so the fillers — one per parent face — are simply what is left: their
 * long sides are main-panel sides and their short sides join the facing corners
 * of two neighbouring main panels.
 */

interface Parent {
  centers: Vector3[];
  /** Vertex loops, CCW seen from outside. */
  faces: number[][];
}

interface NetOptions {
  /** Angular circumradius (radians) of the main panel on parent vertex `v`. */
  radius: (v: number) => number;
  /** Also put a corner toward each parent face: n neighbours → a 2n-gon. */
  notched?: boolean;
  /** Split every seam into great-arc pieces no longer than this (radians). */
  maxSegment?: number;
}

interface Net {
  vertices: Vector3[];
  /** Fillers first (one per parent face), then main panels (one per parent vertex). */
  loops: number[][];
  fillerCount: number;
}

function tangentFrame(c: Vector3): [Vector3, Vector3] {
  const ref = Math.abs(c.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const e1 = ref.sub(c.clone().multiplyScalar(ref.dot(c))).normalize();
  return [e1, c.clone().cross(e1)];
}

/** Flip any face that isn't CCW from outside. */
function orient(centers: Vector3[], faces: number[][]): number[][] {
  return faces.map((f) => {
    const [a, b, c] = f.map((i) => centers[i]);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const mid = f.reduce((s, i) => s.add(centers[i]), new Vector3());
    return n.dot(mid) > 0 ? f : [...f].reverse();
  });
}

function buildNet({ centers, faces }: Parent, { radius, notched = false }: NetOptions): Net {
  const vertices: Vector3[] = [];
  const toward = new Map<string, number>(); // main panel v's corner toward neighbour x
  const into = new Map<string, number>(); // main panel v's corner into face f
  const mains: number[][] = [];

  centers.forEach((c, v) => {
    const nbrs = new Set<number>();
    faces.forEach((f) => {
      const i = f.indexOf(v);
      if (i >= 0) {
        nbrs.add(f[(i + f.length - 1) % f.length]);
        nbrs.add(f[(i + 1) % f.length]);
      }
    });
    const [e1, e2] = tangentFrame(c);
    const az = (p: Vector3) => Math.atan2(p.dot(e2), p.dot(e1));
    const sorted = [...nbrs].sort((a, b) => az(centers[a]) - az(centers[b]));
    const n = sorted.length;
    // Rotation that best points the regular corners at the neighbours.
    let sx = 0;
    let sy = 0;
    sorted.forEach((x, k) => {
      const d = az(centers[x]) - (2 * Math.PI * k) / n;
      sx += Math.cos(d);
      sy += Math.sin(d);
    });
    const offset = Math.atan2(sy, sx);
    const rho = radius(v);
    const corner = (a: number) => {
      vertices.push(
        c.clone().multiplyScalar(Math.cos(rho))
          .add(e1.clone().multiplyScalar(Math.sin(rho) * Math.cos(a)))
          .add(e2.clone().multiplyScalar(Math.sin(rho) * Math.sin(a))),
      );
      return vertices.length - 1;
    };
    const loop: number[] = [];
    sorted.forEach((x, k) => {
      const p = corner(offset + (2 * Math.PI * k) / n);
      toward.set(`${v}>${x}`, p);
      loop.push(p);
      if (notched) {
        const next = sorted[(k + 1) % n];
        const f = faces.findIndex((face) => face.includes(v) && face.includes(x) && face.includes(next));
        const q = corner(offset + (2 * Math.PI * (k + 0.5)) / n);
        into.set(`${v}|${f}`, q);
        loop.push(q);
      }
    });
    mains.push(loop);
  });

  const fillers = faces.map((f, fi) =>
    f.flatMap((y, j) => {
      const x = f[(j + f.length - 1) % f.length];
      const z = f[(j + 1) % f.length];
      const mid = notched ? [into.get(`${y}|${fi}`)!] : [];
      return [toward.get(`${y}>${x}`)!, ...mid, toward.get(`${y}>${z}`)!];
    }),
  );
  return { vertices, loops: [...fillers, ...mains], fillerCount: fillers.length };
}

/** Insert shared great-arc points so no seam piece exceeds `maxSegment`. */
function densify(net: Net, maxSegment: number): Net {
  const vertices = [...net.vertices];
  const seams = new Map<string, number[]>();
  const between = (a: number, b: number): number[] => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    let ids = seams.get(`${lo}-${hi}`);
    if (!ids) {
      const A = vertices[lo];
      const B = vertices[hi];
      const pieces = Math.ceil(A.angleTo(B) / maxSegment);
      ids = [];
      for (let i = 1; i < pieces; i++) {
        vertices.push(A.clone().lerp(B, i / pieces).normalize());
        ids.push(vertices.length - 1);
      }
      seams.set(`${lo}-${hi}`, ids);
    }
    return a < b ? ids : [...ids].reverse();
  };
  const loops = net.loops.map((loop) => loop.flatMap((a, i) => [a, ...between(a, loop[(i + 1) % loop.length])]));
  return { ...net, vertices, loops };
}

function toTopology(net: Net, radius: number, maxSegment?: number): PanelTopology {
  // Ids from the corner count, frozen before densifying.
  const shapes = net.loops.map((loop) => shapeForVertexCount(loop.length));
  const out = maxSegment ? densify(net, maxSegment) : net;
  return topologyFromFaces(
    out.vertices.map((v) => [v.x, v.y, v.z] as [number, number, number]),
    out.loops,
    radius,
    (i) => panelId(i, shapes[i]),
  );
}

/** Corner angle (radians) at `v` between the great arcs to `a` and `b`. */
function cornerAngle(a: Vector3, v: Vector3, b: Vector3): number {
  const t1 = a.clone().sub(v.clone().multiplyScalar(a.dot(v)));
  const t2 = b.clone().sub(v.clone().multiplyScalar(b.dot(v)));
  return t1.angleTo(t2);
}

const DEG = Math.PI / 180;

// ── Hex-capped 38: 12 pentagons + 2 hexagon caps stitched, 24 filler hexagons ──

/** Default angular circumradii, from the regularised preview the design was picked from. */
export const HEX_CAPPED_PENT_RADIUS = 22.84 * DEG;
export const HEX_CAPPED_HEX_RADIUS = 30.65 * DEG;

/**
 * Gyroelongated hexagonal bipyramid: poles, a ring of 6 at polar angle
 * `theta`, and a ring of 6 at π − theta turned 30°.
 */
function hexCappedParent(theta: number): Parent {
  const centers = [new Vector3(0, 0, 1), new Vector3(0, 0, -1)];
  const ring = (polar: number, turn: number) => {
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3 + turn;
      centers.push(new Vector3(Math.sin(polar) * Math.cos(a), Math.sin(polar) * Math.sin(a), Math.cos(polar)));
    }
  };
  ring(theta, 0);
  ring(Math.PI - theta, Math.PI / 6);
  const top = (k: number) => 2 + (k % 6);
  const bottom = (k: number) => 8 + (k % 6);
  const faces: number[][] = [];
  for (let k = 0; k < 6; k++) {
    faces.push([0, top(k), top(k + 1)]);
    faces.push([1, bottom(k + 1), bottom(k)]);
    faces.push([top(k), bottom(k), top(k + 1)]);
    faces.push([bottom(k), bottom(k + 1), top(k + 1)]);
  }
  return { centers, faces: orient(centers, faces) };
}

/**
 * The rings' polar angle that makes the filler corners most even, for the
 * given panel sizes: golden-section search on the spread of corner angles.
 */
export function hexCappedRingAngle(pentRadius: number, hexRadius: number): number {
  const spread = (theta: number) => {
    const net = buildNet(hexCappedParent(theta), { radius: (v) => (v < 2 ? hexRadius : pentRadius) });
    let lo = Infinity;
    let hi = -Infinity;
    for (const loop of net.loops.slice(0, net.fillerCount)) {
      loop.forEach((v, i) => {
        const a = cornerAngle(
          net.vertices[loop[(i + loop.length - 1) % loop.length]],
          net.vertices[v],
          net.vertices[loop[(i + 1) % loop.length]],
        );
        lo = Math.min(lo, a);
        hi = Math.max(hi, a);
      });
    }
    return hi - lo;
  };
  const g = (Math.sqrt(5) - 1) / 2;
  let a = 55 * DEG;
  let b = 80 * DEG;
  for (let i = 0; i < 48; i++) {
    const c = b - g * (b - a);
    const d = a + g * (b - a);
    if (spread(c) < spread(d)) b = d;
    else a = c;
  }
  return (a + b) / 2;
}

export function hexCapped38(radius = 1, pentScale = 1, hexScale = 1): PanelTopology {
  const rp = HEX_CAPPED_PENT_RADIUS * pentScale;
  const rh = HEX_CAPPED_HEX_RADIUS * hexScale;
  const parent = hexCappedParent(hexCappedRingAngle(rp, rh));
  return toTopology(buildNet(parent, { radius: (v) => (v < 2 ? rh : rp) }), radius);
}

// ── Cube-and-corner 38: 6 squares + 8 hexagons stitched, 24 filler hexagons ──

export const CUBE_CORNER_SQUARE_RADIUS = 18.35 * DEG;
export const CUBE_CORNER_HEX_RADIUS = 28.02 * DEG;

/** Tetrakis hexahedron: the 6 axes and 8 cube corners, each cube face split into 4. */
function tetrakisParent(): Parent {
  const centers: Vector3[] = [];
  for (const axis of [0, 1, 2]) {
    for (const s of [1, -1]) centers.push(new Vector3().setComponent(axis, s));
  }
  for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) centers.push(new Vector3(x, y, z).normalize());
  const faces: number[][] = [];
  for (let a = 0; a < 6; a++) {
    const c = centers[a];
    const [e1, e2] = tangentFrame(c);
    const ring = centers
      .map((p, i) => i)
      .filter((i) => i >= 6 && centers[i].dot(c) > 0)
      .sort((i, j) => Math.atan2(centers[i].dot(e2), centers[i].dot(e1)) - Math.atan2(centers[j].dot(e2), centers[j].dot(e1)));
    ring.forEach((i, k) => faces.push([a, i, ring[(k + 1) % 4]]));
  }
  return { centers, faces: orient(centers, faces) };
}

export function cubeCorner38(radius = 1, squareScale = 1, hexScale = 1): PanelTopology {
  const rs = CUBE_CORNER_SQUARE_RADIUS * squareScale;
  const rh = CUBE_CORNER_HEX_RADIUS * hexScale;
  return toTopology(buildNet(tetrakisParent(), { radius: (v) => (v < 6 ? rs : rh) }), radius);
}

// ── Star bag: 20 hexagons stitched, 12 five-armed star fillers ──

/** Default hexagon circumradius: the short edge between arm tips is 40% of a hexagon side. */
export const STAR_HEX_RADIUS = 17.5 * DEG;
/** Seam pieces; the stars are concave and the seams are long, so they're sampled like Bagzuca's. */
const STAR_MAX_SEGMENT = 1.5 * DEG;

/** Dodecahedron: the icosahedron's face centres, one pentagon per icosahedron vertex. */
function dodecahedronParent(): Parent {
  const ico = ICOSAHEDRON.vertices.map(([x, y, z]) => new Vector3(x, y, z));
  const centers = ICOSAHEDRON.faces.map((f) =>
    f.reduce((s, i) => s.add(ico[i]), new Vector3()).normalize(),
  );
  const faces = ico.map((p, v) => {
    const c = p.clone().normalize();
    const [e1, e2] = tangentFrame(c);
    return ICOSAHEDRON.faces
      .map((f, i) => (f.includes(v) ? i : -1))
      .filter((i) => i >= 0)
      .sort((i, j) => Math.atan2(centers[i].dot(e2), centers[i].dot(e1)) - Math.atan2(centers[j].dot(e2), centers[j].dot(e1)));
  });
  return { centers, faces: orient(centers, faces) };
}

export function starBag(radius = 1, hexScale = 1): PanelTopology {
  const rh = STAR_HEX_RADIUS * hexScale;
  return toTopology(buildNet(dodecahedronParent(), { radius: () => rh, notched: true }), radius, STAR_MAX_SEGMENT);
}
