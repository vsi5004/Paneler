"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

/**
 * "3x13 · 3x0" — how many edges carry how many holes, descending count.
 * Zero-hole edges are the deliberately unstitched short edges.
 */
function edgeSummary(edgeHoles: number[]): string {
  const tally = new Map<number, number>();
  for (const c of edgeHoles) tally.set(c, (tally.get(c) ?? 0) + 1);
  return [...tally.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([holes, edges]) => `${edges}\u00d7${holes}`)
    .join(" \u00b7 ");
}

import type { PanelTopology } from "@/lib/types";
import type { LaserSettings, LaserTemplate } from "@/lib/laser/types";
import { groupPanelsByCongruence } from "@/lib/laser/congruence";
import { buildLaserTemplate, type LaserTemplateOptions } from "@/lib/laser/template";
import { templateFilename, templateToSvg } from "@/lib/laser/svg";
import { downloadSvg } from "@/lib/laser/download";
import {
  MARGIN_MM,
  STITCH_HOLE_DIAMETER_MM,
} from "@/lib/laser/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PackSheetsDialog } from "./PackSheetsDialog";

interface LaserTemplatePaneProps {
  topology: PanelTopology;
  laserSettings: LaserSettings;
  onSettingsChange: (partial: Partial<LaserSettings>) => void;
  /** Design name used for download filenames. */
  designName: string;
  /** Per-preset template options (anchors, seam-true bands, gather). */
  templateOptions?: LaserTemplateOptions;
}

/**
 * Bottom sub-pane of the 2D view: the laser workbench. One template per
 * congruence class of panels, presented as a depth-stacked carousel —
 * the selected template large in front, the rest receding behind it;
 * clicking a background card (or arrow keys) rotates the bench.
 */
