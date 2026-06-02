# Importing soccer ball GLBs as Paneler templates

This guide explains how to take any reasonably-spherical paneled-ball GLB and turn it into a Paneler template.

---

## Quick start

```bash
# 1. Run the importer (writes data + wrapper + preview)
npx tsx --tsconfig tsconfig.scripts.json \
  scripts/import-ball-topology.ts \
  ~/Downloads/some-ball.glb my-ball-slug \
  --label "My Ball 2026"

# 2. Eyeball the preview — green should trace gray
open lib/topology/my-ball-slug-preview.svg

# 3. Add a row to PRESETS in lib/topology/presets.ts
#    (the importer prints the exact snippet to paste)

# 4. Re-bake all template GLBs
npm run bake:glb
```

That's it. The importer prints a verification report and the exact snippet to add to `lib/topology/presets.ts`. If any check fails, the file is still written but the process exits with code 2 — don't paste into `presets.ts` until all checks pass.

---

## What the importer produces

For slug `<slug>`:

| File | Purpose |
|------|---------|
| `lib/topology/<slug>-data.ts` | Generated vertex + face arrays. Do not edit. |
| `lib/topology/<slug>.ts` | Wrapper exporting a `PanelTopology` function. Do not edit. |
| `lib/topology/<slug>-preview.svg` | Equirectangular overlay for visual sanity-check. |
| `lib/topology/<slug>-report.json` | Verification report as JSON for tooling. |

The importer never touches `lib/topology/presets.ts` — you add the registry row manually. This is the "manual finalize" step in case you want to rename the wrapper or tweak the label first.

---

## Sourcing GLBs

The importer works on any mesh that's approximately a sphere with visible panel boundaries. Three common forms:

1. **Single mesh with UV seams** (most common; Trionda, official FIFA models). The artist split UVs at each panel edge for texturing. The importer's `uv-seams` mode finds these.
2. **Single mesh with hard edges**. Older or hand-modeled balls. The artist authored sharp shading discontinuities at panel boundaries. The `hard-edges` mode finds these.
3. **Pre-split mesh**, one glTF primitive per panel. Some procedurally generated models look like this. The `primitives` mode handles them.

Auto-detect tries all three in order and uses the first that produces a valid graph.

**Copyright**: only import GLBs you have a license for, or your own work. Many vendor models are licensed for personal/educational use only — check the original source.

---

## Reading the SVG preview

The preview shows an equirectangular (Plate Carrée) projection of the unit sphere with two layers:

- **Gray thin lines**: every seam edge the detector found in the source mesh.
- **Green thicker lines**: the boundary curves of the extracted panels (after downsampling).
- **Orange dots**: junctions (panel corners).
- **Green labels**: panel index at each panel's centroid.

**Aligned**: green traces gray cleanly, junctions sit at corner intersections, panels labeled. Extraction is correct.

**Common misalignments**:

| Symptom | Likely cause | Fix |
|---|---|---|
| Green much sparser than gray | RDP tolerance too high | Lower `--rdp-tolerance` (e.g. 0.2°) |
| Green has visible polygon corners where gray is smooth | RDP tolerance too low | Raise `--rdp-tolerance` (e.g. 1.0°) |
| Whole sections of gray missing from green | Wrong mode chosen | Try `--mode hard-edges` or `--mode uv-seams` explicitly |
| Junctions in unexpected places | Auto-detect picked weird degree-≥3 verts | Use `--override-junctions` |
| Panels overlap themselves or skip regions | Junction graph isn't planar (rare) | Likely an input bug; inspect the mesh in Blender |

---

## Which mode to use

| You see | Try |
|---|---|
| Auto says `Using mode=primitives` and works | done |
| Auto says `Using mode=uv-seams` and works | done |
| `No usable seam graph` error | `--mode hard-edges --hard-edge-threshold 15` |
| Hard-edges finds too many edges (jagged green) | Raise `--hard-edge-threshold` (45, 60) |
| Hard-edges finds too few edges (huge panels) | Lower `--hard-edge-threshold` (15, 10) |
| Sphericity check fails | The mesh isn't a sphere. Likely an American football or non-ball object. |

---

## Tuning `--rdp-tolerance`

Default `0.5` degrees is calibrated to roughly match Goldberg GP(2,0) hexagon density (the densest Paneler shape that still renders smoothly without fan-pole artifacts).

