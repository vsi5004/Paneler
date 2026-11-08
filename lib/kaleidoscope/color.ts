import { drift } from "./random";

/**
 * Drifting color scheme for Kaleidoscope designs: every color is a smooth
 * function of time, so colors fade gradually as the design plays.
 *
 * Built in OKLCH (perceptual lightness, chroma, hue), where equal steps
 * look equal, so fades are even and the scheme keeps its contrast:
 *
 *  - a base hue rotates slowly and wanders;
 *  - three body colors sit around it, spread by a drifting harmony angle
 *    (close analogous colors ↔ triad-like spreads), on fixed dark / mid /
 *    light levels so panels stay readable whatever the hues;
 *  - the highlight (the 12 focal panels) is a pale tint of the
 *    complementary hue.
 *
 * The drifts use pairwise-irrational frequencies (see `drift`), so the
 * scheme never repeats.
 */
export interface Scheme {
  body: [string, string, string];
  highlight: string;
}

/** Hue turns per time unit. */
const HUE_RATE = 1 / 70;
const hueWander = drift(0x6a11, 1 / 40);
const spreadDrift = drift(0x6b22, 1 / 55);
const chromaDrift = drift(0x6c33, 1 / 35);

const BODY_LIGHTNESS = [0.4, 0.56, 0.72];
const HIGHLIGHT_LIGHTNESS = 0.9;

export function schemeAt(time: number): Scheme {
  const hue = 360 * (HUE_RATE * time + 0.12 * hueWander(time));
  // 25°–140° between neighbouring body hues.
  const spread = 82 + 58 * spreadDrift(time);
  const chroma = 0.12 + 0.035 * chromaDrift(time);
  const body = [0, 1, -1].map((k, i) =>
    oklchToHex(BODY_LIGHTNESS[i], chroma, hue + k * spread),
  ) as [string, string, string];
  return { body, highlight: oklchToHex(HIGHLIGHT_LIGHTNESS, 0.045, hue + 180) };
}

/**
 * OKLCH → sRGB hex (Björn Ottosson's OKLab matrices). Out-of-gamut colors
 * keep their lightness and hue and take the largest chroma that fits,
 * found by bisection — continuous in the inputs, so a drifting color
 * crossing the gamut edge doesn't jump.
 */
export function oklchToHex(l: number, c: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const at = (chroma: number) => oklabToLinearRgb(l, chroma * Math.cos(h), chroma * Math.sin(h));
  const fits = (rgb: number[]) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
  let chroma = c;
  if (!fits(at(c))) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(at(mid))) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  return `#${at(chroma)
    .map((v) => encode(Math.min(1, Math.max(0, v))))
    .join("")}`;
}

function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function encode(linear: number): string {
  const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(255 * v)
    .toString(16)
    .padStart(2, "0");
}
