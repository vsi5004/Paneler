import type { Vec2 } from "@/lib/flatten/types";
import {
  CUT_COLOR,
  CUT_STROKE_MM,
  HOLE_COLOR,
  HOLE_STROKE_MM,
  STITCH_HOLE_DIAMETER_MM,
} from "./constants";
import type { LaserTemplate } from "./types";

/**
 * Sheet packing: fill a rectangular sheet with as many copies of one
 * template as fit, for laser cutting.
 *
 * Copies are packed by the convex outline (hull) of the cut line. For
 * convex panels that is the panel itself; concave panels pack as their
 * hull, which is always safe but leaves their inward curves unused.
 *
 * Two layout families are searched at every rotation: a single lattice
 * (rows of identical copies) and a double lattice (rows alternating with
 * copies turned 180°, which nest into each other — the densest packing
 * family for convex shapes). Spacing comes from no-fit polygons of the
 * outline grown by a clearance: `gap` between neighbours in a row (0 =
 * edges may touch) and `rowGap` between pieces in different rows, which
 * leaves channels that make cut pieces easy to lift off the sheet. Every
 * result is checked pairwise before it is returned.
 */

export interface PackOptions {
  sheetW: number;
  sheetH: number;
  /** Minimum distance between neighbours in the same row, mm (0 = may touch). */
  gap: number;
  /** Minimum distance between pieces in different rows, mm (at least `gap`). */
  rowGap: number;
  /** Minimum distance from any piece to the sheet edge, mm. */
  margin: number;
}

export interface Placement {
  x: number;
  y: number;
  /** Rotation of the template about its own origin, degrees. */
  deg: number;
}

export interface PackResult {
  placements: Placement[];
  /** Share of the sheet covered by the pieces' outlines (0–1). */
  coverage: number;
  /** Whether the outline was concave and packed by its hull. */
  packedByHull: boolean;
}

type Poly = Vec2[];

export function cutOutline(t: LaserTemplate): Poly {
  return [...t.cutPath.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

function hull(points: Poly): Poly {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Poly = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Poly = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function rotate(poly: Poly, deg: number): Poly {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return poly.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
}

function minkowski(a: Poly, b: Poly): Poly {
  const out: Poly = [];
  for (const p of a) for (const q of b) out.push({ x: p.x + q.x, y: p.y + q.y });
  return hull(out);
}

/** Circumscribed polygon of radius r, so growing by it covers the true offset. */
function disk(r: number, n = 32): Poly {
  if (r <= 0) return [{ x: 0, y: 0 }];
  const R = r / Math.cos(Math.PI / n);
  return Array.from({ length: n }, (_, k) => ({
    x: R * Math.cos((2 * Math.PI * k) / n),
    y: R * Math.sin((2 * Math.PI * k) / n),
  }));
}

/** Translations of `moving` that bring it within `gap` of `fixed` (both convex). */
function noFit(fixed: Poly, moving: Poly, gap: number): Poly {
  return minkowski(minkowski(fixed, disk(gap)), moving.map((p) => ({ x: -p.x, y: -p.y })));
}

/** Highest y where the vertical line at x crosses convex `poly` (undefined if it misses). */
function topAt(poly: Poly, x: number): number | undefined {
  let best: number | undefined;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) {
      const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
      best = best === undefined ? y : Math.max(best, y);
    }
  }
  return best;
}

function rightAt(poly: Poly, y: number): number {
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) {
      best = Math.max(best, a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y));
    }
  }
  return best;
}

/** Smallest height for the next row, shifted by `shift`, copies every dx. */
function rowGap(poly: Poly, dx: number, shift: number): number {
  let h = 0;
  for (let k = -4; k <= 4; k++) {
    const t = topAt(poly, shift + k * dx);
    if (t !== undefined) h = Math.max(h, t);
  }
  return h;
}

interface Layout {
  dx: number;
  /** Repeating rows: orientation of the NEXT row, its x shift and the row height. */
  rows: { kind: "A" | "B"; shift: number; height: number }[];
  A: Poly;
  B: Poly;
}

