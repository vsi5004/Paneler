"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    const byShape = new Map<string, { total: number; counts: Map<string, number>; unpainted: number }>();
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
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Color summary</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-80">
          <div className="flex flex-col gap-3 text-sm">
            {breakdowns.map((b) => (
              <div key={b.shape}>
                <div className="mb-1 font-medium capitalize">
                  {b.shape}
                  <span className="ml-2 text-muted-foreground">
                    {b.total} {b.total === 1 ? "panel" : "panels"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {b.byColor.map(({ color, count }) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => onSwatchClick?.(color)}
                      title={`${color} × ${count}`}
                      className="flex h-6 items-center gap-1 rounded border border-border px-1.5 transition-colors hover:bg-muted"
                    >
                      <span
                        className="size-3 rounded-sm"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs text-muted-foreground">
                        {count}
                      </span>
                    </button>
                  ))}
                  {b.unpainted > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {b.unpainted} unpainted
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
