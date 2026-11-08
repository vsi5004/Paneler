import type { Matrix3, Vector3 } from "three";
import type { PanelColors, PanelTopology } from "@/lib/types";
import { getPanelShape } from "@/lib/designState";
import { icosahedralGroup } from "./groups";
import { FAMILIES, frameAt, frameTopology } from "./layout";
import { cachedWarp, kaleidoscopeField } from "./field";
import { schemeAt } from "./color";

/**
 * Kaleidoscope preset glue: maps the preset's sliders (see presets.ts)
 * onto the layout, the warp and the colors.
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
 * Colors at the design's time (see color.ts), by visual hierarchy. Each
 * panel's role is fixed by its id, so as the scheme drifts every panel
 * fades smoothly from one color to the next:
 *
 *  - the 12 five-fold panels (focal points, like a soccer ball's
 *    pentagons) take the highlight;
 *  - the 20 three-fold and 30 two-fold families each take a body color;
 *  - each 60-panel swirl family splits into its 5 tetrahedral color sets
 *    across the body colors, rotated per family, so swirls read in three
 *    interleaved colors rather than as one blob.
 */
export function kaleidoscopeColors(topo: PanelTopology, params: Params = {}): PanelColors {
  const scheme = schemeAt(params.time ?? 0);
  const coset = cosetOfElement();
  const colors: PanelColors = {};
  for (const p of topo.panels) {
    const tag = getPanelShape(p.id);
    const index = Number(p.id.split("_")[1]) - 1;
    const f = FAMILIES.findIndex((fam) => fam.tag === tag);
    if (f === 0) colors[p.id] = scheme.highlight;
    else if (f === 1 || f === 2) colors[p.id] = scheme.body[f - 1];
    else colors[p.id] = scheme.body[(coset[index - FAMILIES[f].offset] + f) % 3];
  }
  return colors;
}