function layoutsAt(shape: Poly, gap: number, rowClearance: number, angle: number): Layout[] {
  const A = rotate(shape, angle);
  const B = rotate(shape, angle + 180);
  const dx = rightAt(noFit(A, A, gap), 0);
  const between = Math.max(gap, rowClearance);
  const nAA = noFit(A, A, between);
  const samples = Array.from({ length: 32 }, (_, i) => (dx * i) / 32);
  let single = { h: Infinity, s: 0 };
  for (const s of samples) {
    const h = rowGap(nAA, dx, s);
    if (h < single.h) single = { h, s };
  }
  const nAB = noFit(A, B, between);
  const nBA = noFit(B, A, between);
  let dbl = { total: Infinity, s1: 0, h1: 0, s2: 0, h2: 0 };
  for (const s1 of samples) {
    const h1 = rowGap(nAB, dx, s1);
    for (let j = 0; j < samples.length; j += 2) {
      const s2 = samples[j];
      // A rows two apart must also clear each other.
      const h2 = Math.max(rowGap(nBA, dx, s2), rowGap(nAA, dx, s1 + s2) - h1);
      if (h1 + h2 < dbl.total) dbl = { total: h1 + h2, s1, h1, s2, h2 };
    }
  }
  return [
    { dx, rows: [{ kind: "A", shift: single.s, height: single.h }], A, B },
    {
      dx,
      rows: [
        { kind: "B", shift: dbl.s1, height: dbl.h1 },
        { kind: "A", shift: dbl.s2, height: dbl.h2 },
      ],
      A,
      B,
    },
  ];
}

