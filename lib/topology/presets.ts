import { Vector3 } from "three";
import type { HoleCountConvention } from "@/lib/laser/template";
import type { LaserSettings } from "@/lib/laser/types";
import { panelId, type PanelColors, type PanelTopology } from "@/lib/types";
import { topologyFromFaces } from "./fromFaces";
import { goldbergClassI, gp3ShortEdgeAngle } from "./goldberg";
import { baseball } from "./baseball";
import { spiral } from "./spiral";
import {
  circleSoccer,
  circleSoccer6,
  concaveCircleSoccer,
  concaveCircleSoccer6,
} from "./circleSoccer";
import { trionda } from "./trionda";
import { teamgeist } from "./teamgeist";
import { orbita } from "./orbita";
import { scaleSeamAmplitude } from "./seamAmplitudeWarp";
import { BAGZUCA_SWIRL, bagzuca } from "./bagzuca";
import {
  kaleidoscopeColors,
  kaleidoscopeTopology,
  kaleidoscopeWarp,
} from "@/lib/kaleidoscope";
import { morphFeaturePanels } from "./panelScaleWarp";
import {
  soccerShortEdgeAngle,
  truncatedIcosahedronFamily,
  truncatedOctahedronFamily,
} from "./truncationFamily";

// -----------------------------------------------------------------------------
// Presets
// -----------------------------------------------------------------------------

export function tetrahedron(radius = 1): PanelTopology {
  // 4 vertices, 4 triangular faces. Standard orientation.
  return topologyFromFaces(
    [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ],
    [
      [0, 1, 2],
      [0, 3, 1],
      [0, 2, 3],
      [1, 3, 2],
    ],
    radius,
  );
}

export function cube(radius = 1): PanelTopology {
  // 8 vertices, 6 square faces. Each face listed CCW from outside.
  return topologyFromFaces(
    [
      [-1, -1, -1], // 0
      [1, -1, -1], // 1
      [1, 1, -1], // 2
      [-1, 1, -1], // 3
      [-1, -1, 1], // 4
      [1, -1, 1], // 5
      [1, 1, 1], // 6
      [-1, 1, 1], // 7
    ],
    [
      [0, 3, 2, 1], // -Z
      [4, 5, 6, 7], // +Z
      [0, 1, 5, 4], // -Y
      [2, 3, 7, 6], // +Y
      [1, 2, 6, 5], // +X
      [0, 4, 7, 3], // -X
    ],
    radius,
  );
}

export function octahedron(radius = 1): PanelTopology {
  // 6 vertices, 8 triangular faces (the cube's dual).
  return topologyFromFaces(
    [
      [1, 0, 0], // 0  +X
      [-1, 0, 0], // 1  -X
      [0, 1, 0], // 2  +Y
      [0, -1, 0], // 3  -Y
      [0, 0, 1], // 4  +Z
      [0, 0, -1], // 5  -Z
    ],
    [
      [0, 2, 4],
      [2, 1, 4],
      [1, 3, 4],
      [3, 0, 4],
      [2, 0, 5],
      [1, 2, 5],
      [3, 1, 5],
      [0, 3, 5],
    ],
    radius,
  );
}

export function cuboctahedron(radius = 1): PanelTopology {
  // 12 vertices at midpoints of cube edges, 8 triangle + 6 square faces (14
  // total). The degenerate (shortEdge = 0) member of the octahedron truncation
  // family — see truncationFamily.ts.
  return truncatedOctahedronFamily(radius, 0);
}

export function icosahedron(radius = 1): PanelTopology {
  // 12 vertices using the golden ratio, 20 triangular faces.
  const phi = (1 + Math.sqrt(5)) / 2;
  return topologyFromFaces(
    [
      [-1, phi, 0], // 0
      [1, phi, 0], // 1
      [-1, -phi, 0], // 2
      [1, -phi, 0], // 3
      [0, -1, phi], // 4
      [0, 1, phi], // 5
      [0, -1, -phi], // 6
      [0, 1, -phi], // 7
      [phi, 0, -1], // 8
      [phi, 0, 1], // 9
      [-phi, 0, -1], // 10
      [-phi, 0, 1], // 11
    ],
    [
      [0, 11, 5],
      [0, 5, 1],
      [0, 1, 7],
      [0, 7, 10],
      [0, 10, 11],
      [1, 5, 9],
      [5, 11, 4],
      [11, 10, 2],
      [10, 7, 6],
      [7, 1, 8],
      [3, 9, 4],
      [3, 4, 2],
      [3, 2, 6],
      [3, 6, 8],
      [3, 8, 9],
      [4, 9, 5],
      [2, 4, 11],
      [6, 2, 10],
      [8, 6, 7],
      [9, 8, 1],
    ],
    radius,
  );
}

