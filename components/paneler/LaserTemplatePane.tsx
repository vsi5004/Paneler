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
import { buildLaserTemplate } from "@/lib/laser/template";
import { templateFilename, templateToSvg } from "@/lib/laser/svg";
import { downloadSvg } from "@/lib/laser/download";
import {
  MARGIN_MM,
  STITCH_HOLE_DIAMETER_MM,
} from "@/lib/laser/constants";
import { Button } from "@/components/ui/button";

interface LaserTemplatePaneProps {
  topology: PanelTopology;
  laserSettings: LaserSettings;
  onSettingsChange: (partial: Partial<LaserSettings>) => void;
  /** Design name used for download filenames. */
  designName: string;
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
}: LaserTemplatePaneProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState(0);
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
    return classes.map((cls) => buildLaserTemplate(topology, cls, laserSettings));
  }, [topology, laserSettings]);

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
          Laser · Templates
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
  const PAD = 4;
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
  const holeR = Math.max(STITCH_HOLE_DIAMETER_MM / 2, shapeW / 200);

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
        {/* Seam (stitch) line — dashed, quiet. */}
        <path
          d={t.seamPath}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={shapeW / 320}
          strokeDasharray={`${shapeW / 70} ${shapeW / 100}`}
          opacity={0.7}
        />
        {/* Cut line — the star. */}
        <path
          d={t.cutPath}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={shapeW / 180}
        />
        {/* Stitch pierce points. */}
        {showHoles && (
          <g fill="#ffffff" opacity={0.9}>
            {t.holes.map((h, i) => (
              <circle key={i} cx={h.x} cy={h.y} r={holeR} />
            ))}
          </g>
        )}
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
