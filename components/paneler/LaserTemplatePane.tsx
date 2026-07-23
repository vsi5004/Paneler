"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

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
  designName,
}: LaserTemplatePaneProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState(0);

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
      animate={{ height: collapsed ? 32 : "44%" }}
      initial={false}
      transition={{ type: "spring", stiffness: 300, damping: 34 }}
      className="flex min-h-8 shrink-0 flex-col overflow-hidden border-t border-[var(--border)]/60 bg-[#040810]"
    >
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
                  <TemplateCard template={t} front={front} />
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
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {current.holes.length} holes
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em]"
                onClick={() =>
                  downloadSvg(
                    templateFilename(designName, current, laserSettings),
                    templateToSvg(current),
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
}: {
  template: LaserTemplate;
  front: boolean;
}) {
  const { minX, minY, width, height } = t.bounds;
  const shapeW = width - 2 * MARGIN_MM;
  const maxY = minY + height;
  // Dimension rule sits inside the bottom margin band.
  const dimY = maxY - MARGIN_MM / 2;
  const dimX0 = minX + MARGIN_MM;
  const dimX1 = minX + width - MARGIN_MM;
  const holeR = Math.max(STITCH_HOLE_DIAMETER_MM / 2, width / 260);

  return (
    <span
      className={`block h-full w-full overflow-hidden rounded-md border ${
        front
          ? "border-[var(--primary)]/45 bg-[#060b18]/95 shadow-[0_0_28px_-6px_color-mix(in_srgb,var(--primary)_35%,transparent)]"
          : "border-[var(--border)]/70 bg-[#04070f]/90"
      }`}
    >
      <svg
        viewBox={`${minX} ${minY} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        aria-hidden
      >
        {/* Seam (stitch) line — dashed, quiet. */}
        <path
          d={t.seamPath}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={width / 420}
          strokeDasharray={`${width / 90} ${width / 130}`}
          opacity={0.7}
        />
        {/* Cut line — the star. */}
        <path
          d={t.cutPath}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={width / 230}
        />
        {/* Stitch pierce points. */}
        <g fill="#ffffff" opacity={0.9}>
          {t.holes.map((h, i) => (
            <circle key={i} cx={h.x} cy={h.y} r={holeR} />
          ))}
        </g>
        {/* Engineering dimension rule (front card only). */}
        {front && (
          <g
            stroke="var(--muted-foreground)"
            strokeWidth={width / 600}
            opacity={0.85}
          >
            <line x1={dimX0} y1={dimY} x2={dimX1} y2={dimY} />
            <line x1={dimX0} y1={dimY - width / 90} x2={dimX0} y2={dimY + width / 90} />
            <line x1={dimX1} y1={dimY - width / 90} x2={dimX1} y2={dimY + width / 90} />
            <text
              x={(dimX0 + dimX1) / 2}
              y={dimY - width / 70}
              textAnchor="middle"
              stroke="none"
              fill="var(--muted-foreground)"
              style={{
                fontSize: width / 26,
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
