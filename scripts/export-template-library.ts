/**
 * Export the public preset designs as a static template library for the
 * landing site (paneler-business /templates page): per preset × size,
 * one SVG per congruence class, plus a manifest the page renders from.
 *
 * The designer app is noindexed CSR — this gives the same gallery an
 * indexable, server-rendered address with free downloads.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/export-template-library.ts [outDir]
 *
 * Default outDir: ../paneler-business/public/templates (manifest goes to
 * ../paneler-business/src/data/template-library.json).
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { PRESETS } from "@/lib/topology/presets";
import { groupPanelsByCongruence } from "@/lib/laser/congruence";
import { buildLaserTemplate } from "@/lib/laser/template";
import { templateToSvg, templateFilename } from "@/lib/laser/svg";
import {
  DEFAULT_BITE_DEPTH_MM,
  HOLE_SPACING_MM,
} from "@/lib/laser/constants";
import type { LaserSettings } from "@/lib/laser/types";

const SIZES_IN = [1.6, 1.7, 1.8, 1.9, 2.0];

const outDir = resolve(process.argv[2] ?? "../paneler-business/public/templates");
const manifestPath = resolve(outDir, "../../src/data/template-library.json");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

interface ManifestEntry {
  id: string;
  label: string;
  panelCount: number;
  classes: { label: string; count: number; corners: number }[];
  /** size (in) → files for that size */
  files: Record<string, { classLabel: string; file: string; widthMm: number; heightMm: number }[]>;
  /** 1.8in first-class SVG used as the card preview */
  preview: string;
}

const manifest: ManifestEntry[] = [];

for (const preset of PRESETS) {
  if (preset.devOnly) continue;
  const topo = preset.topology(2);
  const classes = groupPanelsByCongruence(topo);
  const entry: ManifestEntry = {
    id: preset.id,
    label: preset.label,
    panelCount: preset.panels,
    classes: classes.map((c) => ({
      label: c.label,
      count: c.panelIds.length,
      corners: c.cornerCount,
    })),
    files: {},
    preview: "",
  };
  const options = {
    sharpBendAnchors: preset.laserSharpBendAnchors,
    seamTrueBands: preset.seamTrueFlatten,
    gatherCorrection: preset.gatherCorrection,
  };
  for (const size of SIZES_IN) {
    const settings: LaserSettings = {
      diameterIn: size,
      biteDepthMm: DEFAULT_BITE_DEPTH_MM,
      curvaturePct: 100,
      showHoles: true,
      holeSpacingMm: HOLE_SPACING_MM,
      cornerMarginMm: 0,
      shortEdgeHoles: preset.id === "teamgeist" || preset.id === "orbita",
      shortEdgeExtensionMm: 0,
    };
    const sizeKey = size.toFixed(1);
    const dir = join(outDir, preset.id, sizeKey);
    mkdirSync(dir, { recursive: true });
    entry.files[sizeKey] = [];
    for (const cls of classes) {
      const t = buildLaserTemplate(topo, cls, settings, options);
      const file = templateFilename(preset.id, t, settings);
      writeFileSync(join(dir, file), templateToSvg(t));
      const rel = `/templates/${preset.id}/${sizeKey}/${file}`;
      entry.files[sizeKey].push({
        classLabel: cls.label,
        file: rel,
        widthMm: Math.round(t.bounds.width * 10) / 10,
        heightMm: Math.round(t.bounds.height * 10) / 10,
      });
      if (sizeKey === "1.8" && !entry.preview) entry.preview = rel;
    }
    console.log(`${preset.id} ${sizeKey}in: ${classes.length} template(s)`);
  }
  manifest.push(entry);
}

mkdirSync(resolve(manifestPath, ".."), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length} designs → ${outDir}\nmanifest → ${manifestPath}`);