export function dodecahedron(radius = 1): PanelTopology {
  // 20 vertices, 12 pentagonal faces. Built as the dual of the icosahedron's
  // face centroids would also work, but explicit construction is simpler here.
  // Vertices grouped into three rectangles plus golden-ratio scaled cube vertices.
  const phi = (1 + Math.sqrt(5)) / 2;
  const invPhi = 1 / phi;
  return topologyFromFaces(
    [
      // Cube vertices (8)
      [1, 1, 1], // 0
      [1, 1, -1], // 1
      [1, -1, 1], // 2
      [1, -1, -1], // 3
      [-1, 1, 1], // 4
      [-1, 1, -1], // 5
      [-1, -1, 1], // 6
      [-1, -1, -1], // 7
      // Rectangle in YZ plane (4)
      [0, invPhi, phi], // 8
      [0, invPhi, -phi], // 9
      [0, -invPhi, phi], // 10
      [0, -invPhi, -phi], // 11
      // Rectangle in XZ plane (4)
      [invPhi, phi, 0], // 12
      [invPhi, -phi, 0], // 13
      [-invPhi, phi, 0], // 14
      [-invPhi, -phi, 0], // 15
      // Rectangle in XY plane (4)
      [phi, 0, invPhi], // 16
      [phi, 0, -invPhi], // 17
      [-phi, 0, invPhi], // 18
      [-phi, 0, -invPhi], // 19
    ],
    [
      [0, 8, 10, 2, 16],
      [0, 16, 17, 1, 12],
      [12, 1, 9, 5, 14],
      [4, 14, 5, 19, 18],
      [4, 18, 6, 10, 8],
      [0, 12, 14, 4, 8],
      [2, 10, 6, 15, 13],
      [2, 13, 3, 17, 16],
      [3, 13, 15, 7, 11],
      [3, 11, 9, 1, 17],
      [5, 9, 11, 7, 19],
      [6, 18, 19, 7, 15],
    ],
    radius,
  );
}

type Point = readonly [number, number, number];

/** Every point from `base` by permuting its coordinates and flipping signs, without repeats. */
function signedPermutations(base: Point): Point[] {
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const seen = new Map<string, Point>();
  for (const order of orders) {
    for (let signs = 0; signs < 8; signs++) {
      const p = order.map((axis, i) => base[axis] * (signs & (1 << i) ? -1 : 1)) as unknown as Point;
      seen.set(p.map((x) => x.toFixed(9)).join(","), p);
    }
  }
  return [...seen.values()];
}

/**
 * The faces of a convex solid with these vertices, one per outward face
 * direction: the vertices furthest along it, in order around it (counter-
 * clockwise seen from outside, as topologyFromFaces expects).
 */
function facesByNormals(vertices: readonly Point[], normals: readonly Point[]): number[][] {
  return normals.map((n) => {
    const normal = new Vector3(...n).normalize();
    const reach = vertices.map((v) => normal.dot(new Vector3(...v)));
    const far = Math.max(...reach);
    const ids = reach.flatMap((d, i) => (d > far - 1e-9 ? [i] : []));
    const centre = ids.reduce((c, i) => c.add(new Vector3(...vertices[i])), new Vector3()).divideScalar(ids.length);
    const u = new Vector3(...vertices[ids[0]]).sub(centre).normalize();
    const w = new Vector3().crossVectors(normal, u);
    const angle = (i: number) => {
      const d = new Vector3(...vertices[i]).sub(centre);
      return Math.atan2(d.dot(w), d.dot(u));
    };
    return ids.sort((a, b) => angle(a) - angle(b));
  });
}

