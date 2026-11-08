import type { Matrix3, Vector3 } from "three";
import type { PanelColors, PanelTopology } from "@/lib/types";
import { getPanelShape } from "@/lib/designState";
import { icosahedralGroup } from "./groups";
import { FAMILIES, frameAt, frameTopology } from "./layout";
import { cachedWarp, kaleidoscopeField } from "./field";

/**
 * Kaleidoscope preset glue: maps the preset's sliders (see presets.ts)
 * onto the layout, the warp and the palette.
 *
 * Geometry is built in two stages so meshing stays fast: the panels are
 * convex power-diagram cells (fan-triangulated in milliseconds), and the
 * swirl is applied afterwards to every mesh vertex by `kaleidoscopeWarp`
 * (see generate.ts). The warp is a fold-free flow, so warping a valid mesh
 * gives a valid mesh with curved seams.
 */
type Params = Record<string, number>;

export function kaleidoscopeTopology(radius = 1, params: Params = {}): PanelTopology {
  return frameTopology(frameAt(params.time ?? 0), radius);
}

/** Per-vertex warp for the mesh, or undefined at zero Flow. */
export function kaleidoscopeWarp(params: Params = {}): ((v: Vector3) => void) | undefined {
  const flow = (params.flow ?? 0) / 100;
  if (flow === 0) return undefined;
  return cachedWarp(icosahedralGroup(), kaleidoscopeField(flow, params.time ?? 0));
}

/**
 * Curated palettes of real fabrics (Ultrasuede LX): three body colors and
 * a highlight.
 */
export const PALETTES: { name: string; body: [string, string, string]; highlight: string }[] = [
  { name: "Lagoon", body: ["#184a71", "#3b8798", "#7d99b9"], highlight: "#f5ddc0" },
  { name: "Ember", body: ["#632335", "#c8622c", "#a7295e"], highlight: "#f5ddc0" },
  { name: "Meadow", body: ["#34432e", "#c8ba56", "#3b8798"], highlight: "#eeedea" },
  { name: "Royal", body: ["#4a1439", "#184a71", "#a7295e"], highlight: "#c8ba56" },
  { name: "Desert", body: ["#7a4928", "#ceaf80", "#c8622c"], highlight: "#3b8798" },
  { name: "Midnight", body: ["#0d141e", "#184a71", "#7d99b9"], highlight: "#ffffff" },
  { name: "Carnival", body: ["#b10607", "#184a71", "#c8ba56"], highlight: "#ffffff" },
];

let cosets: number[] | null = null;

/**
 * Which of the 5 cosets of the tetrahedral subgroup T each group element
 * falls in: member e of a 60-panel family belongs to color set
 * cosets[e], and each set of 12 is tetrahedrally symmetric (the
 * five-tetrahedra compound).
 */
function cosetOfElement(): number[] {
  if (cosets) return cosets;
  const { elements, colorSubgroup } = icosahedralGroup();
  const same = (a: Matrix3, b: Matrix3) => a.elements.every((x, k) => Math.abs(x - b.elements[k]) < 1e-6);
  const out = elements.map(() => -1);
  let next = 0;
  elements.forEach((g, e) => {
    if (out[e] >= 0) return;
    for (const k of colorSubgroup) {
      const kg = k.clone().multiply(g);
      out[elements.findIndex((m) => same(m, kg))] = next;
    }
    next++;
  });
  cosets = out;
  return out;
}

/**
 * Template colors by visual hierarchy, fixed per panel id so a panel
 * keeps its color for as long as it lives (and gets it back when its
 * family returns):
 *
 *  - the 12 five-fold panels (focal points, like a soccer ball's
 *    pentagons) take the highlight;
 *  - the 20 three-fold and 30 two-fold families each take a body color;
 *  - each 60-panel swirl family splits into its 5 tetrahedral color sets
 *    across the body colors, rotated per family, so swirls read in three
 *    interleaved colors rather than as one blob.
 */
export function kaleidoscopeColors(topo: PanelTopology, params: Params = {}): PanelColors {
  const palette = PALETTES[Math.max(0, Math.round(params.palette ?? 0)) % PALETTES.length];
  const coset = cosetOfElement();
  const colors: PanelColors = {};
  for (const p of topo.panels) {
    const tag = getPanelShape(p.id);
    const index = Number(p.id.split("_")[1]) - 1;
    const f = FAMILIES.findIndex((fam) => fam.tag === tag);
    if (f === 0) colors[p.id] = palette.highlight;
    else if (f === 1 || f === 2) colors[p.id] = palette.body[f - 1];
    else colors[p.id] = palette.body[(coset[index - FAMILIES[f].offset] + f) % 3];
  }
  return colors;
}