function bbox(poly: Poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function fill(lay: Layout, o: PackOptions, x0: number, y0: number) {
  const boxes = { A: bbox(lay.A), B: bbox(lay.B) };
  const placed: { kind: "A" | "B"; x: number; y: number; row: number }[] = [];
  let y = y0;
  let shift = x0;
  let kind: "A" | "B" = "A";
  for (let i = 0; i < 10000; i++) {
    const bx = boxes[kind];
    if (y + bx.maxY > o.sheetH - o.margin) break;
    if (y + bx.minY >= o.margin) {
      const lo = o.margin - bx.minX;
      let x = shift + Math.ceil((lo - shift) / lay.dx) * lay.dx;
      while (x + bx.maxX <= o.sheetW - o.margin) {
        placed.push({ kind, x, y, row: i });
        x += lay.dx;
      }
    }
    const next = lay.rows[i % lay.rows.length];
    y += next.height;
    shift += next.shift;
    kind = next.kind;
  }
  return placed;
}

/** Distance between convex polygons; negative if they overlap (touching = 0). */
function clearance(p: Poly, q: Poly): number {
  const separated = () => {
    for (const poly of [p, q]) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const nx = b.y - a.y;
        const ny = a.x - b.x;
        const tol = 1e-6 * Math.hypot(nx, ny);
        let pMin = Infinity, pMax = -Infinity, qMin = Infinity, qMax = -Infinity;
        for (const v of p) { const d = nx * v.x + ny * v.y; pMin = Math.min(pMin, d); pMax = Math.max(pMax, d); }
        for (const v of q) { const d = nx * v.x + ny * v.y; qMin = Math.min(qMin, d); qMax = Math.max(qMax, d); }
        if (pMax <= qMin + tol || qMax <= pMin + tol) return true;
      }
    }
    return false;
  };
  if (!separated()) return -1;
  let best = Infinity;
  for (const [P, Q] of [[p, q], [q, p]] as const) {
    for (const v of P) {
      for (let i = 0; i < Q.length; i++) {
        const a = Q[i];
        const b = Q[(i + 1) % Q.length];
        const vx = b.x - a.x, vy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((v.x - a.x) * vx + (v.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
        best = Math.min(best, Math.hypot(v.x - a.x - t * vx, v.y - a.y - t * vy));
      }
    }
  }
  return best;
}

function isConvex(poly: Poly): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function polyArea(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function packTemplate(t: LaserTemplate, o: PackOptions): PackResult {
  const outline = cutOutline(t);
  const shape = hull(outline);
  const search = (angles: number[]) => {
    let best: { placed: ReturnType<typeof fill>; lay: Layout; angle: number } | null = null;
    for (const angle of angles) {
      for (const lay of layoutsAt(shape, o.gap, o.rowGap, angle)) {
        const period = lay.rows.reduce((s, r) => s + r.height, 0);
        for (let ix = 0; ix < 8; ix++) {
          for (let iy = 0; iy < 8; iy++) {
            const placed = fill(lay, o, (lay.dx * ix) / 8, (period * iy) / 8);
            if (!best || placed.length > best.placed.length) best = { placed, lay, angle };
          }
        }
      }
    }
    return best!;
  };
  const coarse = search(Array.from({ length: 60 }, (_, i) => i * 3));
  const fine = search(Array.from({ length: 25 }, (_, i) => coarse.angle + (i - 12) / 4));
  const best = fine.placed.length >= coarse.placed.length ? fine : coarse;

  // Verify on the packed outlines (hulls): no overlaps, inside the margins.
  const polys = best.placed.map((p) =>
    (p.kind === "A" ? best.lay.A : best.lay.B).map((v) => ({ x: v.x + p.x, y: v.y + p.y })),
  );
  const boxes = polys.map(bbox);
  for (let i = 0; i < polys.length; i++) {
    const bi = boxes[i];
    if (
      bi.minX < o.margin - 1e-6 || bi.minY < o.margin - 1e-6 ||
      bi.maxX > o.sheetW - o.margin + 1e-6 || bi.maxY > o.sheetH - o.margin + 1e-6
    ) {
      throw new Error("packTemplate: a piece crossed the sheet margin");
    }
    for (let j = i + 1; j < polys.length; j++) {
      const bj = boxes[j];
      const need = best.placed[i].row === best.placed[j].row ? o.gap : Math.max(o.gap, o.rowGap);
      if (bi.maxX + need < bj.minX || bj.maxX + need < bi.minX || bi.maxY + need < bj.minY || bj.maxY + need < bi.minY) continue;
      if (clearance(polys[i], polys[j]) < need - 1e-3) {
        throw new Error("packTemplate: two pieces overlap");
      }
    }
  }
  return {
    placements: best.placed.map((p) => ({ x: p.x, y: p.y, deg: p.kind === "A" ? best.angle : best.angle + 180 })),
    coverage: (best.placed.length * polyArea(outline)) / (o.sheetW * o.sheetH),
    packedByHull: !isConvex(outline),
  };
}

/** A sheet SVG with every placed copy: same laser conventions as templateToSvg. */
export function sheetToSvg(
  t: LaserTemplate,
  r: PackResult,
  o: PackOptions,
  options: { showHoles?: boolean } = {},
): string {
  const holeR = STITCH_HOLE_DIAMETER_MM / 2;
  const holes =
    options.showHoles === false
      ? ""
      : [...t.holes, ...t.markerHoles]
          .map(
            (h) =>
              `      <circle cx="${h.x.toFixed(3)}" cy="${h.y.toFixed(3)}" r="${holeR}" fill="none" stroke="${HOLE_COLOR}" stroke-width="${HOLE_STROKE_MM}"/>`,
          )
          .join("\n");
  const pieces = r.placements.map(
    (p) =>
      `  <g transform="translate(${p.x.toFixed(3)} ${p.y.toFixed(3)}) rotate(${p.deg.toFixed(3)})">\n` +
      `    <path d="${t.cutPath}" fill="none" stroke="${CUT_COLOR}" stroke-width="${CUT_STROKE_MM}"/>\n` +
      (holes ? `    <g class="stitch-holes">\n${holes}\n    </g>\n` : "") +
      `  </g>`,
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${o.sheetW.toFixed(3)}mm" height="${o.sheetH.toFixed(3)}mm" viewBox="0 0 ${o.sheetW.toFixed(3)} ${o.sheetH.toFixed(3)}">`,
    ...pieces,
    `</svg>`,
    ``,
  ].join("\n");
}
