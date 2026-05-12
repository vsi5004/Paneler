"use client";

import { useMemo } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { getPanelShape } from "@/lib/designState";
import type { PanelTopology, PanelColors } from "@/lib/types";

interface ColorSummaryProps {
  topology: PanelTopology;
  panelColors: PanelColors;
  onSwatchClick?: (color: string) => void;
}

interface ShapeBreakdown {
  shape: string;
  total: number;
  unpainted: number;
  byColor: { color: string; count: number }[];
}

export function ColorSummary({
  topology,
  panelColors,
  onSwatchClick,
}: ColorSummaryProps) {
  const breakdowns = useMemo<ShapeBreakdown[]>(() => {
    const byShape = new Map<
      string,
      { total: number; counts: Map<string, number>; unpainted: number }
    >();
    for (const panel of topology.panels) {
      const shape = getPanelShape(panel.id);
      const entry =
        byShape.get(shape) ?? { total: 0, counts: new Map(), unpainted: 0 };
      entry.total += 1;
      const color = panelColors[panel.id];
      if (color) {
        entry.counts.set(color, (entry.counts.get(color) ?? 0) + 1);
      } else {
        entry.unpainted += 1;
      }
      byShape.set(shape, entry);
    }
    return [...byShape.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([shape, e]) => ({
        shape,
        total: e.total,
        unpainted: e.unpainted,
        byColor: [...e.counts.entries()]
          .map(([color, count]) => ({ color, count }))
          .sort((a, b) => b.count - a.count),
      }));
  }, [topology, panelColors]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-heading text-lg tracking-[0.15em] text-foreground">
          Summary
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {topology.panels.length} panels
        </span>
      </div>
      <ScrollArea className="-mr-2 flex-1 pr-2">
        <div className="flex flex-col gap-4 pb-2">
          {breakdowns.map((b) => (
            <div key={b.shape}>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="font-heading text-sm uppercase tracking-[0.18em] text-primary">
                  {b.shape}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {b.total}
                </span>
                {b.unpainted > 0 && (
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                    {b.unpainted} blank
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {b.byColor.map(({ color, count }) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onSwatchClick?.(color)}
                    title={`${color} × ${count}`}
                    className="group flex h-7 items-center gap-1.5 rounded-md border border-border bg-background/40 pl-1 pr-2 transition-all hover:border-primary/50 hover:bg-background/80"
                  >
                    <span
                      className="size-5 rounded-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-mono text-[11px] text-foreground/80">
                      {count}
                    </span>
                  </button>
                ))}
                {b.byColor.length === 0 && b.unpainted === b.total && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    All unpainted
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