export function LaserTemplatePane({
  topology,
  laserSettings,
  onSettingsChange,
  designName,
  templateOptions,
}: LaserTemplatePaneProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [allOpen, setAllOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  // Pane height as a fraction of the 2D column — user-resizable via the
  // grip on the top edge (drag up = bigger templates / clearer holes).
  const DEFAULT_HEIGHT_FRAC = 0.44;
  const [heightFrac, setHeightFrac] = useState(DEFAULT_HEIGHT_FRAC);
  const [resizing, setResizing] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ y: number; frac: number; parentH: number } | null>(
    null,
  );

  const templates = useMemo(() => {
    const classes = groupPanelsByCongruence(topology);
    const opts = laserSettings.sharpCorners
      ? { ...templateOptions, sharpCorners: true }
      : templateOptions;
    return classes.map((cls) =>
      buildLaserTemplate(topology, cls, laserSettings, opts),
    );
  }, [topology, laserSettings, templateOptions]);

  // Clamp selection when the design changes shape.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, templates.length - 1)));
  }, [templates.length]);

  const current = templates[selected];

  return (
    <motion.div
      ref={rootRef}
      animate={{ height: collapsed ? 32 : `${heightFrac * 100}%` }}
      initial={false}
      transition={
        resizing
          ? { duration: 0 }
          : { type: "spring", stiffness: 300, damping: 34 }
      }
      className="relative flex min-h-8 shrink-0 flex-col overflow-hidden border-t border-[var(--border)]/60 bg-[#040810]"
    >
      {/* Resize grip — drag the pane's top edge. */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize template pane"
          title="Drag to resize · double-click to reset"
          className="group absolute inset-x-0 top-0 z-40 h-2 cursor-ns-resize touch-none"
          onDoubleClick={() => setHeightFrac(DEFAULT_HEIGHT_FRAC)}
          onPointerDown={(e) => {
            const parent = rootRef.current?.parentElement;
            if (!parent) return;
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            dragStart.current = {
              y: e.clientY,
              frac: heightFrac,
              parentH: parent.getBoundingClientRect().height,
            };
            setResizing(true);
          }}
          onPointerMove={(e) => {
            const start = dragStart.current;
            if (!start) return;
            const delta = (start.y - e.clientY) / start.parentH;
            setHeightFrac(
              Math.min(0.85, Math.max(0.2, start.frac + delta)),
            );
          }}
          onPointerUp={(e) => {
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
            dragStart.current = null;
            setResizing(false);
          }}
        >
          <div className="mx-auto mt-[3px] h-[2px] w-10 rounded-full bg-[var(--border)] transition-colors group-hover:bg-[var(--primary)]/70" />
        </div>
      )}
      {/* Header bar — always visible. */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex h-8 shrink-0 items-center gap-3 bg-[var(--sidebar)]/40 px-3 text-left"
        aria-expanded={!collapsed}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Cut · Templates
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {templates.length} {templates.length === 1 ? "type" : "types"}
        </span>
        {current && (
          <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
            {(current.bounds.width - 2 * MARGIN_MM).toFixed(1)}×
            {(current.bounds.height - 2 * MARGIN_MM).toFixed(1)}mm
          </span>
        )}
        <span
          className={`font-mono text-[10px] text-muted-foreground transition-transform ${
            collapsed ? "" : "rotate-180"
          }`}
          aria-hidden
        >
          ▴
        </span>
      </button>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Blueprint dot-grid workbench backdrop. */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle, color-mix(in srgb, var(--primary) 22%, transparent) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
            backgroundPosition: "9px 9px",
          }}
          aria-hidden
        />
        <div
          className="relative flex h-full flex-col"
          role="listbox"
          aria-label="Laser templates"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              setSelected((s) => (s + 1) % templates.length);
              e.preventDefault();
            } else if (e.key === "ArrowLeft") {
              setSelected((s) => (s - 1 + templates.length) % templates.length);
              e.preventDefault();
            }
          }}
        >
          {/* Carousel stage. */}
          <div className="relative flex-1">
            {templates.length > 1 && (
              <>
                <CarouselArrow
                  direction={-1}
                  onClick={() =>
                    setSelected((s) => (s - 1 + templates.length) % templates.length)
                  }
                />
                <CarouselArrow
                  direction={1}
                  onClick={() => setSelected((s) => (s + 1) % templates.length)}
                />
              </>
            )}
            {templates.map((t, i) => {
              // Signed circular distance from the selected card.
              const n = templates.length;
              let d = i - selected;
              if (d > n / 2) d -= n;
              if (d < -n / 2) d += n;
              if (Math.abs(d) > 2 && n > 4) return null;
              const front = d === 0;
              return (
                <motion.button
                  key={t.classKey}
                  type="button"
                  role="option"
                  aria-selected={front}
                  onClick={() => setSelected(i)}
                  className="absolute left-1/2 top-1/2 flex h-[86%] w-[38%] min-w-40 max-w-96 flex-col items-stretch"
                  style={{ pointerEvents: "auto" }}
                  animate={{
                    x: `calc(-50% + ${d * 58}%)`,
                    y: "-50%",
                    scale: front ? 1 : 0.52 - 0.06 * Math.abs(d),
                    opacity: front ? 1 : 0.4,
                    zIndex: 10 - Math.abs(d),
                    filter: front ? "blur(0px)" : "blur(1px)",
                  }}
                  initial={false}
                  transition={{ type: "spring", stiffness: 260, damping: 28 }}
                >
                  <TemplateCard
                    template={t}
                    front={front}
                    showHoles={laserSettings.showHoles}
                  />
                </motion.button>
              );
            })}
          </div>

          {/* Front-card caption + download. */}
          {current && (
            <div className="relative z-20 flex h-10 shrink-0 items-center gap-3 px-3 pb-2">
              <span className="font-heading text-sm tracking-[0.15em] text-foreground">
                {current.label}
              </span>
              <span className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                × {current.count}
              </span>
              <button
                type="button"
                aria-pressed={laserSettings.showHoles}
                title={
                  laserSettings.showHoles
                    ? "Hide stitch holes (preview + export)"
                    : "Show stitch holes (preview + export)"
                }
                onClick={() =>
                  onSettingsChange({ showHoles: !laserSettings.showHoles })
                }
                className={`flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors ${
                  laserSettings.showHoles
                    ? "border-[var(--primary)]/50 text-foreground"
                    : "border-[var(--border)] text-muted-foreground/60"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    laserSettings.showHoles
                      ? "bg-[var(--primary)]"
                      : "border border-current"
                  }`}
                  aria-hidden
                />
                {current.holes.length} holes
              </button>
              <span
                className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground"
                title="Holes per edge (count x holes); adjust hole spacing to tune"
              >
                {edgeSummary(current.edgeHoles)}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em]"
                onClick={() => setAllOpen(true)}
              >
                All templates
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="font-mono text-[10px] uppercase tracking-[0.2em]"
                onClick={() => setPackOpen(true)}
              >
                Pack sheets
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="font-mono text-[10px] uppercase tracking-[0.2em]"
                onClick={() =>
                  downloadSvg(
                    templateFilename(designName, current, laserSettings),
                    templateToSvg(current, {
                      showHoles: laserSettings.showHoles,
                    }),
                  )
                }
              >
                Download SVG
              </Button>
            </div>
          )}
        </div>
      </div>
      <PackSheetsDialog
        open={packOpen}
        onOpenChange={setPackOpen}
        templates={templates}
        laserSettings={laserSettings}
        designName={designName}
      />
      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="border-border bg-[oklch(0.08_0_0)] sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-heading tracking-[0.18em] text-foreground">
              All templates
            </DialogTitle>
          </DialogHeader>
          <AllTemplatesSheet templates={templates} showHoles={laserSettings.showHoles} />
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