export function rhombicDodecahedron(radius = 1): PanelTopology {
  // 12 identical rhombi, one per cube edge: the cube's 8 corners (3 rhombi
  // meet) and the 6 axis points (4 meet). The cuboctahedron's dual.
  const vertices: Point[] = [...signedPermutations([1, 1, 1]), ...signedPermutations([2, 0, 0])];
  return topologyFromFaces(vertices, facesByNormals(vertices, signedPermutations([1, 1, 0])), radius);
}

/**
 * The 26-panel bag: a rhombicuboctahedron. 6 squares on the axes, 12 between
 * them, 8 triangles at the corners. The triangles are hexagons whose three
 * short sides have no length, and the axis squares octagons likewise: those
 * short sides are where the two meet. Two shape controls:
 *
 * - `bigSquares`: the axis panels' side next to a square over the corner
 *   panels' side next to a square (100% = all squares equal); above 100% the
 *   12 become oblongs.
 * - `shortEdge`: the corner panels' short side over their long side. 0 = the
 *   triangles and squares above; 100% (with bigSquares 100%) = the truncated
 *   cuboctahedron, squares, hexagons and octagons with every side equal.
 *
 * Vertices are the signed permutations of (1, q, r), all one distance from
 * the centre; at shortEdge 0, q = 1 and each pair of them is one corner.
 * Panel ids keep the triangle and square names at every setting, so painted
 * colors survive the sliders.
 */
function rhombicuboctahedronCorner(bigSquares: number, shortEdge: number): { q: number; r: number } {
  const long = 2 / bigSquares; // a corner panel's side next to a square
  const q = 1 + (shortEdge * long) / Math.SQRT2;
  return { q, r: q + long / Math.SQRT2 };
}

/** The 26-panel's short side (hexagon to octagon) as an angle on the unit sphere. */
export function rhombicuboctahedronShortAngle(shortEdgePct: number, params?: PresetParams): number {
  const { q, r } = rhombicuboctahedronCorner((params?.bigSquares ?? 100) / 100, shortEdgePct / 100);
  // From (1, q, r) to (q, 1, r): a chord of √2(q − 1) on a sphere of radius √(1 + q² + r²).
  const chord = Math.SQRT2 * (q - 1);
  return 2 * Math.asin(chord / (2 * Math.sqrt(1 + q * q + r * r)));
}

export function rhombicuboctahedron(radius = 1, bigSquares = 1, shortEdge = 0): PanelTopology {
  const { q, r } = rhombicuboctahedronCorner(bigSquares, shortEdge);
  const normals = [...signedPermutations([1, 0, 0]), ...signedPermutations([1, 1, 0]), ...signedPermutations([1, 1, 1])];
  const vertices = signedPermutations([1, q, r]);
  const faces = facesByNormals(vertices, normals);
  // 6 axis + 12 between: quads; 8 corners: triangles (their shapes at shortEdge 0).
  const idFor = (index: number) => panelId(index, index < 18 ? "quad" : "triangle");
  return topologyFromFaces(vertices, faces, radius, idFor);
}

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

/**
 * A shape degree of freedom a preset exposes as a slider. Values are plain
 * numbers keyed by `key`; the resolved values for a design live in its GLB's
 * asset extras (`asset.extras.paneler.params`) so they travel with the file.
 */
export interface PresetParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  /** Display suffix for the value, e.g. "%". Purely cosmetic. */
  unit?: string;
  /** Names for an integer param's values, indexed from `min`. */
  valueLabels?: string[];
  /** Stored and regenerated like any param, but not shown as a slider. */
  hidden?: boolean;
  /**
   * Show the slider as a length: the edge this param controls, as an angle
   * on the unit sphere at a given value. The Shape panel converts it to
   * millimetres at the current footbag size. `params` are the design's other
   * shape values, for an edge that also depends on them.
   */
  lengthAngle?: (value: number, params?: PresetParams) => number;
}

export type PresetParams = Record<string, number>;

