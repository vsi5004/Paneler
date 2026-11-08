import { Vector3 } from "three";
import { icosahedralGroup, type RotationGroup } from "./groups";
import { frameAt } from "./layout";

/**
 * Seam warp for Kaleidoscope designs: points flow along a smooth tangent
 * "wind" on the sphere for unit time.
 *
 * The wind is a vortex on every seam junction of the current frame (where
 * three panels meet), so the seams leaving it curl into a three-armed
 * spiral. Each vortex is sized to its local seams (half their mean
 * length), so newborn panels get small spirals and big panels big ones.
 *
 * A vortex centered at b turns a point x by e^{κ(x·b − 1)}·(x × b). Its
 * strength comes from a smooth function of position that is itself
 * icosahedrally symmetric — a wave of turning direction keyed to the
 * distance from the five- and three-fold axes, drifting over time — so
 * neighbouring zones counter-rotate and the pattern of twists travels
 * across the ball. Because the junction set and the strength function
 * are both symmetric, the field is rotation-equivariant (V(gx) = g·V(x))
 * and the warp keeps the layout's symmetry exactly. Following a smooth
 * field's flow (rather than displacing by it once) never folds space, so
 * warped seams never cross.
 */

/**
 * Peak turning (radians at a vortex center) at 100% Flow. A vortex's
 * strain rate peaks near 0.74× its turning rate, so this bounds seam
 * stretch to about e^{0.74·MAX_TURN} ≈ 4.4×: every 2° seam segment stays
 * under ~9°, and every mesh triangle stays well shaped.
 */
const MAX_TURN = 2;
/** Vortex width as a fraction of its junction's mean seam length. */
const WIDTH_FRACTION = 0.5;
/**
 * Vortices whose shortest seam is under this (radians) turn proportionally
 * less. A short seam means a small neighbouring panel — newborn, or about
 * to vanish — only a few 2° seam segments across; shearing it hard makes
 * its seam polyline cross itself, and the spiral would only be noise.
 * Newborn panels stay calm until they have grown.
 */
const FULL_TURN_SEAM = (4 * Math.PI) / 180;
/**
 * Each flow step may turn a point at most this many radians about a
 * vortex; coarser steps spiral outward and fold the warp.
 */
const STEP_TURN = 0.15;
const MIN_STEPS = 4;
const MAX_STEPS = 96;
/** Skip vortices whose weight at a point is below e^-9. */
const CUTOFF = -9;
/** Cycles per time unit of the turning wave and its swell. */
const WAVE_RATE = 1 / 25;
const SWELL_RATE = WAVE_RATE * ((1 + Math.sqrt(5)) / 2);

export interface WarpField {
  /** Flattened vortex centers (x,y,z), turning weights and sharpness κ. */
  centers: Float64Array;
  weights: Float64Array;
  kappas: Float64Array;
  /** Flow steps (see STEP_TURN). */
  steps: number;
}

/**
 * Icosahedrally symmetric scalar in [0, 1]: closeness to the nearest of a
 * set of axes (soft max), normalized over the sphere.
 */
function axisField(axes: Vector3[], sharpness: number): (x: Vector3) => number {
  const raw = (x: Vector3) => {
    let s = 0;
    for (const a of axes) s += Math.exp(sharpness * (x.dot(a) - 1));
    return s;
  };
  let lo = Infinity;
  let hi = -Infinity;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 2000; i++) {
    const z = 1 - (2 * (i + 0.5)) / 2000;
    const r = Math.sqrt(1 - z * z);
    const v = raw(new Vector3(r * Math.cos(golden * i), r * Math.sin(golden * i), z));
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return (x) => (raw(x) - lo) / (hi - lo);
}

let fields: { fivefold: (x: Vector3) => number; threefold: (x: Vector3) => number } | null = null;

function symmetricFields() {
  if (!fields) {
    const g = icosahedralGroup();
    fields = {
      fivefold: axisField(g.specialOrbits[0], 4),
      threefold: axisField(g.specialOrbits[1], 6),
    };
  }
  return fields;
}