/**
 * Edge navigation button — a hexagonal "panel" (matching the footbag
 * motif) with a double chevron, glowing on hover. Makes the carousel's
 * rotability unmistakable.
 */
function CarouselArrow({
  direction,
  onClick,
}: {
  direction: -1 | 1;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      aria-label={direction === 1 ? "Next template" : "Previous template"}
      onClick={onClick}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.92 }}
      className={`group absolute top-1/2 z-30 -translate-y-1/2 text-muted-foreground transition-colors hover:text-[var(--primary)] ${
        direction === 1 ? "right-4" : "left-4"
      }`}
    >
      <svg
        width="46"
        height="52"
        viewBox="0 0 46 52"
        fill="none"
        aria-hidden
        style={{ transform: direction === -1 ? "scaleX(-1)" : undefined }}
        className="drop-shadow-[0_0_10px_rgba(0,0,0,0.7)] transition-[filter] group-hover:drop-shadow-[0_0_12px_color-mix(in_srgb,var(--primary)_45%,transparent)]"
      >
        {/* Hexagonal panel body */}
        <path
          d="M23 1 L43.5 12.5 L43.5 39.5 L23 51 L2.5 39.5 L2.5 12.5 Z"
          fill="#060b18"
          fillOpacity="0.92"
          stroke="currentColor"
          strokeOpacity="0.7"
          strokeWidth="1.5"
        />
        {/* Double chevron */}
        <polyline
          points="16 17 25 26 16 35"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.45"
        />
        <polyline
          points="23 17 32 26 23 35"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.button>
  );
}

/**
 * One template rendered as a blueprint: bright cut line, dashed seam
 * line, red stitch pierce points, and an engineering-style dimension rule
 * on the front card.
 */
