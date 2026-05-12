"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-2">
        {selectedPanelId ? (
          <div className="flex items-center gap-3 text-sm">
            <span
              className="size-4 rounded border border-border"
              style={{ backgroundColor: color ?? "transparent" }}
            />
            <code className="font-mono text-xs text-muted-foreground">
              {selectedPanelId}
            </code>
            {color && (
              <code className="font-mono text-xs text-muted-foreground">
                {color.toUpperCase()}
              </code>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            Click a panel to select it.
          </span>
        )}
        <div className="flex items-center gap-2">
          {shape && (
            <Button variant="outline" size="sm" onClick={() => onPaintShape(shape)}>
              Paint all {shape}s
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onFillUnpainted}>
            Fill unpainted
          </Button>
          {selectedPanelId && (
            <Button variant="outline" size="sm" onClick={onReset}>
              Reset panel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
