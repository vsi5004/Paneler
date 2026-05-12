"use client";

import { useMemo } from "react";
import { unfoldNet } from "@/lib/flatten/unfoldNet";
import type { PanelFlat, Vec2 } from "@/lib/flatten/types";
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
 * Each panel is drawn as a `<path>` with quadratic-bezier sides that
 * bulge outward by the same proportion the original great-circle arc
 * bulges past its 3D chord — so a tetrahedron (huge spherical faces)
 * shows visibly curved triangle edges, while a 162-panel Goldberg
 * looks nearly straight-edged.
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
          const flat = layout.get(panel.id);
          if (!flat || flat.corners.length < 3) return null;
          const fill = panelColors[panel.id] ?? DEFAULT_PANEL_COLOR;
          const selected = panel.id === selectedPanelId;
          return (
            <path
              key={panel.id}
              d={buildCurvedPanelPath(flat)}
              fill={fill}
              stroke="#ffffff"
              strokeWidth={selected ? 0.04 : 0.012}
              strokeOpacity={selected ? 1 : 0.75}
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

/**
 * Build an SVG path that traces the panel boundary with one quadratic-
 * bezier segment per edge. Control point for each edge sits on the
 * perpendicular bisector of the chord, offset outward (away from the
 * panel centroid) by `2 × sagitta` — because a quadratic bezier
 * evaluated at t=0.5 reaches half the perpendicular distance from
 * chord to control point.
 */
function buildCurvedPanelPath(flat: PanelFlat): string {
  const { corners, sagittaRatios } = flat;
  const n = corners.length;
  if (n < 3) return "";

  // Panel centroid in flat space — used to flip the outward normal so
  // every edge bulges AWAY from the centre, not into it.
  let cx = 0;
  let cy = 0;
  for (const c of corners) {
    cx += c.x;
    cy += c.y;
  }
  cx /= n;
  cy /= n;

  const parts: string[] = [`M ${corners[0].x} ${corners[0].y}`];
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edgeLen = Math.hypot(dx, dy);
    // Perpendicular to the edge.
    let nx = -dy / edgeLen;
    let ny = dx / edgeLen;
    // Flip if it points toward the centroid — we want OUTward bulge.
    if (nx * (cx - midX) + ny * (cy - midY) > 0) {
      nx = -nx;
      ny = -ny;
    }
    const sagitta = edgeLen * sagittaRatios[i];
    const cpX = midX + nx * 2 * sagitta;
    const cpY = midY + ny * 2 * sagitta;
    parts.push(`Q ${cpX} ${cpY} ${b.x} ${b.y}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

function computeViewBox(layout: ReadonlyMap<string, PanelFlat>): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // Account for the outward bulge on each edge: corners alone aren't
  // enough — quadratic-bezier control points stick out beyond the
  // corner bounding box, so include their effective reach.
  for (const flat of layout.values()) {
    const { corners, sagittaRatios } = flat;
    const n = corners.length;
    let cx = 0;
    let cy = 0;
    for (const c of corners) {
      cx += c.x;
      cy += c.y;
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
    cx /= n;
    cy /= n;
    for (let i = 0; i < n; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % n];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const edgeLen = Math.hypot(dx, dy);
      const sagitta = edgeLen * sagittaRatios[i];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      let nx = -dy / edgeLen;
      let ny = dx / edgeLen;
      if (nx * (cx - midX) + ny * (cy - midY) > 0) {
        nx = -nx;
        ny = -ny;
      }
      // The bezier reaches half the control-point offset at t=0.5.
      const peakX = midX + nx * sagitta;
      const peakY = midY + ny * sagitta;
      if (peakX < minX) minX = peakX;
      if (peakY < minY) minY = peakY;
      if (peakX > maxX) maxX = peakX;
      if (peakY > maxY) maxY = peakY;
    }
  }
  if (!isFinite(minX)) {
    return "-1 -1 2 2";
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const padX = w * VIEWPORT_PADDING;
  const padY = h * VIEWPORT_PADDING;
  return `${minX - padX} ${minY - padY} ${w + 2 * padX} ${h + 2 * padY}`;
}
