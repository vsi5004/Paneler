"use client";

import { useMemo } from "react";
import { unfoldNet } from "@/lib/flatten/unfoldNet";
import type { Vec2 } from "@/lib/flatten/types";
import type { PanelColors, PanelTopology } from "@/lib/types";

const DEFAULT_PANEL_COLOR = "#c41e3a";
const VIEWPORT_PADDING = 0.08; // fraction of bounding box

interface PanelerFlatViewProps {
  topology: PanelTopology;
  panelColors: PanelColors;
  selectedPanelId: string | null;
  onPanelClick: (panelId: string) => void;
}

/**
 * 2D unfolded "panel net" view of the same topology the 3D canvas
 * renders. Same panel IDs + same color state, so painting and
 * selection round-trip seamlessly between the two panes.
 *
 * Renders one SVG polygon per panel — pure React, no canvas, no DOM
 * library — so click-to-paint comes for free via SVG event delegation.
 */
export default function PanelerFlatView({
  topology,
  panelColors,
  selectedPanelId,
  onPanelClick,
}: PanelerFlatViewProps) {
  // Memoise by topology reference; PanelerDesigner's `useMemo` already
  // gives us a stable identity per preset / OBJ upload.
  const { layout, viewBox } = useMemo(() => {
    const layout = unfoldNet(topology);
    const viewBox = computeViewBox(layout);
    return { layout, viewBox };
  }, [topology]);

  return (
    <div className="flex flex-1 items-center justify-center bg-muted/20 p-4">
      <svg
        viewBox={viewBox}
        className="size-full max-h-full max-w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {topology.panels.map((panel) => {
          const corners = layout.get(panel.id);
          if (!corners || corners.length < 3) return null;
          const fill = panelColors[panel.id] ?? DEFAULT_PANEL_COLOR;
          const selected = panel.id === selectedPanelId;
          return (
            <polygon
              key={panel.id}
              points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
              fill={fill}
              stroke={selected ? "#ffffff" : "#111"}
              strokeWidth={selected ? 0.04 : 0.015}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onPanelClick(panel.id);
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}

function computeViewBox(layout: ReadonlyMap<string, ReadonlyArray<Vec2>>): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corners of layout.values()) {
    for (const c of corners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
  }
  if (!isFinite(minX)) {
    return "-1 -1 2 2"; // empty topology fallback
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const padX = w * VIEWPORT_PADDING;
  const padY = h * VIEWPORT_PADDING;
  return `${minX - padX} ${minY - padY} ${w + 2 * padX} ${h + 2 * padY}`;
}