function TemplateCard({
  template: t,
  front,
  showHoles,
}: {
  template: LaserTemplate;
  front: boolean;
  showHoles: boolean;
}) {
  // The export keeps laser-friendly 10mm margins; the preview crops to
  // the shape itself (plus a little air and a band for the dimension
  // rule) so the template fills its frame.
  // Room around the shape for the edge-length labels outside the cut.
  const PAD = 6;
  const DIM_BAND = 7;
  const shapeMinX = t.bounds.minX + MARGIN_MM;
  const shapeMinY = t.bounds.minY + MARGIN_MM;
  const shapeW = t.bounds.width - 2 * MARGIN_MM;
  const shapeH = t.bounds.height - 2 * MARGIN_MM;
  const vbX = shapeMinX - PAD;
  const vbY = shapeMinY - PAD;
  const vbW = shapeW + 2 * PAD;
  const vbH = shapeH + 2 * PAD + (front ? DIM_BAND : 0);
  // Dimension rule sits in the reserved band under the shape.
  const dimY = shapeMinY + shapeH + PAD + DIM_BAND / 2;
  const dimX0 = shapeMinX;
  const dimX1 = shapeMinX + shapeW;

  return (
    <span
      className={`block h-full w-full overflow-hidden rounded-md border ${
        front
          ? "border-[var(--primary)]/45 bg-[#060b18]/95 shadow-[0_0_28px_-6px_color-mix(in_srgb,var(--primary)_35%,transparent)]"
          : "border-[var(--border)]/70 bg-[#04070f]/90"
      }`}
    >
      <svg
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        aria-hidden
      >
        <TemplateGraphics template={t} unit={shapeW} showHoles={showHoles} lengths={front} />
        {/* Engineering dimension rule (front card only). */}
        {front && (
          <g
            stroke="var(--muted-foreground)"
            strokeWidth={shapeW / 450}
            opacity={0.85}
          >
            <line x1={dimX0} y1={dimY} x2={dimX1} y2={dimY} />
            <line x1={dimX0} y1={dimY - shapeW / 70} x2={dimX0} y2={dimY + shapeW / 70} />
            <line x1={dimX1} y1={dimY - shapeW / 70} x2={dimX1} y2={dimY + shapeW / 70} />
            <text
              x={(dimX0 + dimX1) / 2}
              y={dimY - shapeW / 55}
              textAnchor="middle"
              stroke="none"
              fill="var(--muted-foreground)"
              style={{
                fontSize: shapeW / 20,
                fontFamily: "var(--font-mono, monospace)",
                letterSpacing: "0.08em",
              }}
            >
              {shapeW.toFixed(1)} mm
            </text>
          </g>
        )}
      </svg>
    </span>
  );
}

/**
 * A template's seam line, cut line, stitch holes and (optionally) its
 * side lengths along the seam, in template millimetres. `unit` sets line
 * weights and text size, so graphics drawn together at one scale share
 * one `unit`.
 */