export interface PresetEntry {
  id: string;
  label: string;
  panels: number;
  /** Shape parameters this preset supports. Absent → no Shape sliders. */
  params?: PresetParamDef[];
  /**
   * Show this preset's template only in local development builds — for
   * designs kept off the live picker. The baked GLB still ships (the
   * repo is public); this is presentation, not secrecy.
   */
  devOnly?: boolean;
  /**
   * Seam-true band flatten (net + templates): boundary lengths exact,
   * interior absorbs the strain. For single-seam band designs whose
   * sewn shape is dictated by the seam — see lib/flatten/bandDevelop.ts.
   */
  seamTrueFlatten?: boolean;
  /**
   * Per-design gather correction (linear). Default 1.18 (proven
   * 32-panel calibration); single-seam designs take up far less —
   * the Spiral is calibrated at 1.02 from a stitched prototype.
   */
  gatherCorrection?: number;
  /**
   * Anchor stitch holes exactly on sharp bends inside seam runs (the
   * Orbita star's outer tips and inner notches). Opt-in per preset:
   * other wavy balls (trionda, Teamgeist) also carry bends above any
   * geometric threshold, but their proven hole conventions are plain
   * corner-to-corner spacing.
   */
  laserSharpBendAnchors?: boolean;
  /**
   * Place a stitch hole exactly at every polygon corner and space the
   * remaining holes evenly between corners. For designs where every
   * vertex is a junction of few panels (tetrahedron: 3 panels per
   * vertex) — a corner stitch is structural.
   */
  laserCornerHoles?: boolean;
  /**
   * Stitch holes set by count (the Holes-per-hex-edge slider) instead of
   * spacing — see LaserTemplateOptions.holeCount. `matchSide` names the
   * panels whose sides carry N − 2 holes, for the slider's label.
   */
  /**
   * `markEdgeLabel` names the side `markEdge` marks, for the Edge marker
   * switch's hint; required when `markEdge` is set.
   */
  laserHoleCount?: HoleCountConvention & { matchSide: string; markEdgeLabel?: string };
  topology: (radius?: number, params?: PresetParams) => PanelTopology;
  /**
   * Per-vertex warp applied to the subdivided mesh before sphere
   * projection (see generate.ts). Lets a preset hand over convex panels,
   * which mesh fast, and curve the seams afterwards. Must be a fold-free
   * map of the sphere, or the warped mesh would overlap itself.
   */
  warp?: (params: PresetParams) => ((v: Vector3) => void) | undefined;
  /**
   * Laser settings the baked template ships with, over the global
   * defaults (e.g. the soccer ball's 8 holes per hex edge).
   */
  laserDefaults?: Partial<LaserSettings>;
  /** Template colors for panels the design hasn't painted. */
  defaultColors?: (topo: PanelTopology, params: PresetParams) => PanelColors;
  /**
   * Params whose change re-applies the template colors (e.g. a time that
   * drives the colors), discarding painted colors.
   */
  recolorParams?: string[];
  /**
   * The preset animates: Play advances `timeParam`, wrapping at `period`
   * when given (see the designer's Shape panel).
   */
  animation?: { timeParam: string; period?: number };
}

/**
 * Merge a preset's declared defaults with saved values (e.g. read from a GLB's
 * extras), clamping to each def's [min, max] so hand-edited GLBs can't produce
 * out-of-range geometry. Unknown keys in `saved` are dropped.
 */
export function resolvePresetParams(
  entry: PresetEntry,
  saved?: PresetParams,
): PresetParams {
  const resolved: PresetParams = {};
  for (const def of entry.params ?? []) {
    const value = saved?.[def.key];
    resolved[def.key] =
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(def.max, Math.max(def.min, value))
        : def.defaultValue;
  }
  return resolved;
}

/** Look up a preset by id; undefined for custom/unknown designs. */
export function presetById(id: string): PresetEntry | undefined {
  return PRESETS.find((p) => p.id === id);
}

// The Goldberg balls (GP 3,0 and GP 4,0) share one short-edge control: the
// short hex-hex edges (spokes + opposite) are relaxed to one length, a
// percent of the natural uniform length (100% = default). Validated valid
// — no inverted or degenerate panels — across the whole 0–140% range;
// toward 0% the short edges shrink to near-zero (huge pentagons) but the
// free edges keep every panel non-degenerate.
const SHORT_EDGE_PARAM: PresetParamDef = {
  key: "shortEdge",
  label: "Short edge",
  min: 0,
  max: 140,
  step: 5,
  defaultValue: 100,
  unit: "%",
};

