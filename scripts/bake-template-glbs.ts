/**
 * Build-time script: emit one .glb per template into public/presets/, plus an
 * index.json manifest. Templates are baked at the same subdivision level and
 * sphere radius the runtime would have generated, so loading a template glb
 * looks identical to picking the preset under the old code path.
 *
 * Run: `npm run bake:glb`
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";

import { PRESETS } from "@/lib/topology/presets";
import { subdivideTopology } from "@/lib/mesh/subdivide";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { buildGlbDocument } from "@/lib/glb/build";
import type { PanelShape } from "@/lib/types";

const SPHERE_RADIUS = 2;
const SUBDIVISION_LEVELS = 6;

interface ManifestEntry {
  slug: string;
  label: string;
  glbPath: string;
  panelCount: number;
  shapeSignature: string;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "public", "presets");
  await mkdir(outDir, { recursive: true });

  const io = new NodeIO();
  const manifest: ManifestEntry[] = [];

  for (const preset of PRESETS) {
    const raw = preset.topology(1);
    const subdivided = subdivideTopology(raw, SUBDIVISION_LEVELS);
    projectToSphere(subdivided, SPHERE_RADIUS);

    const doc = buildGlbDocument(subdivided, { assetName: preset.id });
    const bytes = await io.writeBinary(doc);

    const filename = `${preset.id}.glb`;
    await writeFile(join(outDir, filename), bytes);

    manifest.push({
      slug: preset.id,
      label: preset.label,
      glbPath: `/presets/${filename}`,
      panelCount: subdivided.panels.length,
      shapeSignature: shapeSignature(subdivided.panels),
    });

    console.log(`baked ${preset.id} (${subdivided.panels.length} panels, ${bytes.byteLength} bytes)`);
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