function TemplateGraphics({
  template: t,
  unit,
  showHoles,
  lengths,
}: {
  template: LaserTemplate;
  unit: number;
  showHoles: boolean;
  lengths: boolean;
}) {
  const holeR = Math.max(STITCH_HOLE_DIAMETER_MM / 2, unit / 200);
  const fontSize = Math.max(0.9, unit / 26);
  return (
    <>
      {/* Seam (stitch) line — dashed, quiet. */}
      <path
        d={t.seamPath}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth={unit / 320}
        strokeDasharray={`${unit / 70} ${unit / 100}`}
        opacity={0.7}
      />
      {/* Cut line — the star. */}
      <path d={t.cutPath} fill="none" stroke="var(--primary)" strokeWidth={unit / 180} />
      {/* Stitch pierce points. */}
      {showHoles && (
        <g fill="#ffffff" opacity={0.9}>
          {[...t.holes, ...t.markerHoles].map((h, i) => (
            <circle key={i} cx={h.x} cy={h.y} r={holeR} />
          ))}
        </g>
      )}
      {/* Each side's length along the seam (preview only, not exported),
          as a dimension: a line spanning the measured run with a tick at
          each end, and the number just outside it. */}
      {lengths && (
        <g
          fill="var(--muted-foreground)"
          stroke="var(--muted-foreground)"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize, fontFamily: "var(--font-mono, monospace)" }}
        >
          {t.edgeLengths.map(({ lengthMm, labelAt, dimension: { from, to, nOut: n } }, i) => {
            const tick = fontSize * 0.35;
            const text = fontSize * 0.75;
            return (
              <g key={i}>
                <g strokeWidth={unit / 320} strokeLinecap="round" fill="none">
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                  {[from, to].map((q, j) => (
                    <line key={j} x1={q.x - n.x * tick} y1={q.y - n.y * tick} x2={q.x + n.x * tick} y2={q.y + n.y * tick} />
                  ))}
                </g>
                <text x={labelAt.x + n.x * text} y={labelAt.y + n.y * text} stroke="none">
                  {lengthMm.toFixed(1)}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </>
  );
}

/**
 * Every panel type's template side by side in one drawing, at one common
 * scale — so relative sizes read true — each captioned with its name,
 * how many the design needs and its hole count, over a 10mm scale bar.
 */
function AllTemplatesSheet({
  templates,
  showHoles,
}: {
  templates: LaserTemplate[];
  showHoles: boolean;
}) {
  const GAP = 8;
  const PAD = 6;
  const CAPTION = 9;
  const shapes = templates.map((t) => ({
    t,
    x: t.bounds.minX + MARGIN_MM,
    y: t.bounds.minY + MARGIN_MM,
    w: t.bounds.width - 2 * MARGIN_MM,
    h: t.bounds.height - 2 * MARGIN_MM,
  }));
  const unit = Math.max(...shapes.map((s) => s.w));
  const rowH = Math.max(...shapes.map((s) => s.h));
  // Left edge of each slot: the widths of the slots before it.
  const lefts: number[] = [];
  let cursor = 0;
  for (const sh of shapes) {
    lefts.push(cursor + PAD);
    cursor += sh.w + 2 * PAD + GAP;
  }
  const placed = shapes.map((sh, i) => ({
    ...sh,
    left: lefts[i],
    dx: lefts[i] - sh.x,
    dy: PAD + (rowH - sh.h) / 2 - sh.y,
  }));
  const totalW = cursor - GAP;
  const totalH = rowH + 2 * PAD + CAPTION + 8;
  const text = (size: number) => ({
    fontSize: size,
    fontFamily: "var(--font-mono, monospace)",
  });
  const barY = rowH + 2 * PAD + CAPTION + 3;
  return (
    <svg
      viewBox={`0 0 ${totalW} ${totalH}`}
      className="h-auto max-h-[70vh] w-full"
      role="img"
      aria-label="All panel templates at the same scale"
    >
      {placed.map((p) => (
        <g key={p.t.classKey}>
          <g transform={`translate(${p.dx} ${p.dy})`}>
            <TemplateGraphics template={p.t} unit={unit} showHoles={showHoles} lengths />
          </g>
          <text
            x={p.left + p.w / 2}
            y={rowH + 2 * PAD + 2}
            textAnchor="middle"
            fill="var(--foreground)"
            style={{ ...text(unit / 16), letterSpacing: "0.1em" }}
          >
            {p.t.label.toUpperCase()} × {p.t.count}
          </text>
          <text
            x={p.left + p.w / 2}
            y={rowH + 2 * PAD + 2 + unit / 12}
            textAnchor="middle"
            fill="var(--muted-foreground)"
            style={text(unit / 22)}
          >
            {p.t.holes.length} holes · {p.w.toFixed(1)}×{p.h.toFixed(1)}mm
          </text>
        </g>
      ))}
      <g stroke="var(--muted-foreground)" strokeWidth={unit / 300}>
        <line x1={PAD} y1={barY} x2={PAD + 10} y2={barY} />
        <line x1={PAD} y1={barY - 0.8} x2={PAD} y2={barY + 0.8} />
        <line x1={PAD + 10} y1={barY - 0.8} x2={PAD + 10} y2={barY + 0.8} />
      </g>
      <text x={PAD + 11.5} y={barY} dominantBaseline="middle" fill="var(--muted-foreground)" style={text(unit / 24)}>
        10 mm
      </text>
    </svg>
  );
}