// Circle radius as a percent of the default: 100% = Circle Soccer's
// circles through the soccer ball's pentagon corners (Circle Soccer 6 keeps
// the same radius-to-nearest-neighbour ratio). Capped at 150% — neighbouring
// circles touch (seams between fillers vanish) at ~158%.
const CIRCLE_SIZE_PARAM: PresetParamDef = {
  key: "circleSize",
  label: "Circle size",
  min: 50,
  max: 150,
  step: 5,
  defaultValue: 100,
  unit: "%",
};

// Circle soccers: every non-circle panel is a filler.
const CIRCLE_HOLE_COUNT = {
  isFiller: (_topo: PanelTopology, id: string) => !id.endsWith("_circle"),
  matchSide: "circle side",
};

// GP(3,0): the fillers are the hexagons ringing each pentagon (Hexagon A:
// three long sides, three short); pentagons and the inner hexagons are
// surrounded by them.
// Soccer follows the 92-panel bag: every hexagon touches pentagons, so
// hexes are the fillers — N holes per pentagon side (corner-extension
// tips included), N − 2 on the pentagon's side, hex-hex seams unstitched.
const SOCCER_HOLE_COUNT = {
  isFiller: (_topo: PanelTopology, id: string) => id.endsWith("_hexagon"),
  matchSide: "pentagon side",
};
const GP3_HOLE_COUNT = {
  isFiller: (topo: PanelTopology, id: string) =>
    id.endsWith("_hexagon") &&
    topo.edges.some(
      (e) =>
        (e.panelA === id && e.panelB?.endsWith("_pentagon")) ||
        (e.panelB === id && e.panelA.endsWith("_pentagon")),
    ),
  matchSide: "pentagon & inner-hex side",
  // The small hex's pentagon side is ~1mm shorter than its big-hex sides
  // and hard to tell apart by eye: mark it.
  markEdge: (_topo: PanelTopology, id: string, neighborId: string) =>
    id.endsWith("_hexagon") && neighborId.endsWith("_pentagon"),
  markEdgeLabel: "the small hex's shorter pentagon side",
};

