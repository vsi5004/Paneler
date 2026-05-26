"use client";

import { Button } from "@/components/ui/button";
import { getPanelShape } from "@/lib/designState";
import type { PanelColors } from "@/lib/types";

interface PanelInfoBarProps {
  selectedPanelId: string | null;
  panelColors: PanelColors;
  onReset: () => void;
  onPaintShape: (shape: string) => void;
  onFillUnpainted: () => void;
}

export function PanelInfoBar({
  selectedPanelId,
  panelColors,
  onReset,
  onPaintShape,
  onFillUnpainted,
}: PanelInfoBarProps) {
  const shape = selectedPanelId ? getPanelShape(selectedPanelId) : null;
  const color = selectedPanelId ? panelColors[selectedPanelId] : undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Panel identity readout */}
      <div>
        <h2 className="mb-3 font-heading text-lg tracking-[0.15em] text-foreground">
          Selection
        </h2>
        {selectedPanelId ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2.5">
            <span
              className="size-6 shrink-0 rounded-sm border border-border shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
              style={{ backgroundColor: color ?? "transparent" }}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <code className="truncate font-mono text-[11px] tracking-wider text-foreground/80">
                {selectedPanelId}
              </code>
              {color && (
                <code className="font-mono text-[11px] tracking-wider text-primary/90">
                  {color.toUpperCase()}
                </code>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border/50 px-3 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
              Click a panel to select
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5">
        {shape && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPaintShape(shape)}
            className="h-8 justify-start font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-primary/10 hover:text-primary"
          >
            Paint all {shape}s
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onFillUnpainted}
          className="h-8 justify-start font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-primary/10 hover:text-primary"
        >
          Fill unpainted
        </Button>
        {selectedPanelId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-8 justify-start font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            Reset panel
          </Button>
        )}
      </div>
    </div>
  );
}
