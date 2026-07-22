/**
 * Build-time script: emit one .glb per template into public/presets/, plus an
 * index.json manifest. Templates are baked through the same pipeline the
 * runtime Shape sliders use (lib/glb/generate.ts), so loading a template glb
 * is identical to generating the preset at its default param values — and the
 * baked asset extras carry those defaults, making them editable by re-baking
 * (or hand-editing) the GLB.
 *
 * Run: `npm run bake:glb`
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";

import { PRESETS, type PresetParamDef } from "@/lib/topology/presets";
import { generateTemplateDocument } from "@/lib/glb/generate";
import { parseDocument } from "@/lib/topology/gltf";
import type { PanelShape } from "@/lib/types";

interface ManifestEntry {
  slug: string;
  label: string;
  glbPath: string;
  panelCount: number;
  shapeSignature: string;
  /** Shape param definitions, for gallery display; values live in the GLB. */
  params?: PresetParamDef[];
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "public", "presets");
  await mkdir(outDir, { recursive: true });

  const io = new NodeIO();
  const manifest: ManifestEntry[] = [];

  for (const preset of PRESETS) {
    const doc = generateTemplateDocument(preset.id);
    const bytes = await io.writeBinary(doc);
    const panels = parseDocument(doc).topology.panels;

    const filename = `${preset.id}.glb`;
    await writeFile(join(outDir, filename), bytes);

    manifest.push({
      slug: preset.id,
      label: preset.label,
      glbPath: `/presets/${filename}`,
      panelCount: panels.length,
      shapeSignature: shapeSignature(panels),
      ...(preset.params?.length ? { params: preset.params } : {}),
    });

    console.log(`baked ${preset.id} (${panels.length} panels, ${bytes.byteLength} bytes)`);
  }

  await writeFile(
    join(outDir, "index.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`wrote ${manifest.length} templates + index.json to public/presets/`);
}

function shapeSignature(panels: ReadonlyArray<{ shape: PanelShape }>): string {
  const counts = new Map<PanelShape, number>();
  for (const p of panels) counts.set(p.shape, (counts.get(p.shape) ?? 0) + 1);
  const order: PanelShape[] = ["triangle", "quad", "pentagon", "hexagon", "polygon"];
  const initial: Record<PanelShape, string> = {
    triangle: "t",
    quad: "q",
    pentagon: "p",
    hexagon: "h",
    polygon: "g",
  };
  return order
    .filter((s) => counts.has(s))
    .map((s) => `${counts.get(s)}${initial[s]}`)
    .join("+");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
