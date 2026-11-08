import { Vector3 } from "three";

/** Small seeded PRNG (mulberry32) — deterministic structure per seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform random direction on the unit sphere. */
export function randomUnit(rand: () => number): Vector3 {
  const z = 2 * rand() - 1;
  const t = 2 * Math.PI * rand();
  const r = Math.sqrt(1 - z * z);
  return new Vector3(r * Math.cos(t), r * Math.sin(t), z);
}

// Frequency ratios with no common period: 1, φ, √2, √3 (pairwise
// irrational), so a sum of sines over them never repeats.
const RATIOS = [1, (1 + Math.sqrt(5)) / 2, Math.SQRT2, Math.sqrt(3)];

/**
 * A smooth signal in [-1, 1] that never repeats: a sum of sines at
 * pairwise-irrational frequencies, with phases from `seed`. `rate` sets
 * the base frequency in cycles per time unit.
 */
export function drift(seed: number, rate: number): (t: number) => number {
  const rand = mulberry32(seed);
  const phases = RATIOS.map(() => rand() * 2 * Math.PI);
  return (t) => {
    let s = 0;
    for (let k = 0; k < RATIOS.length; k++) {
      s += Math.sin(2 * Math.PI * rate * RATIOS[k] * t + phases[k]);
    }
    return s / RATIOS.length;
  };
}
