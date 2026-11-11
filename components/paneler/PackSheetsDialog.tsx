"use client";

import { useEffect, useMemo, useState } from "react";

import type { LaserSettings, LaserTemplate } from "@/lib/laser/types";
import { packTemplate, sheetToSvg, type PackOptions, type PackResult } from "@/lib/laser/pack";
import { templateFilename } from "@/lib/laser/svg";
import { downloadSvg } from "@/lib/laser/download";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const MM_PER_IN = 25.4;
/** Sheet slider range and step, inches. */
const MIN_IN = 2;
const MAX_IN = 24;
const STEP_IN = 0.25;
/** Clearance between rows when "Space between rows" is on, mm. */
const ROW_SPACE_MM = 1.5;
/** Distance from any piece to the sheet edge, mm. */
const EDGE_MARGIN_MM = 1;

interface PackSheetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: LaserTemplate[];
  laserSettings: LaserSettings;
  designName: string;
}

interface Packed {
  key: string;
  /** The templates this was packed from (a hole-count change makes new ones). */
  templates: LaserTemplate[];
  options: PackOptions;
  results: { t: LaserTemplate; r: PackResult }[];
}

/**
 * Laser sheets, one per panel type: set the sheet's width and height, see
 * each sheet packed (see lib/laser/pack.ts), download.
 */