- **Raise** (1.0°, 2.0°) if extracted panels are still dense enough to cause visible "spoke" artifacts radiating from panel centers in the rendered ball. Each curve will have fewer samples → fewer fan triangles per panel → fewer rays of normal interpolation discontinuity at the centroid.
- **Lower** (0.2°, 0.1°) if curves look obviously polygonal in the preview (visible corners where the source is smooth). Each curve will have more samples → smoother curves at the cost of more fan triangles.

---

## Override flow

When auto-detection misidentifies junctions (rare, but happens with very ornate panel designs):

1. Open the source GLB in [Blender](https://www.blender.org) or any other 3D viewer.
2. Locate the actual panel corner positions (the points where 3+ panels meet).
3. Note the (x, y, z) coordinates of each corner.
4. Save as JSON, e.g. `~/Downloads/my-junctions.json`:
   ```json
   [
     [0.101, -0.003, -0.045],
     [0.006, 0.050, 0.099],
     [-0.039, -0.103, 0.014],
     [-0.069, 0.057, -0.066]
   ]
   ```
   Coordinates are in the source mesh's units — same units you see in the viewer. The importer will snap each one to the nearest welded vertex after preprocessing.
5. Re-run with the override flag:
   ```bash
   npx tsx --tsconfig tsconfig.scripts.json \
     scripts/import-ball-topology.ts \
     ~/Downloads/some-ball.glb my-ball-slug \
     --override-junctions ~/Downloads/my-junctions.json
   ```

This is much more reliable than hand-editing the generated `-data.ts` file, which uses post-welding indices that change every time you tweak `--weld-epsilon`.

---

## Reading the verification report

The report has three layers of checks:

### Source mesh stats
Verts, tris, primitives, UV/normal presence. Useful for sanity-checking that the importer loaded what you expect.

### Preprocessing
- `original center` — where the source mesh was sitting before we translated it to origin. Tells you the source's coordinate system.
- `best-fit radius` — the source's median vertex distance from its bounding-box center. The importer scales by `1 / best-fit-radius` so the result lives on a unit sphere.
- `scaled radius distribution` — distribution of vertex distances post-scale. For a ball, p5 should be ≥0.92 and p95 ≤1.08.
- **`Sphericity` check** — true iff p5 ≥ 0.92 and p95 ≤ 1.08. If false, the source isn't a ball.

### Extraction
- `seam edges`, `seam verts`, `junctions` — counts from the seam graph. Higher junction count = more complex topology (4 for tetrahedral, 12 for soccer ball, etc.).
- `junction degree histogram` — distribution of (number of curves meeting at each junction). Tetrahedral = all degree 3. Goldberg = all degree 3.
- `curve samples pre/post-RDP` — how aggressive the downsampling was. Aim for post-RDP in the 10–30 range; that's the Goldberg sweet spot.

### Output topology
- `panel count` — should match the expected count for the ball design (4 for tetrahedral, 32 for soccer, etc.).
- `solid angle total = 4π` — the panels cover the whole sphere with no gaps or overlaps. Closure error <1% is good.
- `Euler χ = 2` — sphere topology check. If not 2, the panel graph is broken (gaps, overlaps, missing faces).

### Pass/fail
All 7 must pass before you bake. If any fail, see the troubleshooting section above.

---

## Adding to `lib/topology/presets.ts`

The importer prints the exact snippet. As an example, for slug `my-ball`:

```typescript
// Top of file, with the other topology imports:
import { myBall } from "./my-ball";

// In the PRESETS array, in your preferred order:
{ id: "my-ball", label: "My Ball 2026", panels: 4, topology: myBall },
```

`panels` is the count from the importer's report. Convention: order PRESETS by panel count ascending.

---

## Re-baking

```bash
npm run bake:glb
```

This re-bakes all templates (including yours) with the adaptive subdivision pipeline. Your new template's GLB lands at `public/presets/<slug>.glb` and gets indexed in `public/presets/index.json` for the design gallery.

---

## Limitations

- **Must be roughly spherical**. American footballs, rugby balls, and other non-spheres won't pass the sphericity check.
- **Must have visible panel boundaries**. A perfectly smooth, untextured sphere has no seams to detect.
- **One ball per GLB**. If the GLB has multiple balls or a ball plus other geometry, the component filter picks the largest sphere-fitting component.
- **Topology must be sphere-embeddable**. The planar-dual algorithm assumes Euler characteristic 2. Non-orientable or higher-genus weirdness (Möbius-strip-style panel layouts) won't extract correctly.

For meshes outside these constraints, you'd need to write the topology by hand — see `lib/topology/baseball.ts` for a procedural example.