/** The warp field at `time`, with `flow` (0–1) setting how far seams turn. */
export function kaleidoscopeField(flow: number, time: number): WarpField {
  const frame = frameAt(time);
  const { fivefold, threefold } = symmetricFields();
  const n = frame.junctions.length;
  const centers = new Float64Array(n * 3);
  const weights = new Float64Array(n);
  const kappas = new Float64Array(n);
  const wave = 2 * Math.PI * WAVE_RATE * time;
  const swell = 2 * Math.PI * SWELL_RATE * time;
  let peak = 0;
  frame.junctions.forEach((b, j) => {
    centers[3 * j] = b.x;
    centers[3 * j + 1] = b.y;
    centers[3 * j + 2] = b.z;
    const seams = frame.junctionNeighbors[j].map((k) => b.angleTo(frame.junctions[k]));
    const mean = seams.length ? seams.reduce((s, x) => s + x, 0) / seams.length : 0.2;
    const shortest = seams.length ? Math.min(...seams) : 0.2;
    const width = Math.max(1e-3, WIDTH_FRACTION * mean);
    kappas[j] = 1 / (width * width);
    const turn =
      Math.sin(wave + 2 * Math.PI * fivefold(b)) *
      (0.65 + 0.35 * Math.sin(swell + 2 * Math.PI * threefold(b)));
    const damp = Math.min(1, shortest / FULL_TURN_SEAM) ** 2;
    weights[j] = flow * MAX_TURN * turn * damp;
    peak = Math.max(peak, Math.abs(weights[j]));
  });
  // Overlapping vortices can add; 1.5× margin.
  const steps = Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.ceil((1.5 * peak) / STEP_TURN)));
  return { centers, weights, kappas, steps };
}

/** Field velocity at unit vector (x, y, z), written to `out`. */
function velocity(x: number, y: number, z: number, f: WarpField, out: Float64Array): void {
  const { centers, weights, kappas } = f;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (let i = 0; i < weights.length; i++) {
    const bx = centers[3 * i];
    const by = centers[3 * i + 1];
    const bz = centers[3 * i + 2];
    const e = kappas[i] * (x * bx + y * by + z * bz - 1);
    if (e < CUTOFF) continue;
    const g = weights[i] * Math.exp(e);
    vx += g * (y * bz - z * by);
    vy += g * (z * bx - x * bz);
    vz += g * (x * by - y * bx);
  }
  out[0] = vx;
  out[1] = vy;
  out[2] = vz;
}

/**
 * Flow the direction of `p` along the field (in place), keeping its
 * length — so mesh vertices offset by the puff bevel keep their offset.
 */
export function warpPoint(p: Vector3, f: WarpField): void {
  const len = p.length();
  if (len === 0) return;
  let x = p.x / len;
  let y = p.y / len;
  let z = p.z / len;
  const v = new Float64Array(3);
  const h = 1 / f.steps;
  for (let s = 0; s < f.steps; s++) {
    velocity(x, y, z, f, v);
    x += h * v[0];
    y += h * v[1];
    z += h * v[2];
    const l = Math.hypot(x, y, z);
    x /= l;
    y /= l;
    z /= l;
  }
  p.set(x * len, y * len, z * len);
}

/**
 * `warpPoint` with symmetry caching, for warping a whole mesh. The warp is
 * equivariant — W(g·x) = g·W(x) — so each point is rotated to a canonical
 * image (the one closest to a fixed generic direction), warped there once,
 * and rotated back. A symmetric mesh repeats every vertex once per group
 * element, so this computes the flow ~|G| times less often. Results are
 * exact either way: a cache miss (e.g. a canonical image that rounds to a
 * different key) only costs a recomputation.
 */
export function cachedWarp(group: RotationGroup, f: WarpField): (p: Vector3) => void {
  const ref = new Vector3(0.2357, 0.5871, 0.7741).normalize();
  const n = group.elements.length;
  // g·ref for each element: argmax_k (g_k·ref)·y picks the image g_kᵀ·y
  // closest to ref.
  const keys = group.elements.map((m) => ref.clone().applyMatrix3(m));
  const cache = new Map<string, Vector3>();
  const unit = new Vector3();
  const canon = new Vector3();
  return (p) => {
    const len = p.length();
    if (len === 0) return;
    unit.copy(p).divideScalar(len);
    let best = 0;
    let bestDot = -Infinity;
    for (let k = 0; k < n; k++) {
      const d = keys[k].dot(unit);
      if (d > bestDot) {
        bestDot = d;
        best = k;
      }
    }
    const e = group.elements[best].elements; // column-major
    // canon = g_bestᵀ · unit
    canon.set(
      e[0] * unit.x + e[1] * unit.y + e[2] * unit.z,
      e[3] * unit.x + e[4] * unit.y + e[5] * unit.z,
      e[6] * unit.x + e[7] * unit.y + e[8] * unit.z,
    );
    const key = `${canon.x.toFixed(9)},${canon.y.toFixed(9)},${canon.z.toFixed(9)}`;
    let w = cache.get(key);
    if (!w) {
      w = canon.clone();
      warpPoint(w, f);
      cache.set(key, w);
    }
    p.copy(w).applyMatrix3(group.elements[best]).multiplyScalar(len);
  };
}