export function PackSheetsDialog({
  open,
  onOpenChange,
  templates,
  laserSettings,
  designName,
}: PackSheetsDialogProps) {
  const [widthIn, setWidthIn] = useState(6);
  const [heightIn, setHeightIn] = useState(6);
  const [rowSpace, setRowSpace] = useState(true);
  const [packed, setPacked] = useState<Packed | null>(null);

  const sheetW = widthIn * MM_PER_IN;
  const sheetH = heightIn * MM_PER_IN;
  const sizeName = `${widthIn}x${heightIn}in`;
  const rowGap = rowSpace ? ROW_SPACE_MM : 0;
  const valid = sheetW > 0 && sheetH > 0;
  const key = `${sheetW}|${sheetH}|${rowGap}`;

  // Pack whenever the sheet changes, off the render: the search takes a
  // fraction of a second per panel type.
  useEffect(() => {
    if (!open || !valid) return;
    const options: PackOptions = { sheetW, sheetH, gap: 0, rowGap, margin: EDGE_MARGIN_MM };
    const id = window.setTimeout(() => {
      setPacked({ key, templates, options, results: templates.map((t) => ({ t, r: packTemplate(t, options) })) });
    }, 250);
    return () => window.clearTimeout(id);
  }, [open, valid, key, sheetW, sheetH, rowGap, templates]);

  const current = packed?.key === key && packed.templates === templates ? packed : null;
  const downloadable = current?.results.filter(({ r }) => r.placements.length > 0) ?? [];

  const download = (items: { t: LaserTemplate; r: PackResult }[]) => {
    if (!current) return;
    for (const { t, r } of items) {
      downloadSvg(
        templateFilename(designName, t, laserSettings).replace(/\.svg$/, `_sheet-${sizeName}.svg`),
        sheetToSvg(t, r, current.options, { showHoles: laserSettings.showHoles }),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-[oklch(0.08_0_0)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading tracking-[0.18em] text-foreground">Laser sheets</DialogTitle>
        </DialogHeader>

        <section className="grid gap-4 sm:grid-cols-2">
          <SizeSlider id="pack-width" label="Width" inches={widthIn} onChange={setWidthIn} />
          <SizeSlider id="pack-height" label="Height" inches={heightIn} onChange={setHeightIn} />
        </section>

        <section className="grid gap-2" aria-live="polite">
          <h3 className="text-sm text-foreground">One sheet per panel type</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {templates.map((t, i) => {
              const res = current?.results[i];
              const n = res?.r.placements.length ?? 0;
              return (
                <div key={t.classKey} className="grid gap-2 rounded-md border border-border p-3">
                  <div className="aspect-square w-full overflow-hidden rounded bg-[#060b18]">
                    {res ? (
                      n > 0 ? (
                        <SheetThumb template={t} result={res.r} options={current!.options} />
                      ) : (
                        <p className="grid h-full place-items-center px-3 text-center text-xs text-muted-foreground">
                          Too big for this sheet
                        </p>
                      )
                    ) : (
                      <p className="grid h-full place-items-center text-xs text-muted-foreground">
                        {valid ? "Packing…" : "Enter a sheet size"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-foreground">{t.label}</span>
                    {res && n > 0 && (
                      <button
                        type="button"
                        onClick={() => download([res])}
                        className="text-xs text-[var(--primary)] hover:underline"
                      >
                        Download
                      </button>
                    )}
                  </div>
                  {res && n > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <span className="text-foreground tabular-nums">{n}</span> per sheet ·{" "}
                      {bagsText(Math.floor(n / t.count))} ·{" "}
                      <span className="text-foreground tabular-nums">{Math.round(res.r.coverage * 100)}%</span> filled
                      {res.r.packedByHull && <span className="block">Curved shape, so pieces can&apos;t nest closely.</span>}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <label htmlFor="pack-row-space" className="flex cursor-pointer items-start gap-3">
          <button
            id="pack-row-space"
            type="button"
            role="switch"
            aria-checked={rowSpace}
            onClick={() => setRowSpace((v) => !v)}
            className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] ${
              rowSpace ? "border-[var(--primary)] bg-[var(--primary)]/30" : "border-border bg-muted"
            }`}
          >
            <span
              className={`absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full transition-all ${
                rowSpace ? "left-[calc(100%-1.05rem)] bg-[var(--primary)]" : "left-0.5 bg-muted-foreground"
              }`}
            />
          </button>
          <span className="grid gap-0.5">
            <span className="text-sm text-foreground">Space between rows ({ROW_SPACE_MM} mm)</span>
            <span className="text-xs text-muted-foreground">
              Leaves a channel between rows so cut pieces are easier to lift off the sheet. Pieces in a row still
              touch and share cut lines.
            </span>
          </span>
        </label>

        <Button
          onClick={() => download(downloadable)}
          disabled={downloadable.length === 0}
          className="w-full"
        >
          {downloadable.length > 0
            ? `Download ${downloadable.length} ${downloadable.length === 1 ? "sheet" : "sheets"}`
            : "Packing…"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** A sheet dimension slider, read out in inches and millimetres. */
function SizeSlider({
  id,
  label,
  inches,
  onChange,
}: {
  id: string;
  label: string;
  inches: number;
  onChange: (inches: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label id={`${id}-label`} className="text-sm text-foreground">
          {label}
        </label>
        <span className="text-sm tabular-nums text-foreground">
          {inches.toFixed(2)} in <span className="text-muted-foreground">· {(inches * MM_PER_IN).toFixed(1)} mm</span>
        </span>
      </div>
      <Slider
        aria-labelledby={`${id}-label`}
        value={[inches]}
        min={MIN_IN}
        max={MAX_IN}
        step={STEP_IN}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))}
      />
    </div>
  );
}

function bagsText(bags: number): string {
  if (bags === 0) return "less than one bag";
  return `enough for ${bags} ${bags === 1 ? "bag" : "bags"}`;
}

/** The packed sheet in miniature: cut outlines only. */
function SheetThumb({
  template,
  result,
  options,
}: {
  template: LaserTemplate;
  result: PackResult;
  options: PackOptions;
}) {
  const pieces = useMemo(
    () =>
      result.placements.map((p, i) => (
        <path
          key={i}
          d={template.cutPath}
          transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.deg.toFixed(2)})`}
        />
      )),
    [template, result],
  );
  const { sheetW, sheetH } = options;
  return (
    <svg
      viewBox={`0 0 ${sheetW} ${sheetH}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label={`${template.label} sheet with ${result.placements.length} pieces`}
    >
      <rect x={0} y={0} width={sheetW} height={sheetH} fill="none" stroke="var(--border)" strokeWidth={sheetW / 250} />
      <g fill="var(--primary)" fillOpacity={0.12} stroke="var(--primary)" strokeWidth={sheetW / 400}>
        {pieces}
      </g>
    </svg>
  );
}