export const PRESETS: PresetEntry[] = [
  {
    id: "baseball",
    label: "Baseball",
    panels: 2,
    params: [
      {
        // Percent of the way from the equator to the poles: 0% = straight
        // equator seam (two hemispheres), 50% = classic baseball (π/4).
        // Capped at 60%: above that the narrowing panel waists distort the
        // rendered ball (and near the poles the fan subdivision degrades).
        key: "seamAmplitude",
        label: "Seam amplitude",
        min: 0,
        max: 60,
        step: 1,
        defaultValue: 50,
        unit: "%",
      },
    ],
    topology: (radius?: number, params?: PresetParams) =>
      baseball(radius, ((params?.seamAmplitude ?? 50) / 100) * (Math.PI / 2)),
  },
  {
    id: "spiral",
    label: "Spiral",
    panels: 2,
    devOnly: true,
    seamTrueFlatten: true,
    // Calibrated from stitched prototypes: at 1.07 a normal-gather bag
    // measured 1.85in around the equator against a 1.9in target
    // (seam-driven, -2.6%); 1.11 aims the equator at ~1.9-1.95. (The
    // seam-density model's 1.055-1.067 prediction ran slightly lean —
    // physical measurements win.)
    gatherCorrection: 1.11,
    params: [
      {
        // Full turns the seam makes from pole to pole, as a percent of
        // one turn. 0% = two hemispheres split by a meridian.
        key: "twist",
        label: "Twist",
        min: 0,
        max: 250,
        step: 5,
        defaultValue: 100,
        unit: "%",
      },
    ],
    topology: (radius?: number, params?: PresetParams) =>
      spiral(radius, (params?.twist ?? 100) / 100),
  },
  { id: "trionda", label: "Trionda 2026", panels: 4, topology: trionda },
  { id: "tetra", label: "Tetrahedron", panels: 4, laserCornerHoles: true, topology: tetrahedron },
  { id: "cube", label: "Cube", panels: 6, topology: cube },
  {
    id: "bagzuca",
    label: "Bagzuca",
    panels: 6,
    params: [
      {
        // How far each seam swings into its neighbours: 100% = the
        // photographed ball, 0% = straight seams (a plain spherical cube).
        key: "swirl",
        label: "Swirl",
        min: 0,
        max: 130,
        step: 5,
        defaultValue: 100,
        unit: "%",
      },
    ],
    topology: (radius?: number, params?: PresetParams) =>
      bagzuca(radius, (BAGZUCA_SWIRL * (params?.swirl ?? 100)) / 100),
  },
  { id: "octa", label: "Octahedron", panels: 8, laserCornerHoles: true, topology: octahedron },
  { id: "dodeca", label: "Dodecahedron", panels: 12, topology: dodecahedron },
  { id: "rhombic12", label: "12-Panel Rhombus", panels: 12, topology: rhombicDodecahedron },
  {
    id: "orbita",
    label: "Orbita 2022",
    panels: 12,
    laserSharpBendAnchors: true,
    params: [
      {
        // Wave amplitude of every seam: 100% = the imported star arms,
        // 0% = straight seams (a plain spherical dodecahedron).
        key: "spokeLength",
        label: "Spoke length",
        min: 0,
        max: 130,
        step: 5,
        defaultValue: 100,
        unit: "%",
      },
    ],
    topology: (radius?: number, params?: PresetParams) =>
      scaleSeamAmplitude(orbita(radius), (params?.spokeLength ?? 100) / 100),
  },
  {
    id: "teamgeist",
    label: "Teamgeist 2006",
    panels: 14,
    params: [
      {
        // Percent size of the six oval panels relative to the real 2006
        // ball. Ovals never touch each other, so each scales exactly
        // uniformly about its center — proportions preserved — and the
        // eight t-bone panels reflow to fill the remaining sphere.
        key: "ovalSize",
        label: "Oval size",
        min: 60,
        max: 125,
        step: 5,
        defaultValue: 100,
        unit: "%",
      },
      {
        // Length of the ovals along their own axis: 100% = the real
        // 2006 outline, 0% = the two lobes slid together until length
        // equals width. The cross profile (waist indent) is preserved.
        key: "elongation",
        label: "Elongation",
        min: 0,
        max: 100,
        step: 5,
        defaultValue: 100,
        unit: "%",
      },
    ],
    topology: (radius?: number, params?: PresetParams) =>
      morphFeaturePanels(teamgeist(radius), {
        scale: (params?.ovalSize ?? 100) / 100,
        elongation: (params?.elongation ?? 100) / 100,
      }),
  },
  {
    id: "cubocta",
    label: "Cuboctahedron",
    panels: 14,
    params: [
      {
        // Percent of the hexagons' long edge: 0% = cuboctahedron (triangles),
        // 100% = regular truncated octahedron (all edges equal).
        key: "shortEdge",
        label: "Short edge",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 0,
        unit: "%",
      },
    ],
    topology: (radius?: number, params?: PresetParams) =>
      truncatedOctahedronFamily(radius, (params?.shortEdge ?? 0) / 100),
  },
  { id: "icosa", label: "Icosahedron", panels: 20, topology: icosahedron },
  {
    id: "rhombicubocta",
    label: "26-Panel",
    panels: 26,
    params: [
      {
        // The 6 axis squares' side over the 12 others' (100% = all equal).
        key: "bigSquares",
        label: "Big squares",
        min: 100,
        max: 180,
        step: 5,
        defaultValue: 100,
        unit: "%",
      },
      {
        // The corner panels' short side over their long side: 0% = triangles
        // and squares, growing into hexagons and octagons. Shown, and
        // stepped, in mm; the default, 23.84%, is 4.00mm at 1.8in (with Big
        // squares at 100%).
        key: "shortEdge",
        label: "Short edge",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 23.84,
        unit: "%",
        lengthAngle: rhombicuboctahedronShortAngle,
      },
    ],
    topology: (radius?: number, params?: PresetParams) =>
      rhombicuboctahedron(radius, (params?.bigSquares ?? 100) / 100, (params?.shortEdge ?? 0) / 100),
  },
  {
    id: "soccer",
    label: "Soccer Ball",
    panels: 32,
    laserHoleCount: SOCCER_HOLE_COUNT,
    laserDefaults: { hexEdgeHoles: 8 },
    params: [
      {
        // Percent of the hexagons' long edge: 100% = classic soccer ball
        // (truncated icosahedron, all edges equal), 0% = icosidodecahedron
        // (hexagons collapse to triangles). Shown, and stepped, as the
        // hex-hex side's length in mm (corner stitch to corner stitch, as
        // the template labels it). The default, 40.102%, is 4.00mm at the
        // template's 1.8in with 8 holes per hex edge.
        key: "shortEdge",
        label: "Short edge",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 40.102,
        unit: "%",
        lengthAngle: soccerShortEdgeAngle,
      },
    ],
    topology: (radius?: number, params?: PresetParams) =>
      truncatedIcosahedronFamily(radius, (params?.shortEdge ?? 100) / 100),
  },
  {
    id: "circle-soccer",
    label: "Circle Soccer",
    panels: 32,
    // Holes by count: N per circle-facing hex side (default 8), N − 2 per
    // circle side (6, so 30 per circle); hex-hex seams unstitched.
    laserHoleCount: CIRCLE_HOLE_COUNT,
    params: [CIRCLE_SIZE_PARAM],
    topology: (radius?: number, params?: PresetParams) =>
      circleSoccer(radius, (params?.circleSize ?? 100) / 100),
  },
  {
    id: "circle-soccer-6",
    label: "Circle Soccer 6",
    panels: 122,
    laserHoleCount: CIRCLE_HOLE_COUNT,
    params: [CIRCLE_SIZE_PARAM],
    topology: (radius?: number, params?: PresetParams) =>
      circleSoccer6(radius, (params?.circleSize ?? 100) / 100),
  },
  {
    id: "circle-soccer-concave",
    label: "Concave Circle Soccer",
    panels: 32,
    laserHoleCount: CIRCLE_HOLE_COUNT,
    params: [CIRCLE_SIZE_PARAM],
    topology: (radius?: number, params?: PresetParams) =>
      concaveCircleSoccer(radius, (params?.circleSize ?? 100) / 100),
  },
  {
    id: "circle-soccer-concave-6",
    label: "Concave Circle Soccer 6",
    panels: 122,
    laserHoleCount: CIRCLE_HOLE_COUNT,
    params: [CIRCLE_SIZE_PARAM],
    topology: (radius?: number, params?: PresetParams) =>
      concaveCircleSoccer6(radius, (params?.circleSize ?? 100) / 100),
  },
  {
    id: "kaleidoscope",
    label: "Kaleidoscope",
    panels: 72,
    devOnly: true,
    params: [
      { key: "flow", label: "Flow", min: 0, max: 100, step: 1, defaultValue: 70, unit: "%" },
      {
        // Runs forever: the design never repeats (see lib/kaleidoscope).
        key: "time",
        label: "Time",
        min: 0,
        max: 1e9,
        step: 0.1,
        defaultValue: 0,
        hidden: true,
      },
    ],
    animation: { timeParam: "time" },
    // Colors drift with time (see lib/kaleidoscope/color.ts).
    recolorParams: ["time"],
    topology: kaleidoscopeTopology,
    warp: kaleidoscopeWarp,
    defaultColors: kaleidoscopeColors,
  },
  { id: "gp2", label: "GP(2,0)", panels: 42, topology: (r?: number) => goldbergClassI(2, r) },
  {
    id: "gp3",
    label: "GP(3,0)",
    panels: 92,
    // Shown as the short side's seam length in mm at the current size.
    params: [{ ...SHORT_EDGE_PARAM, step: 1, lengthAngle: gp3ShortEdgeAngle }],
    laserHoleCount: GP3_HOLE_COUNT,
    topology: (radius?: number, params?: PresetParams) =>
      goldbergClassI(3, radius, params?.shortEdge ?? 100),
  },
  {
    id: "gp4",
    label: "GP(4,0)",
    panels: 162,
    params: [SHORT_EDGE_PARAM],
    topology: (radius?: number, params?: PresetParams) =>
      goldbergClassI(4, radius, params?.shortEdge ?? 100),
  },
];
