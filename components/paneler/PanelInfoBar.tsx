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
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Left: status readout. Reads like a piece of instrument output. */}
      <div className="flex items-center gap-3 text-sm">
        {selectedPanelId ? (
          <>
            <span
              className="size-5 rounded-sm border border-border shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
              style={{ backgroundColor: color ?? "transparent" }}
            />
            <code className="font-mono text-xs tracking-wider text-foreground/80">
              {selectedPanelId}
            </code>
            {color && (
              <>
                <span
                  aria-hidden
                  className="font-mono text-[10px] text-muted-foreground/60"
                >
                  /
                </span>
                <code className="font-mono text-xs tracking-wider text-primary/90">
                  {color.toUpperCase()}
                </code>
              </>
            )}
          </>
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Click any panel to select
          </span>
        )}
      </div>
      {/* Right: tool cluster. Bulk actions on the left, destructive on the
          right, separated visually so a stray click doesn't wipe work. */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 p-1">
          {shape && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPaintShape(shape)}
              className="h-7 px-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-primary/10 hover:text-primary"
            >
              Paint all {shape}s
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onFillUnpainted}
            className="h-7 px-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-primary/10 hover:text-primary"
          >
            Fill unpainted
          </Button>
        </div>
        {selectedPanelId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-7 px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
